// دفتر الزبون (نقي): الرصيد = مجموع القيود (دين +، دفعة −، مرتجع −). كشف الحساب، رسائل واتساب،
// أرقام الجوال، وقراءة ملف نسخة «دفترة» للاستيراد.
import { sum, assertInt } from './money.js';
import { formatMoney } from './currency.js';

export const DEFAULT_COUNTRY_CODE = '970';

export const ENTRY_LABELS = Object.freeze({
  opening: 'رصيد سابق', sale_credit: 'بيع آجل', payment: 'دفعة', return_credit: 'مرتجع',
  adjustment: 'دين', import: 'رصيد من دفترة',
});

export function balanceOf(entries) {
  return sum(entries, (e) => e.amount);
}

/** كشف الحساب: القيود من الأقدم للأحدث مع الرصيد بعد كل قيد. */
export function statement(entries) {
  let run = 0;
  return [...entries]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    .map((e) => { run += assertInt(e.amount, 'amount'); return { ...e, balance: run }; });
}

// ---------- التصحيح: القيود لا تُعدَّل ولا تُحذف (لا يضيع أثر)، بل يُضاف قيد عكسي ----------
// القيد العكسي ملاحظته «void:<رقم القيد الأصلي>». الرصيد = مجموع كل القيود كما هو دائمًا،
// والعرض يُخفي القيد العكسي ويُظهر الأصلي «ملغى». إلغاء الإلغاء (تراجع) يعيد الأصلي.
export const VOID_PREFIX = 'void:';
export const isVoidEntry = (e) => typeof e.note === 'string' && e.note.startsWith(VOID_PREFIX);

/** أرقام القيود الملغاة فعلًا (قيد عكسي غير ملغى يشير إليها). */
export function cancelledIds(entries) {
  const voidsOf = new Map();
  for (const e of entries) if (isVoidEntry(e)) {
    const t = e.note.slice(VOID_PREFIX.length);
    if (!voidsOf.has(t)) voidsOf.set(t, []);
    voidsOf.get(t).push(e);
  }
  const memo = new Map();
  const cancelled = (id, depth = 0) => {
    if (memo.has(id)) return memo.get(id);
    if (depth > 50) return false;
    const r = (voidsOf.get(id) || []).some((v) => !cancelled(v.id, depth + 1));
    memo.set(id, r);
    return r;
  };
  return new Set(entries.filter((e) => cancelled(e.id)).map((e) => e.id));
}

/** القيود الفعلية: بلا القيود العكسية ولا ما ألغته. مجموعها = الرصيد نفسه. */
export function effectiveEntries(entries) {
  const gone = cancelledIds(entries);
  return entries.filter((e) => !isVoidEntry(e) && !gone.has(e.id));
}

/** كشف للعرض: الأحدث أولًا، الملغى يظهر بعلامة cancelled ولا يدخل في الرصيد الجاري. */
export function ledgerView(entries) {
  const gone = cancelledIds(entries);
  let run = 0;
  return [...entries]
    .filter((e) => !isVoidEntry(e))
    // نفس الوقت (قيد مُعدَّل حلّ مكان الأصلي): الملغى قبله، فيظهر المعدَّل فوقه
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (gone.has(b.id) ? 1 : 0) - (gone.has(a.id) ? 1 : 0)))
    .map((e) => {
      if (gone.has(e.id)) return { ...e, cancelled: true, balance: run };
      run += assertInt(e.amount, 'amount');
      return { ...e, cancelled: false, balance: run };
    })
    .reverse();
}

/** قيد يُعدَّل من كشف الزبون؟ (قيود الفواتير تُصحَّح بالمرتجع من الفاتورة نفسها) */
export const editableEntry = (e) => !e.invoice_id && !isVoidEntry(e) && !e.cancelled;

/** عمر أقدم دين لم يُسدَّد (الدفعات تسدّد الأقدم أولًا). null إن لم يكن عليه شيء. */
export function oldestUnpaidAt(entries) {
  const rows = statement(entries);
  let credit = -sum(rows.filter((e) => e.amount < 0), (e) => e.amount);
  for (const e of rows) {
    if (e.amount <= 0) continue;
    if (credit >= e.amount) { credit -= e.amount; continue; }
    return e.created_at;
  }
  return null;
}

/** رقم واتساب دولي بلا +: 0599123456 → 970599123456. يرجع '' إن لم يصلح. */
export function normalizePhone(raw, cc = DEFAULT_COUNTRY_CODE) {
  const s = String(raw || '').trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  let intl = /^\+/.test(s);
  let d = s.replace(/\D/g, '');
  if (!d) return '';
  if (!intl && d.startsWith('00')) { d = d.slice(2); intl = true; }
  if (intl) {
    d = d.replace(/^0+/, '');
    return d.startsWith(cc) || d.length >= 10 ? d : cc + d;
  }
  if (d.startsWith(cc)) return d;
  d = d.replace(/^0+/, '');
  if (d.length < 7) return '';
  return d.length >= 11 ? d : cc + d;
}

