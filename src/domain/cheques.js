// الشيكات (نقي): شيك استلمته من زبون (وارد) أو أعطيته لتاجر (صادر)، وموعد استحقاقه، وما يصير به:
//   وارد:  بانتظار ← صُرف (دخل صندوقًا) | رجع (عاد دينًا على الزبون) | جُيّر لتاجر (سدّد ما عليك له)
//   صادر:  بانتظار ← صُرف (خرج من صندوق) | أُلغي أو رجع (عاد دينًا عليك للتاجر)
// أثر الشيك على كشف الزبون أو التاجر قيود «إضافة فقط» تحمل payment_id = رقم الشيك، فلا تُعدَّل من الكشف بل من الشيك.
import { dueStatus, isDay } from './dues.js';
import { formatMoney } from './currency.js';
import { VOID_PREFIX } from './ledger.js';

export const CHEQUE_STATUS = Object.freeze({
  pending: 'بانتظار الصرف', cleared: 'صُرف', bounced: 'رجع', endorsed: 'جُيّر', cancelled: 'أُلغي',
});
export const SOON_DAYS = 3;

/** رسالة خطأ أو null. */
export function chequeProblem(c) {
  if (c.direction !== 'in' && c.direction !== 'out') return 'اختر: شيك استلمته أم أعطيته';
  if (!Number.isSafeInteger(c.amount) || c.amount <= 0) return 'اكتب مبلغ الشيك';
  if (!isDay(c.due_date)) return 'اختر تاريخ استحقاق الشيك';
  if (c.party_type !== 'customer' && c.party_type !== 'supplier' && !String(c.party_name || '').trim()) return c.direction === 'in' ? 'اكتب ممّن الشيك' : 'اكتب لمن الشيك';
  if ((c.party_type === 'customer' || c.party_type === 'supplier') && !c.party_id) return c.party_type === 'customer' ? 'اختر الزبون' : 'اختر التاجر';
  return null;
}

/** وصف قصير للشيك: «شيك 100245 — بنك فلسطين». */
export function chequeLabel(c) {
  return ['شيك', c.number || null, c.bank ? `— ${c.bank}` : null].filter(Boolean).join(' ');
}

/** ما يمكن فعله بالشيك الآن: مفاتيح من clear | bounce | endorse | cancel | remove. */
export function chequeActions(c) {
  if (c.deleted) return [];
  if (c.status === 'pending') return c.direction === 'in' ? ['clear', 'endorse', 'bounce', 'remove'] : ['clear', 'cancel', 'remove'];
  if (c.status === 'endorsed') return ['bounce'];
  return [];
}

/**
 * القيود التي يكتبها حدث على الشيك في كشف الزبون أو التاجر (نقي). كلها تحمل payment_id = رقم الشيك.
 * action: record | bounce | endorse | cancel. supplierId للتجيير.
 * يرجع { customer: [...], supplier: [...] } — سجلات جاهزة للإضافة (بلا id ولا تاريخ).
 */
export function chequeEntries(action, c, { supplierId = null } = {}) {
  const out = { customer: [], supplier: [] };
  const label = chequeLabel(c);
  const cust = (amount, type, note) => out.customer.push({ customer_id: c.party_id, type, amount, payment_id: c.id, note });
  const supp = (id, amount, type, note) => out.supplier.push({ supplier_id: id, type, amount, payment_id: c.id, note });
  const due = c.due_date ? ` (يستحق ${c.due_date})` : '';
  if (action === 'record') {
    if (c.direction === 'in' && c.party_type === 'customer') cust(-c.amount, 'payment', `${label}${due}`);
    if (c.direction === 'out' && c.party_type === 'supplier') supp(c.party_id, -c.amount, 'payment', `${label}${due}`);
  } else if (action === 'bounce') {
    // الشيك الوارد رجع: يعود دينًا على الزبون؛ وإن كان مجيَّرًا لتاجر يعود ما عليك له
    if (c.party_type === 'customer') cust(c.amount, 'adjustment', `${label} رجع`);
    if (c.status === 'endorsed' && c.endorsed_to) supp(c.endorsed_to, c.amount, 'adjustment', `${label} المجيَّر رجع`);
  } else if (action === 'endorse') {
    supp(supplierId, -c.amount, 'payment', `${label} مجيَّر${c.party_name ? ` من ${c.party_name}` : ''}`);
  } else if (action === 'cancel') {
    if (c.party_type === 'supplier') supp(c.party_id, c.amount, 'adjustment', `${label} أُلغي`);
  }
  return out;
}

