// الطباعة الحرارية (نقي): صورة الفاتورة (RGBA من canvas) ← نقاط أبيض/أسود ← أوامر ESC/POS.
// نطبع صورةً لا نصًّا: الحروف العربية تخرج كما رسمها الجهاز على أي طابعة، بلا جداول محارف.

/** عرض الورق بالنقاط: 58 ملم = 384 نقطة، 80 ملم = 576 نقطة (203 dpi). */
export const PAPER = Object.freeze({ 58: 384, 80: 576 });

/**
 * rgba: Uint8ClampedArray (من getImageData)، width و height بالبكسل.
 * يرجع { bytesPerRow, height, bits: Uint8Array } — 1 = نقطة سوداء، كل سطر مكمّل لمضاعف 8.
 * threshold: أغمق من هذا يُطبع (0–255). الشفاف أبيض.
 */
export function toMono(rgba, width, height, threshold = 160) {
  const bytesPerRow = Math.ceil(width / 8);
  const bits = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bytesPerRow, height, bits };
}

/** يحذف الأسطر البيضاء من الأسفل (ورق أقل). */
export function trimBottom(mono) {
  let h = mono.height;
  const row = (y) => mono.bits.subarray(y * mono.bytesPerRow, (y + 1) * mono.bytesPerRow);
  while (h > 1 && row(h - 1).every((b) => b === 0)) h--;
  return { ...mono, height: h, bits: mono.bits.subarray(0, h * mono.bytesPerRow) };
}

/**
 * أوامر ESC/POS: تهيئة، الصورة على شرائح (GS v 0) لأن ذاكرة الطابعات الرخيصة صغيرة، تغذية، وقص (إن وُجد القاطع).
 */
export function escposRaster(mono, { band = 96, feed = 4, cut = true } = {}) {
  const { bytesPerRow, height, bits } = mono;
  const parts = [[0x1b, 0x40]]; // ESC @
  for (let y = 0; y < height; y += band) {
    const h = Math.min(band, height - y);
    parts.push([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8]);
    parts.push(bits.subarray(y * bytesPerRow, (y + h) * bytesPerRow));
  }
  parts.push([0x1b, 0x64, feed]); // ESC d n: تغذية n أسطر
  if (cut) parts.push([0x1d, 0x56, 0x42, 0x00]); // GS V B 0: قص جزئي
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** base64 لبايتات (للإضافة الأصلية). */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
