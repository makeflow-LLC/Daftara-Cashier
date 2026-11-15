// رسائل SMS للزبائن (نقي): القوالب، تعبئتها، وعدد أجزاء الرسالة (كل جزء يُحسب على رصيد الشريحة).
import { formatMoney } from './currency.js';

/** الأحداث التي يمكن أن تُرسل عندها رسالة تلقائيًا (كلها مطفأة حتى يشغّلها صاحب المحل). */
export const SMS_EVENTS = Object.freeze([
  { key: 'debt', label: 'عند تسجيل دين جديد' },
  { key: 'sale_credit', label: 'عند البيع بالآجل' },
  { key: 'payment', label: 'عند استلام دفعة' },
]);

export const DEFAULT_TEMPLATES = Object.freeze({
  debt: '{الاسم}، سُجّل عليك {المبلغ} في {المحل}. رصيدك الآن {الرصيد}.',
  sale_credit: '{الاسم}، فاتورة بالآجل بـ {المبلغ} من {المحل}. رصيدك الآن {الرصيد}.',
  payment: '{الاسم}، شكرًا لك! استلمنا {المبلغ}. الباقي عليك {الرصيد}. — {المحل}',
  reminder: '{الاسم}، تذكير لطيف من {المحل}: عليك {الرصيد}. شكرًا لتعاملك معنا.',
});

export const PLACEHOLDERS = Object.freeze(['{الاسم}', '{المبلغ}', '{الرصيد}', '{المحل}', '{التاريخ}', '{منذ}']);

/** إعدادات افتراضية: الميزة مطفأة، والقوالب جاهزة. */
export function smsSettings(saved) {
  const s = saved || {};
  return {
    enabled: !!s.enabled,
    events: { debt: false, sale_credit: false, payment: false, ...(s.events || {}) },
    templates: { ...DEFAULT_TEMPLATES, ...(s.templates || {}) },
  };
}

/** يعبّئ القالب. balance: رصيد الزبون بعد الحركة. */
export function renderSms(template, { name, amount = 0, balance = 0, shop, currency = 'ILS', date = new Date(), days = 0 }) {
  const money = (v) => formatMoney(Math.abs(v), currency);
  const bal = balance > 0 ? money(balance) : balance < 0 ? `${money(balance)} لك عندنا` : 'لا شيء';
  const d = date instanceof Date ? date : new Date(date);
  return String(template || '')
    .split('{الاسم}').join(name || '')
    .split('{المبلغ}').join(money(amount))
    .split('{الرصيد}').join(bal)
    .split('{المحل}').join(shop || '')
    .split('{التاريخ}').join(`${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`)
    .split('{منذ}').join(days === 1 ? 'يوم واحد' : days === 2 ? 'يومين' : days >= 3 && days <= 10 ? `${days} أيام` : `${days} يومًا`)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** عدد أجزاء SMS: العربية (UCS-2) 70 حرفًا للجزء الواحد، و67 لكل جزء إن زادت. */
export function smsParts(text) {
  const t = String(text || '');
  const gsm = /^[\x20-\x7E\n\r]*$/.test(t);
  const one = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const n = [...t].length;
  if (!n) return 0;
  return n <= one ? 1 : Math.ceil(n / multi);
}

/** رابط يفتح تطبيق الرسائل جاهزًا (حين لا يوجد إرسال تلقائي). */
export function smsLink(phone, text) {
  return `sms:+${phone}?body=${encodeURIComponent(text)}`;
}
