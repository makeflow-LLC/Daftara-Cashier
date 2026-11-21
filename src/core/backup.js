// النسخة الاحتياطية: ملف واحد فيه كل بيانات المحل (بلا الصور). الاستعادة تستبدل ما على الجهاز كله،
// بعد التحقق من الملف، ثم تعيد حساب المخزون من الحركات وتضع كل شيء في طابور الرفع.
import { SYNCED } from '../sync/tables.js';
import { makeBackup, validateBackup } from '../domain/tools.js';
import { foldByLocation } from '../domain/stock.js';
import { LICENSE_META } from './license.js';

const META_KEYS = ['shopId', 'devicePrefix', 'internalSeq', 'seq:sale', 'seq:sale_return', 'seq:purchase', 'seq:receipt'];

export async function exportBackup(db) {
  const tables = {};
  for (const t of SYNCED) tables[t] = await db.table(t).toArray();
  const meta = {};
  for (const k of META_KEYS) { const r = await db.meta.get(k); if (r) meta[k] = r.value; }
  return makeBackup({ tables, meta, exportedAt: new Date().toISOString() });
}

export function checkBackup(data) {
  return validateBackup(data, SYNCED);
}

export async function restoreBackup(db, data) {
  checkBackup(data);
  const all = [...SYNCED, 'outbox', 'stock', 'wh_stock', 'held', 'meta'].map((n) => db.table(n));
  await db.transaction('rw', all, async () => {
    // يبقى على الجهاز: هويته وحالة الترخيص (الاستعادة لا تبدأ تجربة جديدة ولا تُضيع اشتراكًا)
    const keep = [];
    for (const k of ['deviceId', ...LICENSE_META]) { const r = await db.meta.get(k); if (r) keep.push(r); }
    for (const t of [...SYNCED, 'outbox', 'stock', 'wh_stock', 'held']) await db.table(t).clear();
    await db.meta.clear();
    for (const r of keep) await db.meta.put(r);
    for (const [k, v] of Object.entries(data.meta)) await db.meta.put({ key: k, value: v });
    for (const t of SYNCED) {
      const rows = data.tables[t] || [];
      if (!rows.length) continue;
      await db.table(t).bulkPut(rows);
      await db.outbox.bulkAdd(rows.map((r) => ({ key: `${t}:${r.id}`, table: t, id: r.id, rev: 1, tries: 0 })));
    }
    const byProduct = new Map();
    for (const m of data.tables.movements || []) { if (!byProduct.has(m.product_id)) byProduct.set(m.product_id, []); byProduct.get(m.product_id).push(m); }
    for (const [pid, mv] of byProduct) {
      const { shop, warehouses } = foldByLocation(mv);
      let last = null;
      for (const m of mv) if (m.type === 'sale' && (!last || m.created_at > last)) last = m.created_at;
      await db.stock.put({ product_id: pid, qty: shop.qty, avgCost: shop.avgCost, last_sale_at: last });
      for (const [branchId, w] of warehouses) await db.wh_stock.put({ branch_id: branchId, product_id: pid, qty: w.qty, avgCost: w.avgCost });
    }
  });
}

// ---------- استبدال محل الجهاز بمحل آخر (الدخول بحساب موجود على جهاز فيه محل تجريبي) ----------
const LOCAL_TABLES = ['outbox', 'stock', 'wh_stock', 'held', 'files'];
/** يبقى على الجهاز مهما تغيّر المحل: هويته، جلسة الدخول، حالة الترخيص، وإعداد الطابعة. */
export const DEVICE_META = ['deviceId', 'auth', 'printer', ...LICENSE_META];

/** نسخة كاملة مما على الجهاز كما هو (في الذاكرة)، للرجوع إليها إن فشل الاستبدال. */
export async function snapshotDevice(db) {
  const snap = {};
  for (const t of [...SYNCED, ...LOCAL_TABLES, 'meta']) snap[t] = await db.table(t).toArray();
  return snap;
}

/** يمسح بيانات المحل من الجهاز (الجداول المتزامنة، طابور الرفع، المخزون المحسوب…) ويُبقي هوية الجهاز. */
export async function clearShopData(db) {
  const names = [...SYNCED, ...LOCAL_TABLES, 'meta'];
  await db.transaction('rw', names.map((n) => db.table(n)), async () => {
    for (const t of [...SYNCED, ...LOCAL_TABLES]) await db.table(t).clear();
    for (const k of await db.meta.toCollection().primaryKeys()) if (!DEVICE_META.includes(k)) await db.meta.delete(k);
  });
}

/** يعيد الجهاز كما كان في snapshotDevice. */
export async function restoreDevice(db, snap) {
  const names = [...SYNCED, ...LOCAL_TABLES, 'meta'];
  await db.transaction('rw', names.map((n) => db.table(n)), async () => {
    for (const t of names) { await db.table(t).clear(); if (snap[t] && snap[t].length) await db.table(t).bulkPut(snap[t]); }
  });
}
