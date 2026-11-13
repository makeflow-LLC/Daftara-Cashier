// رفع الصور وتنزيلها، والكتالوج المشترك للباركود. يعمل بعد كل مزامنة ناجحة، بصمت.
//   رفع: كل صورة حالتها pending (الكاملة والمصغّرة) إلى Storage في مجلد المحل.
//   تنزيل: المصغّرة فقط حين تظهر في قائمة (~10KB)، والكاملة عند فتح الصنف — توفيرًا للإنترنت.
//   الكتالوج: باركود + اسم فقط، لا أسعار ولا كميات ولا صور ولا هوية المحل.
import { HttpError } from './supabase.js';
import { BUCKET } from '../core/media.js';

export function thumbPathOf(path) {
  return path.replace(/\.webp$/, '_t.webp');
}

export function createMediaSync({ db, api }) {
  let busy = null;

  async function uploadPending() {
    const pending = await db.files.where('state').equals('pending').toArray();
    let n = 0;
    for (const f of pending) {
      try {
        if (f.blob) await api.storage.upload(BUCKET, f.path, f.blob, f.blob.type || 'image/webp');
        if (f.kind === 'product' && f.thumb) await api.storage.upload(BUCKET, thumbPathOf(f.path), f.thumb, f.thumb.type || 'image/webp');
        await db.files.update(f.id, { state: 'synced' });
        n++;
      } catch (e) {
        if (e instanceof HttpError && e.transient) throw e; // بلا إنترنت: نكمل في المرة القادمة
        await db.files.update(f.id, { tries: (f.tries || 0) + 1, error: String(e.message).slice(0, 200), state: (f.tries || 0) >= 4 ? 'failed' : 'pending' });
      }
    }
    return n;
  }

  async function flushCatalog() {
    const q = (await db.meta.get('catalogQueue'))?.value || [];
    if (!q.length) return 0;
    const batch = q.slice(0, 200);
    await api.rest.rpc('cashier_catalog_contribute', { p_items: batch });
    const now = (await db.meta.get('catalogQueue'))?.value || [];
    await db.meta.put({ key: 'catalogQueue', value: now.slice(batch.length) });
    return batch.length;
  }

  const mediaSync = {
    /** بعد كل مزامنة: ارفع الصور، وأرسل أسماء الباركود للكتالوج. */
    run() {
      if (!busy) {
        busy = (async () => {
          try { return { uploaded: await uploadPending(), catalog: await flushCatalog() }; }
          catch (e) { return { error: e }; }
        })().finally(() => { busy = null; });
      }
      return busy;
    },

    /** ينزّل صورة من جهاز آخر (المصغّرة أو الكاملة) ويحفظها هنا. يرجع true إن نزلت. */
    async fetch(imageRow, { full = false } = {}) {
      const f = await db.files.get(imageRow.id);
      if (f && (full ? f.blob : f.thumb || f.blob)) return true;
      try {
        const b = await api.storage.download(BUCKET, full ? imageRow.path : thumbPathOf(imageRow.path));
        await db.files.put({ ...(f || {}), id: imageRow.id, kind: 'product', path: imageRow.path, [full ? 'blob' : 'thumb']: b, state: 'synced' });
        return true;
      } catch {
        return false; // لم تُرفع بعد من الجهاز الآخر، أو بلا إنترنت: نحاول لاحقًا
      }
    },

    /** اسم مقترح لباركود من الكتالوج المشترك (مهلة قصيرة: لا ننتظر الإنترنت الضعيف). */
    async lookup(barcode, timeoutMs = 2500) {
      try {
        const r = await Promise.race([
          api.rest.rpc('cashier_catalog_lookup', { p_barcodes: [barcode] }),
          new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        return (r && r[0] && r[0].name) || null;
      } catch {
        return null;
      }
    },
  };
  return mediaSync;
}
