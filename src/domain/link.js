// ربط الحبة بالكرتونة (نقي): التاجر أدخل الكرتونة صنفًا (بباركودها)، ثم مسح باركود الحبة التي بداخلها
// عند البيع. بدل صنفين منفصلين يصير صنفًا واحدًا: يُباع بالحبة، والكرتونة عبوته (24 حبة).
// إن كانت الحبة قد سُجّلت صنفًا مكررًا، يُدمج فيه: مخزونها يُنقل وتُحذف هي.
// المخزون يبقى حركات (لا يُعدَّل رقم): تسوية تُخرج الكراتين، ثم رصيد بالحبات بتكلفة الحبة فيصح متوسط التكلفة.
import { divRound } from './money.js';
import { QTY_SCALE } from './units.js';

/**
 * carton:      الصنف الذي يمثل الكرتونة (أو صار له عبوة كرتونة من قبل)
 * cartonPack:  عبوته الرئيسية إن وُجدت (أُدخل بالكرتونة من البداية: مخزونه بالحبة أصلًا)
 * cartonStock: { qty, avgCost } من ذاكرة المخزون
 * piece / pieceStock: الصنف المكرر للحبة (اختياري) ومخزونه
 * pieceBarcode: باركود الحبة الممسوح (أو باركود الصنف المكرر)
 * count: كم حبة في الكرتونة (بالألف: 24000)، piecePrice: سعر بيع الحبة (null = سعر الكرتونة ÷ العدد)
 * يرجع { product, pack, movements: [{product_id, type, qty, unit_cost, note}], removeId, preview } أو يرمي خطأ بالعربية.
 */
export function linkPlan({ carton, cartonPack = null, cartonStock = { qty: 0, avgCost: 0 }, piece = null, pieceStock = { qty: 0, avgCost: 0 }, pieceBarcode = null, count, piecePrice = null, packName = 'كرتونة', makeId }) {
  if (!carton) throw new Error('اختر الكرتونة');
  if (piece && piece.id === carton.id) throw new Error('اختر صنفين مختلفين');
  if (carton.unit && carton.unit !== 'piece') throw new Error('الربط للأصناف التي تُباع بالقطعة');
  if (!Number.isSafeInteger(count) || count <= QTY_SCALE || count % QTY_SCALE) throw new Error('اكتب كم حبة في الكرتونة (2 أو أكثر)');
  if (piecePrice !== null && !(Number.isSafeInteger(piecePrice) && piecePrice >= 0)) throw new Error('سعر الحبة غير صحيح');
  const n = count / QTY_SCALE;
  const barcode = pieceBarcode || piece?.barcode || null;
  const movements = [];
  let product, pack;

  if (cartonPack) {
    // أُدخل بالكرتونة من البداية: السعر والمخزون بالحبة أصلًا. باركوده (الذي مُسح وقتها) هو باركود الكرتونة.
    const moveCode = barcode && carton.barcode && carton.barcode !== barcode && !cartonPack.barcode;
    product = { ...carton, barcode: barcode || carton.barcode, sell_price: piecePrice ?? carton.sell_price };
    pack = { ...cartonPack, factor: count, barcode: moveCode ? carton.barcode : cartonPack.barcode };
  } else {
    // الصنف نفسه هو الكرتونة: سعره وتكلفته ومخزونه بالكرتونة ← تصير بالحبة
    pack = { id: makeId(), product_id: carton.id, name: packName, factor: count, barcode: carton.barcode || null, sell_price: carton.sell_price ?? null, deleted: false };
    product = {
      ...carton, barcode,
      sell_price: piecePrice ?? divRound((carton.sell_price || 0) * QTY_SCALE, count),
      cost_price: divRound((carton.cost_price || 0) * QTY_SCALE, count),
    };
    const q = cartonStock.qty || 0;
    if (q !== 0) {
      movements.push({ product_id: carton.id, type: 'adjustment', qty: -q, unit_cost: null, note: `تحويل ${packName} إلى حبات` });
      const pieces = q * n;
      movements.push(q > 0
        ? { product_id: carton.id, type: 'opening', qty: pieces, unit_cost: divRound((cartonStock.avgCost || carton.cost_price || 0) * QTY_SCALE, count), note: `${q / QTY_SCALE} ${packName} × ${n} حبة` }
        : { product_id: carton.id, type: 'adjustment', qty: pieces, unit_cost: null, note: `${q / QTY_SCALE} ${packName} × ${n} حبة` });
    }
  }

  // الحبة المكررة: مخزونها ينتقل، وهي تُحذف (فواتيرها القديمة تبقى كما هي)
  if (piece) {
    const p = pieceStock.qty || 0;
    if (p !== 0) {
      movements.push(p > 0
        ? { product_id: carton.id, type: 'opening', qty: p, unit_cost: pieceStock.avgCost || piece.cost_price || 0, note: `دمج «${piece.name}»` }
        : { product_id: carton.id, type: 'adjustment', qty: p, unit_cost: null, note: `دمج «${piece.name}»` });
      movements.push({ product_id: piece.id, type: 'adjustment', qty: -p, unit_cost: null, note: `دُمج في «${carton.name}»` });
    }
  }

  const finalQty = (cartonPack ? cartonStock.qty || 0 : (cartonStock.qty || 0) * n) + (piece ? pieceStock.qty || 0 : 0);
  return { product, pack, movements, removeId: piece ? piece.id : null, preview: { piecePrice: product.sell_price, packPrice: pack.sell_price, count: n, qty: finalQty } };
}
