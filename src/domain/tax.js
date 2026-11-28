// الضريبة (نقي): ضريبة القيمة المضافة على المبيعات والمشتريات، لمن هو «مشتغل مرخّص». مطفأة لمن لا يحتاجها.
// الإعداد في settings.tax للمحل: { enabled, rate (نقاط أساس: 1600 = 16%), inclusive (أسعار البيع شاملة الضريبة), number, name }
//   شاملة (الغالب في محلات التجزئة): السعر كما هو، والضريبة جزء منه تُحسب للدولة.
//   مضافة: الضريبة تُزاد فوق مجموع الفاتورة.
// الضريبة لا تدخل في ربح المحل: مبلغ يحصّله من الزبون ويدفعه للدائرة بعد طرح ضريبة مشترياته.
import { divRound } from './money.js';

export const DEFAULT_TAX_RATE = 1600;
export const DEFAULT_TAX_NAME = 'ضريبة القيمة المضافة';

/** إعداد الضريبة بعد التنظيف، أو null إن كانت مطفأة. */
export function taxConfig(settings) {
  const t = settings && settings.tax;
  if (!t || !t.enabled) return null;
  const rate = Number.isSafeInteger(t.rate) && t.rate > 0 && t.rate <= 10000 ? t.rate : DEFAULT_TAX_RATE;
  return {
    rate, inclusive: t.inclusive !== false,
    number: String(t.number ?? '').trim().slice(0, 30) || null,
    name: String(t.name ?? '').trim().slice(0, 40) || DEFAULT_TAX_NAME,
  };
}

/** رسالة خطأ أو null. rate بنقاط الأساس. */
export function taxProblem({ rate }) {
  if (!Number.isSafeInteger(rate) || rate <= 0 || rate > 10000) return 'اكتب نسبة الضريبة (مثل 16)';
  return null;
}

/** '16%' أو '7.5%' من نقاط الأساس. */
export function rateText(rate) {
  const v = rate / 100;
  return `${Number.isInteger(v) ? v : String(Math.round(v * 100) / 100)}%`;
}

/**
 * ضريبة مبلغ: inclusive ← المبلغ يشملها (تُستخرج منه)، وإلا تُضاف فوقه.
 * يرجع { net: قبل الضريبة, tax, gross: مع الضريبة }.
 */
export function taxOn(amount, rate, inclusive) {
  if (!rate || amount <= 0) return { net: amount, tax: 0, gross: amount };
  if (inclusive) { const tax = divRound(amount * rate, 10000 + rate); return { net: amount - tax, tax, gross: amount }; }
  const tax = divRound(amount * rate, 10000);
  return { net: amount, tax, gross: amount + tax };
}

/** سعر قبل الضريبة من سعر شامل لها (تكلفة الوحدة في فاتورة تاجر أسعارها شاملة). */
export function netOfTax(gross, rate) {
  return rate ? divRound(gross * 10000, 10000 + rate) : gross;
}

/** ضريبة جزء من فاتورة (مرتجع): حصة part من base. */
export function taxShare(tax, part, base) {
  if (!tax || !base) return 0;
  return part >= base ? tax : divRound(tax * part, base);
}

/** الضريبة المضافة فوق مجموع الفاتورة (صفر إن كانت أسعارها شاملة الضريبة أو بلا ضريبة). */
export function taxOnTop(invoice) {
  const tax = invoice.tax || 0;
  if (!tax) return 0;
  return Math.min(tax, Math.max(0, (invoice.total || 0) - ((invoice.subtotal || 0) - (invoice.discount || 0))));
}

/**
 * ضريبة مرتجع من فاتورة (بيع أو شراء) وما يُرد فوق صافيه، محسوبة تراكميًا: حصة كل ما رُجع حتى الآن ناقص ما رُدّ
 * في المرتجعات السابقة — فمجموع المرتجعات الجزئية لا يتجاوز ضريبة الفاتورة ولا ينقص عنها بقرش.
 * base: صافي الفاتورة قبل الضريبة المضافة (subtotal − discount). net: صافي هذا المرتجع.
 * prior: مجموع المرتجعات السابقة { net, tax, top } (top = ما رُدّ فوق الصافي).
 * يرجع { tax, top, total: net + top }.
 */
export function returnTax(original, base, net, prior = {}) {
  const pn = prior.net || 0, pt = prior.tax || 0, pp = prior.top || 0;
  const tax = Math.max(0, taxShare(original.tax || 0, pn + net, base) - pt);
  const top = Math.max(0, taxShare(taxOnTop(original), pn + net, base) - pp);
  return { tax, top, total: net + top };
}

/** مجموع مرتجعات سابقة (فواتير مرتجع) بصيغة prior لـ returnTax. */
export function priorReturns(returns = []) {
  let net = 0, tax = 0, top = 0;
  for (const r of returns) { net += r.subtotal || 0; tax += r.tax || 0; top += (r.total || 0) - (r.subtotal || 0); }
  return { net, tax, top };
}
