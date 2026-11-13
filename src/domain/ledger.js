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
