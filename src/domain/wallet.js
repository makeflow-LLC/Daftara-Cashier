// الاستلام بالمحفظة برمز QR — منطق نقي: توحيد رقم المحفظة، المبلغ، كود USSD، ورابط tel: الذي يحمله الرمز.
// لا خادم ولا API: الزبون يمسح الرمز بكاميرا جواله فيفتح تطبيق الاتصال والكود جاهز، فيضغط «اتصال» ويؤكد برقمه السري.
import { normalizeDigits, parseDecimal, formatDecimal } from './money.js';

// صيغ الأكواد (فلسطين). الترتيب هنا هو ترتيب العرض.
export const WALLETS = Object.freeze({
  // methods: أسماء طريقة الدفع التي يُسجَّل تحتها الاستلام (الأول = اسم المحفظة الجاهزة في domain/features.js)
  jawwal: Object.freeze({ id: 'jawwal', name: 'جوال باي', prefix: '*268*1*', methods: Object.freeze(['جوال باي']) }),
  palpay: Object.freeze({ id: 'palpay', name: 'بال باي', prefix: '*370*1*1*', methods: Object.freeze(['محفظة بال باي', 'بال باي']) }),
});

/**
 * رقم المحفظة بأي صيغة يكتبها صاحب المحل ← 05XXXXXXXX، أو null إن لم يكن رقمًا صحيحًا.
 * +970 594 989-710، 00970594989710، 970594989710، 594989710، ٠٥٩٤٩٨٩٧١٠ ← 0594989710
 */
export function normalizeWalletNumber(raw) {
  let s = normalizeDigits(String(raw ?? '')).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0)).replace(/\D/g, '');
  if (s.startsWith('00970')) s = `0${s.slice(5)}`;
  else if (s.startsWith('970')) s = `0${s.slice(3)}`;
  if (s.startsWith('00')) s = s.slice(1); // 970 ثم 0594… (كُتب الصفر بعد المقدمة)
  if (/^5\d{8}$/.test(s)) s = `0${s}`;
  return /^05\d{8}$/.test(s) ? s : null;
}

/**
 * المبلغ كما يُكتب في الكود: أرقام لاتينية، خانتان عشريتان على الأكثر، بلا أصفار زائدة (10 لا 10.00).
 * يرجع { cents, text } أو null إن كان فارغًا أو صفرًا أو غير صحيح.
 */
export function walletAmount(input) {
  const cents = typeof input === 'number' ? input : parseDecimal(String(input ?? '').trim(), 2);
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return { cents, text: formatDecimal(cents, 2, { trim: true, group: false }) };
}

/** كود USSD: جوال باي *268*1*<المحفظة>*<المبلغ># ، بال باي *370*1*1*<المحفظة>*<المبلغ># . null إن نقص شيء. */
export function ussdCode(walletId, number, amount) {
  const w = WALLETS[walletId];
  const n = normalizeWalletNumber(number);
  const a = walletAmount(amount);
  if (!w || !n || !a) return null;
  return `${w.prefix}${n}*${a.text}#`;
}

/** رابط الاتصال الذي يحمله الرمز. # تُكتب %23 وإلا قُطع الكود عندها؛ النجمة تبقى كما هي. */
export function telUri(code) {
  return code ? `tel:${code.replace(/#/g, '%23')}` : null;
}

/** محافظ المحل المكتوبة في الإعدادات: [{ id, name, number }] (فارغة = الميزة غير مفعّلة). */
export function shopWallets(settings) {
  const saved = (settings && settings.wallets) || {};
  return Object.values(WALLETS)
    .map((w) => ({ id: w.id, name: w.name, number: normalizeWalletNumber(saved[w.id]) }))
    .filter((w) => w.number);
}
