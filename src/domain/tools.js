// أدوات الأصناف (نقي): مطابقة أعمدة الاستيراد، تحديث الأسعار الجماعي، ترميز باركود EAN للملصقات، وملف النسخة الاحتياطية.
import { parseMoney } from './currency.js';
import { parseQty } from './units.js';
import { divRound, percentOf } from './money.js';
import { normalizeBarcode, isAcceptableBarcode, isValidEan, normalizeArabic } from './product.js';

// ---------- الاستيراد ----------
export const IMPORT_FIELDS = [
  { key: 'name', label: 'اسم الصنف', required: true, hints: ['اسم', 'الصنف', 'المنتج', 'البيان', 'name', 'product', 'item', 'description'] },
  { key: 'sell_price', label: 'سعر البيع', required: true, hints: ['بيع', 'سعر', 'price', 'sell', 'sale'] },
  { key: 'barcode', label: 'الباركود', hints: ['باركود', 'كود', 'barcode', 'code', 'sku', 'ean'] },
  { key: 'cost_price', label: 'سعر التكلفة', hints: ['تكلفه', 'شراء', 'جمله', 'cost', 'purchase', 'buy'] },
  { key: 'qty', label: 'الكمية', hints: ['كميه', 'عدد', 'مخزون', 'رصيد', 'qty', 'quantity', 'stock'] },
  { key: 'category', label: 'التصنيف', hints: ['تصنيف', 'صنف رئيسي', 'قسم', 'فئه', 'category', 'group'] },
];

/** يخمّن عمود كل حقل من عناوين الصف الأول. يرجع { name: 0, sell_price: 2, ... } (‎-1 = غير موجود). */
export function guessMapping(headers) {
  const norm = headers.map((h) => normalizeArabic(h));
  const used = new Set();
  const map = {};
  // التكلفة قبل سعر البيع حتى لا يأخذ «سعر الشراء» مكان «سعر البيع»
  const order = ['barcode', 'cost_price', 'qty', 'category', 'name', 'sell_price'];
  for (const key of order) {
    const f = IMPORT_FIELDS.find((x) => x.key === key);
    let found = -1;
    for (const hint of f.hints) {
      found = norm.findIndex((h, i) => !used.has(i) && h.includes(normalizeArabic(hint)));
      if (found >= 0) break;
    }
    map[key] = found;
    if (found >= 0) used.add(found);
  }
  return map;
}

/** هل الصف الأول عناوين؟ (لا أرقام فيه في خانة السعر) */
export function hasHeaderRow(rows) {
  return rows.length > 0 && rows[0].every((c) => parseMoney(c) === null || c === '');
}

/** يحوّل الصفوف إلى أصناف جاهزة للحفظ. يرجع { items, skipped: [{ row, reason }] }. */
export function rowsToProducts(rows, mapping, { currency = 'ILS' } = {}) {
  const items = [];
  const skipped = [];
  const seen = new Set();
  const cell = (r, key) => (mapping[key] >= 0 ? String(r[mapping[key]] ?? '').trim() : '');
  rows.forEach((r, i) => {
    const name = cell(r, 'name');
    if (!name) { skipped.push({ row: i + 1, reason: 'بلا اسم' }); return; }
    const sell = parseMoney(cell(r, 'sell_price'), currency);
    if (sell === null || sell < 0) { skipped.push({ row: i + 1, reason: `«${name}»: سعر البيع غير صحيح` }); return; }
    let barcode = normalizeBarcode(cell(r, 'barcode')).replace(/\.0+$/, '') || null;
    if (barcode && !isAcceptableBarcode(barcode)) barcode = null;
    if (barcode && seen.has(barcode)) { skipped.push({ row: i + 1, reason: `«${name}»: باركود مكرر في الملف` }); return; }
    if (barcode) seen.add(barcode);
    const cost = parseMoney(cell(r, 'cost_price'), currency);
    const qty = parseQty(cell(r, 'qty'));
    items.push({ name, barcode, sell_price: sell, cost_price: cost !== null && cost >= 0 ? cost : 0, qty: qty !== null && qty > 0 ? qty : 0, category: cell(r, 'category') || null });
  });
  return { items, skipped };
}

// ---------- تحديث الأسعار ----------
/**
 * mode: 'percent' (value بنقاط الأساس، 1000 = +10%) أو 'amount' (value بالأغورة). السالب تخفيض.
 * roundTo: 0 بلا تقريب، أو 10 / 50 / 100 أغورة (أقرب 0.10 / 0.50 / 1.00).
 * يرجع [{ id, name, old, next }] للأصناف التي يتغيّر سعرها فقط.
 */
export function bulkPrice(products, { mode, value, roundTo = 0 }) {
  const out = [];
  for (const p of products) {
    let next = mode === 'percent' ? p.sell_price + percentOf(p.sell_price, value) : p.sell_price + value;
    if (roundTo > 0) next = divRound(next, roundTo) * roundTo;
    next = Math.max(0, next);
    if (next !== p.sell_price) out.push({ id: p.id, name: p.name, old: p.sell_price, next });
  }
  return out;
}

// ---------- باركود EAN للملصقات ----------
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((s) => s.replace(/[01]/g, (b) => (b === '0' ? '1' : '0')));
const G = R.map((s) => s.split('').reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** باركود EAN-13 أو EAN-8 ← سلسلة 0/1 (1 = خط أسود). null إن لم يكن EAN صحيحًا. */
export function eanModules(code) {
  if (!isValidEan(code) || (code.length !== 13 && code.length !== 8)) return null;
  const d = code.split('').map(Number);
  if (code.length === 8) return `101${d.slice(0, 4).map((x) => L[x]).join('')}01010${d.slice(4).map((x) => R[x]).join('')}101`;
  const par = PARITY[d[0]];
  const left = d.slice(1, 7).map((x, i) => (par[i] === 'L' ? L[x] : G[x])).join('');
  return `101${left}01010${d.slice(7).map((x) => R[x]).join('')}101`;
}

/** قائمة الملصقات مكررة حسب عدد النسخ، مقسّمة صفحات. */
export function labelPages(items, perPage = 24) {
  const all = [];
  for (const it of items) for (let i = 0; i < (it.copies || 1); i++) all.push(it);
  const pages = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  return pages;
}

// ---------- النسخة الاحتياطية ----------
export const BACKUP_APP = 'daftara-cashier';
export const BACKUP_VERSION = 1;

export function makeBackup({ tables, meta, exportedAt }) {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt, meta, tables };
}

/** يتحقق من ملف النسخة قبل لمس أي شيء. يرجع { shopName, counts } أو يرمي خطأ بالعربية. */
export function validateBackup(data, tableNames) {
  if (!data || typeof data !== 'object' || data.app !== BACKUP_APP || !data.tables || typeof data.tables !== 'object') throw new Error('هذا ليس ملف نسخة من دفترة كاشير');
  if (data.version > BACKUP_VERSION) throw new Error('النسخة من إصدار أحدث — حدّث التطبيق أولًا');
  if (!data.meta || !data.meta.shopId) throw new Error('ملف النسخة ناقص');
  const counts = {};
  for (const t of tableNames) {
    const rows = data.tables[t] || [];
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.id !== 'string')) throw new Error(`ملف النسخة تالف (${t})`);
    counts[t] = rows.length;
  }
  const shop = (data.tables.shops || []).find((s) => s.id === data.meta.shopId);
  if (!shop) throw new Error('ملف النسخة ناقص: لا بيانات للمحل');
  return { shopName: shop.name, counts, exportedAt: data.exportedAt };
}