/** قيد عكسي لقيد شيك (عند حذف شيك سُجّل خطأ أو التراجع عن حدث). */
export function chequeUndoEntry(entry) {
  const { id, created_at, shop_id, device_id, created_by, ...rest } = entry;
  return { ...rest, amount: -entry.amount, note: `${VOID_PREFIX}${id}` };
}

/** حالة موعد شيك بانتظار الصرف: { days, state: overdue | today | soon | later }. */
export function chequeDue(c, today, soonDays = SOON_DAYS) {
  return dueStatus(c.due_date, today, soonDays);
}

/**
 * الشيكات التي حان موعدها أو اقترب (خلال soonDays) ولم تُصرف بعد، الأقدم موعدًا أولًا.
 * كل عنصر: { cheque, days, state }.
 */
export function chequesDue(cheques, today, soonDays = SOON_DAYS) {
  const out = [];
  for (const c of cheques) {
    if (c.deleted || c.status !== 'pending' || !isDay(c.due_date)) continue;
    const st = chequeDue(c, today, soonDays);
    if (st.state === 'later') continue;
    out.push({ cheque: c, days: st.days, state: st.state });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** سطر التنبيه في الرئيسية: { title, total, overdue, count } أو null. */
export function chequesSummary(list) {
  if (!list || !list.length) return null;
  const total = list.reduce((a, x) => a + x.cheque.amount, 0);
  const overdue = list.filter((x) => x.state === 'overdue').length;
  if (list.length === 1) {
    const { cheque: c, state, days } = list[0];
    const who = c.party_name ? ` ${c.direction === 'in' ? 'من' : 'لـ'} ${c.party_name}` : '';
    const when = state === 'overdue' ? 'فات موعده' : state === 'today' ? 'يستحق اليوم' : days === 1 ? 'يستحق غدًا' : `يستحق بعد ${days} أيام`;
    return { title: `${c.direction === 'in' ? 'شيك لك' : 'شيك عليك'}${who} ${when}`, total, overdue, count: 1 };
  }
  return { title: `${list.length} شيكات حان موعدها أو اقترب`, total, overdue, count: list.length };
}

/** مجاميع الشيكات التي لم تُصرف: { inTotal, inCount, outTotal, outCount }. */
export function chequeTotals(cheques) {
  const t = { inTotal: 0, inCount: 0, outTotal: 0, outCount: 0 };
  for (const c of cheques) {
    if (c.deleted || c.status !== 'pending') continue;
    if (c.direction === 'in') { t.inTotal += c.amount; t.inCount += 1; } else { t.outTotal += c.amount; t.outCount += 1; }
  }
  return t;
}

/** قائمة للعرض: بانتظار الصرف أولًا (الأقرب موعدًا)، ثم المنتهية (الأحدث أولًا). filter: { direction, status ('' | pending | done), query }. */
export function filterCheques(cheques, { direction = '', status = '', query = '' } = {}, normalize = (s) => String(s || '').trim()) {
  const q = normalize(query);
  return cheques.filter((c) => {
    if (c.deleted) return false;
    if (direction && c.direction !== direction) return false;
    if (status === 'pending' && c.status !== 'pending') return false;
    if (status === 'done' && c.status === 'pending') return false;
    if (!q) return true;
    return normalize(c.party_name).includes(q) || normalize(c.bank).includes(q) || String(c.number || '').includes(String(query).trim());
  }).sort((a, b) => {
    const pa = a.status === 'pending' ? 0 : 1, pb = b.status === 'pending' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (pa === 0) return String(a.due_date).localeCompare(String(b.due_date));
    return String(b.status_at || b.updated_at || '').localeCompare(String(a.status_at || a.updated_at || ''));
  });
}

/** رسالة واتساب تذكّر صاحب الشيك بموعده (مهذبة وقصيرة). */
export function chequeReminderText({ shopName, cheque, currency = 'ILS' }) {
  return `مرحبًا ${cheque.party_name || ''}،\nنذكّرك بأن ${chequeLabel(cheque)} بمبلغ ${formatMoney(cheque.amount, currency)} يستحق بتاريخ ${cheque.due_date}.\n${shopName}`.replace('مرحبًا ،', 'مرحبًا،');
}
