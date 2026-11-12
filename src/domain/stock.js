// المخزون ليس رقمًا يُعدَّل: كل تغيير «حركة» تُضاف ولا تُعدَّل، والرصيد مجموع الحركات.
// هذا ما يجعل المزامنة بلا إنترنت صحيحة: جهازان باعا من نفس الصنف وهما مقطوعان
// يرفع كلٌّ حركته، والمجموع صحيح على الجهازين بعد المزامنة.
import { divRound, assertInt } from './money.js';

/** أنواع الحركات واتجاه كل منها: +1 يزيد المخزون، ‎-1 ينقصه، 0 بالإشارة كما هي (جرد). */
export const MOVEMENT_TYPES = Object.freeze({
  opening: +1,         // رصيد افتتاحي
  purchase: +1,        // شراء من مورّد
  sale: -1,            // بيع
  sale_return: +1,     // مرتجع من زبون
  purchase_return: -1, // مرتجع إلى مورّد
  adjustment: 0,       // تسوية جرد (موجبة أو سالبة)
  damage: -1,          // تالف
  transfer_in: +1,     // تحويل من فرع (المرحلة 2)
  transfer_out: -1,    // تحويل إلى فرع (المرحلة 2)
});

/** الحركات التي تُدخل بضاعة بتكلفة معروفة فتدخل في متوسط التكلفة المرجّح. */
const COSTED_INFLOWS = new Set(['opening', 'purchase', 'transfer_in']);

/**
 * يضبط إشارة الكمية حسب النوع: البيع دائمًا سالب، الشراء دائمًا موجب، والتسوية كما هي.
 * qtyMilli بالوحدة الأساسية وبالألف.
 */
export function signedQty(type, qtyMilli) {
  const dir = MOVEMENT_TYPES[type];
  if (dir === undefined) throw new RangeError(`unknown movement type ${type}`);
  assertInt(qtyMilli, 'qty');
  if (dir === 0) return qtyMilli;
  return dir * Math.abs(qtyMilli);
}

/** المخزون الحالي لكل صنف من قائمة حركات: Map(product_id → كمية بالألف). */
export function stockByProduct(movements) {
  const out = new Map();
  for (const m of movements) {
    out.set(m.product_id, (out.get(m.product_id) || 0) + assertInt(m.qty, 'qty'));
  }
  return out;
}

/**
 * متوسط التكلفة المرجّح: يُحدَّث مع كل دخول بضاعة بتكلفتها.
 * state = { qty, avgCost } — avgCost بأصغر وحدة للعملة لكل وحدة أساسية واحدة.
 * إن كان المخزون صفرًا أو سالبًا (بيع قبل تسجيل الشراء) تصبح التكلفة تكلفة الدفعة الجديدة.
 */
export function applyMovement(state, m) {
  const qty = assertInt(m.qty, 'qty');
  let { qty: q, avgCost } = state;
  if (qty > 0 && COSTED_INFLOWS.has(m.type) && Number.isSafeInteger(m.unit_cost)) {
    if (q <= 0) avgCost = m.unit_cost;
    else avgCost = divRound(q * avgCost + qty * m.unit_cost, q + qty);
  }
  return { qty: q + qty, avgCost };
}

/** يطوي حركات صنف واحد (مرتبة زمنيًا) إلى {qty, avgCost}. */
export function foldProduct(movements, initial = { qty: 0, avgCost: 0 }) {
  const sorted = [...movements].sort(byTime);
  return sorted.reduce(applyMovement, initial);
}

/** ترتيب ثابت للحركات: بالوقت ثم بالمعرّف (حتى يتطابق الحساب على كل الأجهزة). */
export function byTime(a, b) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** قيمة المخزون: الكمية × سعر الوحدة (تكلفة أو بيع)، بأصغر وحدة للعملة. */
export function stockValue(qtyMilli, unitPriceMinor) {
  if (qtyMilli <= 0) return 0;
  return divRound(qtyMilli * unitPriceMinor, 1000);
}

/** حالة التنبيه لصنف: 'out' نفد، 'low' منخفض، null سليم. */
export function stockLevel(qtyMilli, thresholdMilli) {
  if (qtyMilli <= 0) return 'out';
  if (thresholdMilli > 0 && qtyMilli <= thresholdMilli) return 'low';
  return null;
}
