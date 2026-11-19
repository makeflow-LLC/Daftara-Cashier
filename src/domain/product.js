// منطق الأصناف النقي: الباركود، الباركود الداخلي، البحث بالعربية، التحقق من الحقول، هامش الربح.
import { divRound } from './money.js';

/** ينظّف الباركود كما تقرؤه الكاميرا أو يكتبه البائع: أرقام عربية → غربية، بلا مسافات. */
export function normalizeBarcode(raw) {
  return String(raw ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\s+/g, '')
    .trim();
}

/** رقم التحقق لـ EAN-8 / EAN-13 / UPC-A (لأي طول، على الأرقام قبل الأخير). */
export function checkDigit(digits) {
  let s = 0;
  const n = digits.length;
  for (let i = 0; i < n; i++) {
    const d = Number(digits[n - 1 - i]);
    s += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (s % 10)) % 10;
}

/** هل هو باركود EAN/UPC صحيح؟ (يكشف الأخطاء في الكتابة اليدوية) */
export function isValidEan(code) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  return checkDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** باركود قابل للحفظ: 4 إلى 64 حرفًا/رقمًا (يقبل CODE128 و QR القصير أيضًا). */
export function isAcceptableBarcode(code) {
  return /^[0-9A-Za-z\-.]{4,64}$/.test(code);
}

// الباركود الداخلي للأصناف بلا باركود: EAN-13 يبدأ بـ 2 (نطاق مخصّص للاستعمال داخل المحل، لا يتعارض
// مع أي منتج تجاري). 2 + حرف الجهاز (رقمين) + تسلسل 9 أرقام + رقم تحقق — فريد حتى بين جهازين بلا إنترنت.
export const INTERNAL_PREFIX = '2';

export function internalBarcode(devicePrefix, seq) {
  const dev = String(devicePrefix.split('').reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0) % 100).padStart(2, '0');
  const body = INTERNAL_PREFIX + dev + String(seq % 1e9).padStart(9, '0');
  return body + checkDigit(body);
}

export function isInternalBarcode(code) {
  return code.length === 13 && code[0] === INTERNAL_PREFIX && isValidEan(code);
}

/** باركود يُشارك في الكتالوج المشترك؟ (الحقيقي فقط: لا الداخلي ولا القصير) */
export function isShareableBarcode(code) {
  return isAcceptableBarcode(code) && !isInternalBarcode(code) && /^\d{8,14}$/.test(code);
}

// ---------- البحث بالعربية ----------
/** يوحّد الكتابة: بلا تشكيل، أ إ آ ← ا، ة ← ه، ى ← ي، ؤ ← و، ئ ← ي، أرقام غربية، حروف صغيرة. */
export function normalizeArabic(s) {
  return String(s ?? '')
    .replace(/[ً-ٰٟـ]/g, '') // التشكيل والتطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * يطابق كل كلمة من البحث مع الاسم (بأي ترتيب)، أو الباركود. يرجع درجة (0 = لا تطابق) للترتيب:
 * بداية الاسم أعلى من وسطه.
 */
export function matchScore(query, product) {
  const q = normalizeArabic(query);
  if (!q) return 1;
  if (product.barcode && product.barcode.includes(q.replace(/\s/g, ''))) return 50;
  const name = normalizeArabic(product.name);
  const words = q.split(' ');
  let score = 0;
  for (const w of words) {
    const i = name.indexOf(w);
    if (i < 0) return 0;
    score += i === 0 ? 10 : name[i - 1] === ' ' ? 6 : 2;
  }
  return score;
}

/** يرتّب ويرشّح قائمة أصناف حسب البحث. */
export function searchProducts(products, query, limit = Infinity) {
  if (!normalizeArabic(query)) return products.slice(0, limit);
  return products
    .map((p) => [matchScore(query, p), p])
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, 'ar'))
    .slice(0, limit)
    .map(([, p]) => p);
}

