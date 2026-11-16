// باركود الميزان: الميزان الإلكتروني يطبع ملصقًا بباركود EAN-13 فيه رقم الصنف والوزن (أو السعر).
// الشكل المعتاد: PP CCCCC VVVVV K
//   PP    بداية الباركود (20–29 نطاق مخصّص للاستعمال داخل المحل)
//   CCCCC رقم الصنف في الميزان (PLU)
//   VVVVV الوزن بالغرام (00750 = 0.750 كيلو) أو السعر بالأغورة (01250 = 12.50 ₪)
//   K     رقم التحقق
// طول رقم الصنف قابل للتعديل (4 أو 5 أو 6) وكذلك البداية؛ القيمة تأخذ الباقي (12 − البداية − رقم الصنف).
// منطق نقي: لا DOM ولا قاعدة بيانات.
import { isValidEan, checkDigit } from './product.js';
import { lineAmount, QTY_SCALE } from './units.js';

export const SCALE_DEFAULTS = Object.freeze({
  enabled: false,
  prefixes: '20-29',   // قائمة مفصولة بفواصل، وتقبل نطاقًا: «21,22» أو «20-29» أو «2»
  codeLength: 5,       // عدد أرقام رقم الصنف
  mode: 'weight',      // weight: الوزن بالغرام | price: السعر بأصغر وحدة عملة (أغورة)
});

/** إعدادات الميزان المحفوظة مدموجة مع الافتراضي. */
export function scaleSettings(saved) {
  const s = { ...SCALE_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  s.enabled = !!s.enabled;
  s.codeLength = [4, 5, 6].includes(Number(s.codeLength)) ? Number(s.codeLength) : SCALE_DEFAULTS.codeLength;
  s.mode = s.mode === 'price' ? 'price' : 'weight';
  s.prefixes = String(s.prefixes ?? '').trim() || SCALE_DEFAULTS.prefixes;
  return s;
}

/** «20-29, 2» → ['20','21',…,'29','2'] (الأطول أولًا ليطابق الأدق). null إن كانت غير صحيحة. */
export function parsePrefixes(text) {
  const out = new Set();
  const src = String(text ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[،\s]+/g, ',');
  for (const part of src.split(',').filter(Boolean)) {
    const m = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(part);
    if (!m) return null;
    if (!m[2]) { out.add(m[1]); continue; }
    if (m[1].length !== m[2].length || Number(m[2]) < Number(m[1]) || Number(m[2]) - Number(m[1]) > 99) return null;
    for (let n = Number(m[1]); n <= Number(m[2]); n++) out.add(String(n).padStart(m[1].length, '0'));
  }
  return out.size ? [...out].sort((a, b) => b.length - a.length) : null;
}

/** رقم الصنف في الميزان بشكل واحد للمقارنة: أرقام فقط بلا أصفار في البداية («00123» → «123»). */
export function normalizeScaleCode(raw) {
  const d = String(raw ?? '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\s+/g, '');
  if (!/^\d{1,6}$/.test(d)) return null;
  return String(Number(d));
}

/**
 * يقرأ باركود الميزان. يرجع { code, value, mode } أو null إن لم يكن باركود ميزان بهذه الإعدادات.
 * code: رقم الصنف موحّدًا (normalizeScaleCode)، value: الغرامات أو الأغورات (عدد صحيح).
 */
export function parseScaleBarcode(barcode, settings) {
  const s = scaleSettings(settings);
  if (!s.enabled) return null;
  const b = String(barcode ?? '');
  if (!/^\d{13}$/.test(b) || !isValidEan(b)) return null;
  const prefixes = parsePrefixes(s.prefixes);
  if (!prefixes) return null;
  const p = prefixes.find((x) => b.startsWith(x));
  if (!p) return null;
  const valueLen = 12 - p.length - s.codeLength;
  if (valueLen < 3) return null;
  const code = normalizeScaleCode(b.slice(p.length, p.length + s.codeLength));
  const value = Number(b.slice(p.length + s.codeLength, 12));
  if (code === null || code === '0' || !(value > 0)) return null;
  return { code, value, mode: s.mode };
}

/**
 * الكمية والخصم لسطر من ملصق الميزان.
 * weight: الكمية = الوزن (الكيلو بالألف = الغرام؛ صنف بوحدة «غرام» = الغرام × 1000).
 * price : الكمية = السعر ÷ سعر الوحدة، مقرّبة للأعلى، والفرق الصغير (أغورة أو اثنتان) خصم على السطر
 *         فيطابق إجمالي السطر المطبوع على الملصق تمامًا.
 * يرجع { qty, discount } أو null إن تعذّر (صنف بلا سعر في وضع السعر).
 */
export function scaleQuantity(product, parsed) {
  if (!parsed) return null;
  if (parsed.mode === 'weight') {
    const qty = product.unit === 'gram' ? parsed.value * QTY_SCALE : parsed.value;
    return { qty, discount: 0 };
  }
  const price = product.sell_price;
  if (!(price > 0)) return null;
  let qty = Math.max(1, Math.round((parsed.value * QTY_SCALE) / price));
  while (lineAmount(price, qty) < parsed.value) qty++;
  while (qty > 1 && lineAmount(price, qty - 1) >= parsed.value) qty--;
  return { qty, discount: lineAmount(price, qty) - parsed.value };
}

/** مثال لباركود بهذه الإعدادات (لشاشة الإعداد): رقم الصنف 123 بوزن 0.750 أو سعر 12.50. */
export function sampleScaleBarcode(settings) {
  const s = scaleSettings(settings);
  const prefixes = parsePrefixes(s.prefixes);
  if (!prefixes) return null;
  const p = prefixes.slice().sort()[0];
  const valueLen = 12 - p.length - s.codeLength;
  if (valueLen < 3) return null;
  const v = String(s.mode === 'price' ? 1250 : 750).padStart(valueLen, '0').slice(-valueLen);
  const body = p + '123'.padStart(s.codeLength, '0') + v;
  return body + checkDigit(body);
}
