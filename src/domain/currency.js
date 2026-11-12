// العملات وأسعار الصرف. سعر الصرف عدد صحيح بالمليون (RATE_SCALE):
// 1 دولار = 3.65 شيكل → 3650000. لا float.
import { divRound, formatDecimal, parseDecimal, assertInt } from './money.js';

export const RATE_SCALE = 1_000_000;

export const CURRENCIES = Object.freeze({
  ILS: Object.freeze({ code: 'ILS', symbol: '₪', name: 'شيكل', minor: 2 }),
  USD: Object.freeze({ code: 'USD', symbol: '$', name: 'دولار', minor: 2 }),
  JOD: Object.freeze({ code: 'JOD', symbol: 'د.أ', name: 'دينار', minor: 3 }),
});

export const DEFAULT_CURRENCY = 'ILS';
export const EXTRA_CURRENCIES = ['USD', 'JOD'];

export function currency(code) {
  const c = CURRENCIES[code];
  if (!c) throw new RangeError(`unknown currency ${code}`);
  return c;
}

/** "12.5" بالعملة code → أصغر وحدة (1250 أغورة). */
export function parseMoney(text, code = DEFAULT_CURRENCY) {
  return parseDecimal(text, currency(code).minor);
}

/** 1250 → "12.50 ₪" (أرقام غربية دائمًا). */
export function formatMoney(minor, code = DEFAULT_CURRENCY, { symbol = true, trim = false } = {}) {
  const c = currency(code);
  const s = formatDecimal(minor, c.minor, { trim });
  return symbol ? `${s} ${c.symbol}` : s;
}

/** "3.65" → 3650000 */
export function parseRate(text) {
  const r = parseDecimal(text, 6);
  return r && r > 0 ? r : null;
}

/**
 * يحوّل مبلغًا (بأصغر وحدة) من عملة إلى العملة الأساسية بسعر صرف (عدد العملة الأساسية لكل 1 من العملة).
 * convertToBase(1000 سنت = 10$, 'USD', 3650000, 'ILS') → 3650 أغورة.
 */
export function convertToBase(amountMinor, fromCode, rate, baseCode = DEFAULT_CURRENCY) {
  assertInt(amountMinor); assertInt(rate, 'rate');
  if (fromCode === baseCode) return amountMinor;
  const from = currency(fromCode), base = currency(baseCode);
  const num = BigInt(amountMinor) * BigInt(rate) * 10n ** BigInt(base.minor);
  const den = 10n ** BigInt(from.minor) * BigInt(RATE_SCALE);
  return Number(divRound(num, den));
}

/** العكس: مبلغ بالعملة الأساسية → العملة الأخرى. */
export function convertFromBase(baseMinor, toCode, rate, baseCode = DEFAULT_CURRENCY) {
  assertInt(baseMinor); assertInt(rate, 'rate');
  if (toCode === baseCode) return baseMinor;
  const to = currency(toCode), base = currency(baseCode);
  const num = BigInt(baseMinor) * BigInt(RATE_SCALE) * 10n ** BigInt(to.minor);
  const den = BigInt(rate) * 10n ** BigInt(base.minor);
  return Number(divRound(num, den));
}