// ---------- التحقق ----------
/** يرجع قائمة أخطاء بالعربية (فارغة = صالح) وتحذيرات لا تمنع الحفظ. */
export function validateProduct(p) {
  const errors = {};
  const warnings = [];
  if (!p.name || !String(p.name).trim()) errors.name = 'اكتب اسم الصنف';
  else if (String(p.name).trim().length > 120) errors.name = 'الاسم طويل جدًا';
  if (p.sell_price === null || p.sell_price === undefined || !Number.isSafeInteger(p.sell_price) || p.sell_price < 0) errors.sell_price = 'سعر البيع غير صحيح';
  if (!Number.isSafeInteger(p.cost_price) || p.cost_price < 0) errors.cost_price = 'سعر التكلفة غير صحيح';
  if (p.barcode && !isAcceptableBarcode(p.barcode)) errors.barcode = 'الباركود غير صحيح';
  if (!errors.sell_price && !errors.cost_price && p.cost_price > 0 && p.sell_price > 0 && p.sell_price < p.cost_price) {
    warnings.push('سعر البيع أقل من التكلفة — ستبيع بخسارة');
  }
  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

/** هامش الربح بنقاط الأساس من سعر البيع (2500 = 25%). null إن لم يُعرف. */
export function marginBp(cost, sell) {
  if (!sell || !cost) return null;
  return divRound((sell - cost) * 10000, sell);
}

/** يتحقق من عبوة: اسم ومعامل أكبر من 1 (كرتونة = 24 قطعة). */
export function validatePack(u) {
  if (!u.name || !String(u.name).trim()) return 'اكتب اسم العبوة';
  if (!Number.isSafeInteger(u.factor) || u.factor <= 1000) return 'عدد القطع في العبوة يجب أن يكون أكثر من 1';
  if (u.barcode && !isAcceptableBarcode(u.barcode)) return 'باركود العبوة غير صحيح';
  return null;
}

/**
 * أسعار «بالكرتونة»: التاجر يكتب سعر العبوة (بيع وتكلفة) وكميتها، والتطبيق يقسم.
 * count و qty بالألف (QTY_SCALE)، والأسعار بأصغر وحدة. يرجع سعر القطعة وتكلفتها والكمية بالقطع.
 */
export function packToPiece({ count, sell, cost = 0, qty = 0 }) {
  if (!(count > 1000)) return null;
  const per = (v) => Math.round((v * 1000) / count);
  return {
    sell: sell === null || sell === undefined ? null : per(sell),
    cost: per(cost || 0),
    qty: Math.round(((qty || 0) * count) / 1000),
  };
}

/** يضيف العبوة إلى قائمة عبوات الصنف أو يحدّثها إن وُجدت بنفس الاسم (لتُباع بسعرها). barcode: undefined = لا تغيير. */
export function upsertPack(packs, { name, count, sell, barcode, makeId }) {
  const list = (packs || []).map((p) => ({ ...p }));
  const i = list.findIndex((p) => p.name.trim() === name.trim());
  const code = barcode === undefined ? undefined : (normalizeBarcode(barcode) || null);
  if (i >= 0) list[i] = { ...list[i], factor: count, sell_price: sell, ...(code === undefined ? {} : { barcode: code }) };
  else list.push({ id: makeId(), name: name.trim(), factor: count, barcode: code ?? null, sell_price: sell });
  return list;
}

/**
 * صنف يُدخَل بعبوته (كرتونة فيها 24 قطعة، كروز فيه 10 علب): للعبوة باركودها وللقطعة المنفردة باركود آخر.
 * الممسوح أولًا هو باركود العبوة فيُحفظ للعبوة، وباركود القطعة يُحفظ للصنف نفسه — فيُعرف الاثنان عند البيع:
 * مسح الكرتونة يبيع كرتونة بسعرها، ومسح القطعة يبيع قطعة من نفس الصنف والمخزون.
 * pieceSell (اختياري): سعر القطعة المنفردة إن اختلف عن سعر العبوة ÷ العدد.
 * يرجع { sell, cost, qty, barcode, packs } بالقطعة، أو { error } بالعربية.
 */
export function packEntry({ packs = [], name, count, sell, cost = 0, qty = 0, packBarcode = null, pieceBarcode = null, pieceSell = null, makeId }) {
  const per = packToPiece({ count, sell, cost, qty });
  if (!per) return { error: 'اكتب كم قطعة في العبوة (أكثر من 1)' };
  const packCode = normalizeBarcode(packBarcode) || null;
  const pieceCode = normalizeBarcode(pieceBarcode) || null;
  if (packCode && pieceCode && packCode === pieceCode) return { error: 'باركود القطعة المنفردة هو نفسه باركود العبوة — امسح قطعة واحدة من داخلها' };
  return {
    sell: Number.isSafeInteger(pieceSell) && pieceSell >= 0 ? pieceSell : per.sell,
    cost: per.cost,
    qty: per.qty,
    barcode: pieceCode,
    packs: upsertPack(packs, { name, count, sell, barcode: packCode, makeId }),
  };
}