export function whatsappLink(phone, text) {
  const p = normalizePhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** رسالة تذكير قصيرة ومهذبة. */
export function reminderText({ shopName, customerName, balance, currency = 'ILS' }) {
  return `مرحبًا ${customerName}،\nنذكّرك بأن رصيدك المستحق لدى ${shopName} هو ${formatMoney(balance, currency)}.\nشكرًا لك.`;
}

/** كشف حساب نصي (آخر limit قيدًا) للإرسال على واتساب. */
export function statementText({ shopName, customerName, entries, currency = 'ILS', limit = 15, formatDate = (iso) => iso.slice(0, 10) }) {
  const rows = statement(entries);
  const shown = rows.slice(-limit);
  const lines = [`كشف حساب ${customerName} — ${shopName}`];
  if (rows.length > shown.length) lines.push(`رصيد سابق: ${formatMoney(rows[rows.length - shown.length - 1].balance, currency)}`);
  for (const e of shown) {
    const sign = e.amount >= 0 ? '+' : '−';
    lines.push(`${formatDate(e.created_at)}  ${ENTRY_LABELS[e.type] || ''}${e.note ? ` (${e.note})` : ''}  ${sign}${formatMoney(Math.abs(e.amount), currency, { symbol: false })}`);
  }
  const bal = rows.length ? rows[rows.length - 1].balance : 0;
  lines.push(`الرصيد المستحق: ${formatMoney(bal, currency)}`);
  return lines.join('\n');
}

// ---------- دفتر التاجر (ما على المحل لتجار الجملة والموردين): نفس القيود بإشارة معكوسة المعنى ----------
// amount موجب = يزيد ما عليك للتاجر (بضاعة بالدين، رصيد سابق)، سالب = ينقصه (دفعة له، مرتجع).
export const SUPPLIER_ENTRY_LABELS = Object.freeze({
  opening: 'رصيد سابق', purchase: 'فاتورة شراء', payment: 'دفعة له', return: 'مرتجع', adjustment: 'بضاعة بالدين',
});

/** كشف حسابك عند التاجر نصًا (آخر limit قيدًا) لترسله له على واتساب وتطابقا الحساب. */
export function supplierStatementText({ shopName, supplierName, entries, currency = 'ILS', limit = 15, formatDate = (iso) => iso.slice(0, 10) }) {
  const rows = statement(entries);
  const shown = rows.slice(-limit);
  const lines = [`مرحبًا ${supplierName}،`, `كشف حساب ${shopName} عندك حسب دفاتري:`];
  if (rows.length > shown.length) lines.push(`رصيد سابق: ${formatMoney(rows[rows.length - shown.length - 1].balance, currency)}`);
  for (const e of shown) {
    const sign = e.amount >= 0 ? '+' : '−';
    lines.push(`${formatDate(e.created_at)}  ${SUPPLIER_ENTRY_LABELS[e.type] || ''}${e.note ? ` (${e.note})` : ''}  ${sign}${formatMoney(Math.abs(e.amount), currency, { symbol: false })}`);
  }
  const bal = rows.length ? rows[rows.length - 1].balance : 0;
  lines.push(bal >= 0 ? `الباقي لك عندي: ${formatMoney(bal, currency)}` : `لي عندك: ${formatMoney(-bal, currency)}`);
  lines.push('إن كان عندك رقم مختلف أخبرني لنطابق الحساب.');
  return lines.join('\n');
}

/**
 * يقرأ ملف نسخة «دفترة» (daftara-backup-*.json): الزبائن وأرصدتهم (ديون − دفعات).
 * مبالغ دفترة بالشيكل كأرقام عشرية؛ نحوّلها إلى أغورات صحيحة. يرمي خطأ بالعربية إن لم يكن الملف ملف دفترة.
 */
export function parseDaftaraBackup(data) {
  if (!data || typeof data !== 'object' || data.app !== 'daftara' || !Array.isArray(data.customers) || !Array.isArray(data.transactions)) {
    throw new Error('هذا ليس ملف نسخة من دفترة');
  }
  const toMinor = (v) => Math.round(Number(v) * 100);
  const bal = new Map();
  const keyOf = (t) => t.customerUid || `id:${t.customerId}`;
  for (const t of data.transactions) {
    if (t.deleted || !Number.isFinite(Number(t.amount))) continue;
    const m = toMinor(t.amount);
    bal.set(keyOf(t), (bal.get(keyOf(t)) || 0) + (t.type === 'payment' ? -m : m));
  }
  const out = [];
  for (const c of data.customers) {
    if (c.deleted || !c.name || !String(c.name).trim()) continue;
    const balance = (bal.get(c.uid) || 0) + (bal.get(`id:${c.id}`) || 0);
    out.push({ ref: c.uid || `id:${c.id}`, name: String(c.name).trim(), phone: c.phone ? String(c.phone).trim() : null, note: c.note ? String(c.note).trim() : null, balance });
  }
  return out;
}
