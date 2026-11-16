// الوحدات والكميات. الكمية عدد صحيح بالألف (QTY_SCALE): 1.5 متر → 1500.
// المخزون يُحفظ دائمًا بالوحدة الأساسية للصنف؛ العبوات (كرتونة = 24 قطعة) تحويل فقط.
import { divRound, formatDecimal, parseDecimal, assertInt } from './money.js';

export const QTY_SCALE = 1000;
export const ONE = QTY_SCALE;

export const UNITS = Object.freeze({
  piece: Object.freeze({ id: 'piece', name: 'قطعة', short: 'قطعة', measured: false }),
  meter: Object.freeze({ id: 'meter', name: 'متر', short: 'م', measured: true }),
  kg: Object.freeze({ id: 'kg', name: 'كيلو', short: 'كغ', measured: true }),
  gram: Object.freeze({ id: 'gram', name: 'غرام', short: 'غ', measured: true }),
  liter: Object.freeze({ id: 'liter', name: 'لتر', short: 'ل', measured: true }),
});

export function unit(id) {
  return UNITS[id] || UNITS.piece;
}

/** "1.5" → 1500 ؛ null إن لم تكن كمية صالحة. */
export function parseQty(text) {
  return parseDecimal(text, 3);
}

/** 1500 → "1.5" ؛ 2000 → "2" */
export function formatQty(milli) {
  return formatDecimal(milli, 3, { trim: true });
}

/** سعر الوحدة × الكمية → إجمالي السطر بأصغر وحدة للعملة. */
export function lineAmount(unitPriceMinor, qtyMilli) {
  return divRound(assertInt(unitPriceMinor) * assertInt(qtyMilli), QTY_SCALE);
}

/** كمية بالعبوة → كمية بالوحدة الأساسية. عبوة factor=24000 (24 قطعة)، كمية 2000 (2 كرتونة) → 48000. */
export function packToBase(qtyMilli, factorMilli) {
  return divRound(assertInt(qtyMilli) * assertInt(factorMilli), QTY_SCALE);
}

/** العكس: كمية أساسية → كم عبوة (قد تكون كسرًا). */
export function baseToPack(baseMilli, factorMilli) {
  if (!factorMilli) throw new RangeError('factor must be > 0');
  return divRound(assertInt(baseMilli) * QTY_SCALE, assertInt(factorMilli));
}

/** سعر الوحدة الأساسية من سعر العبوة (لحساب التكلفة عند الشراء بالكرتونة). */
export function perBaseUnitPrice(packPriceMinor, factorMilli) {
  return divRound(assertInt(packPriceMinor) * QTY_SCALE, assertInt(factorMilli));
}

// ---------- العبوة الرئيسية: التاجر يفكر بالكرتونة، والمخزون بالقطعة ----------
/** العبوة التي سعّر بها التاجر (لها سعر بيع)، وإلا الأكبر. null إن لا عبوات. */
export function mainPack(units) {
  const live = (units || []).filter((u) => !u.deleted && u.factor > QTY_SCALE);
  if (!live.length) return null;
  return live.find((u) => Number.isSafeInteger(u.sell_price)) || live.reduce((a, b) => (b.factor > a.factor ? b : a));
}

/** يقسم الكمية (بالألف) إلى عبوات كاملة وباقٍ بالوحدة: 46 قطعة وكرتونة 24 ← { packs: 1, rest: 22000 }. */
export function splitByPack(qtyMilli, factor) {
  if (!(factor > QTY_SCALE) || qtyMilli <= 0) return { packs: 0, rest: qtyMilli };
  const packs = Math.floor(qtyMilli / factor);
  return { packs, rest: qtyMilli - packs * factor };
}

/** «1 كرتونة و22 قطعة» / «3 كرتونة» / «22 قطعة» (بلا عبوة: الكمية بوحدتها). */
export function packQtyText(qtyMilli, pack, unitId = 'piece') {
  const u = unit(unitId).short;
  if (!pack || qtyMilli <= 0) return `${formatQty(qtyMilli)} ${u}`;
  const { packs, rest } = splitByPack(qtyMilli, pack.factor);
  if (!packs) return `${formatQty(rest)} ${u}`;
  return rest ? `${packs} ${pack.name} و${formatQty(rest)} ${u}` : `${packs} ${pack.name}`;
}
