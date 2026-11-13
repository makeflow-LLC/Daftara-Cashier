// صور الأصناف (وشعار المحل): تُضغط على الجهاز قبل أي شيء — WebP، أقصى بُعد 800px، نحو 100KB —
// ونسخة مصغّرة 160px للقوائم. الاثنتان تُحفظان في قاعدة الجهاز (جدول files) فتظهران بلا إنترنت،
// وتُرفعان إلى Supabase Storage لاحقًا (src/sync/media.js). الصور لا تُضمَّن في التطبيق أبدًا.
//
// files: { id (= معرّف الصورة), kind: 'product'|'logo', path, blob?, thumb?, state }
//   state: 'pending'  التُقطت هنا وتنتظر الرفع
//          'synced'   مرفوعة (أو نزلت من الخادم) ومحفوظة هنا
//          'missing'  صورة من جهاز آخر لم تنزل بعد

export const MAX_SIDE = 800;
export const THUMB_SIDE = 160;
export const TARGET_BYTES = 100 * 1024;
export const BUCKET = 'cashier-media';

/** أبعاد مصغّرة تحافظ على النسبة ولا تكبّر الصورة. */
export function fitWithin(w, h, max) {
  if (w <= max && h <= max) return { w, h };
  const r = w >= h ? max / w : max / h;
  return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
}

export function imagePath(shopId, imageId, thumb = false) {
  return `${shopId}/products/${imageId}${thumb ? '_t' : ''}.webp`;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('الصورة غير مقروءة')); };
    img.src = url;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function render(img, max, targetBytes) {
  const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, max);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';           // خلفية بيضاء لصور PNG الشفافة
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  let q = 0.82;
  let blob = await toBlob(c, 'image/webp', q);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(c, 'image/jpeg', q); // WebView بلا WebP
  while (blob && blob.size > targetBytes && q > 0.4) {
    q -= 0.12;
    blob = await toBlob(c, blob.type, q);
  }
  c.width = c.height = 0;         // تحرير الذاكرة فورًا (جوالات 2GB)
  return { blob, width: w, height: h };
}

/** يضغط صورة من الكاميرا أو المعرض: {blob, thumb, width, height, bytes}. */
export async function compressImage(file) {
  const img = await loadImage(file);
  const full = await render(img, MAX_SIDE, TARGET_BYTES);
  const thumb = await render(img, THUMB_SIDE, 12 * 1024);
  return { blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height, bytes: full.blob.size };
}

/** يفتح الكاميرا (camera=true) أو المعرض ويرجع الملف المختار أو null. */
export function pickImage({ camera = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let done = false;
    const finish = (f) => { if (done) return; done = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
    // إلغاء الاختيار: نعرفه حين يعود التركيز للصفحة بلا ملف
    window.addEventListener('focus', () => setTimeout(() => finish(input.files && input.files[0] ? input.files[0] : null), 800), { once: true });
    document.body.append(input);
    input.click();
  });
}

// ---------- عناوين العرض (object URLs) مع ذاكرة صغيرة ----------
const urls = new Map();

export function createMedia({ db, store, getContext }) {
  const media = {
    /** يضيف صورة لصنف (حتى 3). يرجع سجل product_images. */
    async addProductImage(productId, file) {
      const existing = (await db.product_images.where('product_id').equals(productId).toArray()).filter((i) => !i.deleted);
      if (existing.length >= 3) throw new Error('ثلاث صور كحد أقصى لكل صنف');
      const c = file && file.blob && file.thumb ? file : await compressImage(file); // ملف، أو صورة مضغوطة مسبقًا
      const ctx = getContext();
      return store.write(async (w) => {
        const row = await w.put('product_images', {
          product_id: productId, path: '', position: existing.length,
          width: c.width, height: c.height, bytes: c.bytes,
        });
        row.path = imagePath(ctx.shopId, row.id);
        await w.put('product_images', row);
        await db.files.put({ id: row.id, kind: 'product', path: row.path, blob: c.blob, thumb: c.thumb, state: 'pending' });
        return row;
      });
    },

    async removeProductImage(imageId) {
      await store.remove('product_images', imageId);
      forget(imageId);
    },

    /** أول صورة للصنف (للقوائم وشبكة البيع السريع). */
    async firstImage(productId) {
      const imgs = (await db.product_images.where('product_id').equals(productId).toArray()).filter((i) => !i.deleted);
      imgs.sort((a, b) => a.position - b.position);
      return imgs[0] || null;
    },

    /** عنوان عرض للصورة المصغّرة أو الكاملة، أو null إن لم تنزل بعد. */
    async url(imageId, { full = false } = {}) {
      const key = `${imageId}:${full ? 'f' : 't'}`;
      if (urls.has(key)) return urls.get(key);
      const f = await db.files.get(imageId);
      const b = f && (full ? f.blob || f.thumb : f.thumb || f.blob);
      if (!b) return null;
      const u = URL.createObjectURL(b);
      urls.set(key, u);
      return u;
    },

    forget,

    // ---------- شعار المحل ----------
    async setLogo(file) {
      const c = await compressImage(file);
      const ctx = getContext();
      const id = `logo-${ctx.shopId}`;
      const path = `${ctx.shopId}/logo.webp`;
      await db.files.put({ id, kind: 'logo', path, blob: c.blob, thumb: c.thumb, state: 'pending' });
      forget(id);
      return path;
    },
    logoUrl() {
      return media.url(`logo-${getContext().shopId}`);
    },
  };
  return media;
}

function forget(imageId) {
  for (const k of [`${imageId}:t`, `${imageId}:f`]) {
    if (urls.has(k)) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); }
  }
}
