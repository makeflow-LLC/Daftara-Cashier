// إغلاق الصندوق (نقي): المتوقع في الدرج = نقد أول اليوم + النقد الداخل − النقد الخارج، ومقارنته بالمعدود فعلًا.
// وباقي طرق الدفع (تحويل، محافظ، آجل) تُعرض مجاميعها للمراجعة.
import { sum } from './money.js';
import { formatMoney } from './currency.js';
import { dateTimeText } from './invoice.js';

/**
 * payments: دفعات الفترة. methodNames: Map(id → اسم).
 * يرجع { opening, cashIn, cashOut, expectedCash, methods: [{ key, name, kind, total }], credit }.
 */
export function sessionSummary({ opening = 0, payments = [], methodNames = new Map() }) {
  const cash = payments.filter((p) => p.method_kind === 'cash');
  const cashIn = sum(cash.filter((p) => p.direction === 'in'), (p) => p.amount);
  const cashOut = sum(cash.filter((p) => p.direction === 'out'), (p) => p.amount);
  const by = new Map();
  for (const p of payments) {
    if (p.method_kind !== 'transfer') continue;
    const key = p.method_id || 'transfer';
    const row = by.get(key) || { key, name: methodNames.get(p.method_id) || 'تحويل', kind: 'transfer', total: 0 };
    row.total += p.direction === 'in' ? p.amount : -p.amount;
    by.set(key, row);
  }
  const credit = sum(payments.filter((p) => p.method_kind === 'credit' && p.direction === 'in'), (p) => p.amount);
  return { opening, cashIn, cashOut, expectedCash: opening + cashIn - cashOut, methods: [...by.values()], credit };
}

/** نتيجة العدّ: الفرق موجب = زيادة، سالب = عجز. */
export function closingResult(expectedCash, counted) {
  const difference = counted - expectedCash;
  return { difference, state: difference === 0 ? 'match' : difference > 0 ? 'over' : 'short' };
}

export const STATE_LABEL = Object.freeze({ match: 'الصندوق مطابق', over: 'زيادة في الصندوق', short: 'عجز في الصندوق' });

/** ملخص الإغلاق نصًا (يرسله الكاشير لصاحب المحل على واتساب). */
export function closingText({ shopName, session, summary, currency = 'ILS' }) {
  const m = (v) => formatMoney(v, currency);
  const r = closingResult(summary.expectedCash, session.counted_cash);
  const out = [`*إغلاق صندوق ${shopName}*`, `من ${dateTimeText(session.opened_at)} إلى ${dateTimeText(session.closed_at)}`,
    `نقد أول اليوم: ${m(summary.opening)}`, `دخل نقدًا: ${m(summary.cashIn)}`, `خرج نقدًا: ${m(summary.cashOut)}`,
    `المتوقع في الدرج: ${m(summary.expectedCash)}`, `المعدود فعلًا: ${m(session.counted_cash)}`,
    `*${STATE_LABEL[r.state]}${r.difference ? `: ${m(Math.abs(r.difference))}` : ''}*`];
  for (const x of summary.methods) out.push(`${x.name}: ${m(x.total)}`);
  if (summary.credit) out.push(`بيع آجل: ${m(summary.credit)}`);
  return out.join('\n');
}
