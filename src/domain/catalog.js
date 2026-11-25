// كتالوج المحل للزبائن (shop.html) — المنطق النقي: كل صنف يُطلب بوحدته.
// القطعة تُعدّ 1، 2، 3؛ والكيلو بأرباعه، والأوقية بأنصافها، والغرام بالخمسينات — كما يطلب الناس في المحل.
// الكميات بالألف (QTY_SCALE) كما في باقي التطبيق.
import { unit as unitOf, formatQty, lineAmount, QTY_SCALE } from './units.js';

export const MAX_ORDER_QTY = 999 * QTY_SCALE;

// first: ما تضيفه أول ضغطة «أضف للطلب»، step: مقدار + و −
const STEPS = Object.freeze({
  piece: { first: 1000, step: 1000 },
  kg: { first: 1000, step: 250 },
  ounce: { first: 1000, step: 500 },
  gram: { first: 100000, step: 50000 },
  meter: { first: 1000, step: 500 },
  liter: { first: 1000, step: 500 },
});

export function orderStep(unitId) {
  return STEPS[unitOf(unitId).id];
}

/** الكمية بعد ضغطة + (dir = 1) أو − (dir = -1). صفر = خرج من الطلب. */
export function nextQty(unitId, qty, dir) {
  const { first, step } = orderStep(unitId);
  if (dir > 0) return qty > 0 ? Math.min(qty + step, MAX_ORDER_QTY) : first;
  const n = qty - step;
  return n >= step ? n : 0;
}

/** كمية محفوظة في سلة الزبون: صالحة لهذه الوحدة أم تُهمل؟ */
export function validQty(unitId, qty) {
  const { step } = orderStep(unitId);
  return Number.isSafeInteger(qty) && qty >= step && qty <= MAX_ORDER_QTY && qty % step === 0;
}

/** «2» للقطعة؛ «1.5 كيلو»، «نصف أوقية»، «ربع كيلو»، «150 غرام» للموزون والمقاس. */
export function qtyText(unitId, qty) {
  const u = unitOf(unitId);
  if (!u.measured) return formatQty(qty);
  if (u.id !== 'gram' && qty === 250) return `ربع ${u.name}`;
  if (u.id !== 'gram' && qty === 500) return `نصف ${u.name}`;
  return `${formatQty(qty)} ${u.name}`;
}

/** وسم على بطاقة الصنف يفرّق الموزون عن المعدود: «بالكيلو»، «بالأوقية»… ولا شيء للقطعة. */
export function unitBadge(unitId) {
  const u = unitOf(unitId);
  return u.measured ? `ب${u.name.startsWith('ال') ? u.name.slice(2) : `ال${u.name}`}` : null;
}

/** اسم الوحدة بعد السعر: «18 ₪ / كيلو». null للقطعة. */
export function priceUnit(unitId) {
  const u = unitOf(unitId);
  return u.measured ? u.name : null;
}

export function lineTotal(price, qty) {
  return lineAmount(price, qty);
}

/** الأصناف المختارة المتوفرة مع إجمالي كل سطر: [{ p, qty, total }]. */
export function chosenItems(products, cart) {
  const out = [];
  for (const p of products) {
    const qty = cart[p.id];
    if (p.available && validQty(p.unit, qty)) out.push({ p, qty, total: lineTotal(p.price, qty) });
  }
  return out;
}

/** سطر في الطلب: «زيت × 2» للقطعة، «زعتر — نصف أوقية» للموزون. */
export function itemText(p, qty) {
  return unitOf(p.unit).measured ? `${p.name} — ${qtyText(p.unit, qty)}` : `${p.name} × ${qtyText(p.unit, qty)}`;
}

/** رسالة الطلب التي تصل واتساب المحل. money: دالة تنسيق المبلغ. */
export function orderText({ shopName, items, name = '', note = '', money }) {
  const lines = [`مرحبًا ${shopName}، أريد أن أطلب:`];
  items.forEach((x, i) => lines.push(`${i + 1}. ${itemText(x.p, x.qty)} = ${money(x.total)}`));
  lines.push(`المجموع: ${money(items.reduce((a, x) => a + x.total, 0))}`);
  if (name) lines.push(`الاسم: ${name}`);
  if (note) lines.push(`ملاحظة: ${note}`);
  lines.push('(من كتالوج المحل)');
  return lines.join('\n');
}

/** عنوان صورة الصنف في Storage (المصغّرة للشبكة، الكاملة عند الضغط). null إن لا صورة أو مسار غريب. */
export function imageUrl(supabaseUrl, path, { full = false } = {}) {
  if (!supabaseUrl || !/^[0-9a-f-]{36}\/products\/[0-9a-f-]{36}\.webp$/i.test(path || '')) return null;
  return `${supabaseUrl}/storage/v1/object/authenticated/cashier-media/${full ? path : path.replace(/\.webp$/, '_t.webp')}`;
}
