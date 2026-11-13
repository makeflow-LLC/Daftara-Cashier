// النسخة الاحتياطية: ملف واحد فيه كل بيانات المحل (بلا الصور). الاستعادة تستبدل ما على الجهاز كله،
// بعد التحقق من الملف، ثم تعيد حساب المخزون من الحركات وتضع كل شيء في طابور الرفع.
import { SYNCED } from '../sync/tables.js';
import { makeBackup, validateBackup } from '../domain/tools.js';
import { foldProduct } from '../domain/stock.js';

const META_KEYS = ['shopId', 'devicePrefix', 'internalSeq', 'seq:sale', 'seq:sale_return', 'seq:purchase'];

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
  const all = [...SYNCED, 'outbox', 'stock', 'held', 'meta'].map((n) => db.table(n));
  await db.transaction('rw', all, async () => {
    const deviceId = (await db.meta.get('deviceId'))?.value;
    for (const t of [...SYNCED, 'outbox', 'stock', 'held']) await db.table(t).clear();
    await db.meta.clear();
    if (deviceId) await db.meta.put({ key: 'deviceId', value: deviceId });
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
      const { qty, avgCost } = foldProduct(mv);
      let last = null;
      for (const m of mv) if (m.type === 'sale' && (!last || m.created_at > last)) last = m.created_at;
      await db.stock.put({ product_id: pid, qty, avgCost, last_sale_at: last });
    }
  });
}
