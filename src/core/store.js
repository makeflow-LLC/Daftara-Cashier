// طبقة الكتابة الوحيدة: كل حفظ يمر من هنا، فيحصل تلقائيًا على
//   shop_id و created_at و updated_at، وقيد في outbox للرفع، وتحديث مخزون الصنف إن كانت حركة،
//   وإشعار للواجهة (change) — كل ذلك في معاملة واحدة: إما كله أو لا شيء.
import { TABLE, SYNCED, blank } from '../sync/tables.js';
import { applyMovement } from '../domain/stock.js';
import { uuid } from './ids.js';

export function createStore({ db, clock, getContext, emit = () => {} }) {
  const TX_TABLES = [...SYNCED, 'outbox', 'stock', 'meta'];

  async function enqueue(table, id) {
    const key = `${table}:${id}`;
    const old = await db.outbox.where('key').equals(key).first();
    if (old) await db.outbox.delete(old.seq);
    await db.outbox.add({ key, table, id, rev: (old?.rev || 0) + 1, tries: 0 });
  }

  function writer(changed) {
    const ctx = getContext();
    return {
      ctx,
      /** إنشاء أو استبدال سجل كامل في جدول «آخر تعديل يفوز». */
      async put(table, row) {
        const t = TABLE[table];
        if (!t || t.mode !== 'lww') throw new Error(`put: ${table} is not an lww table`);
        const now = clock();
        const id = row.id || uuid();
        const existing = row.id ? await db.table(table).get(row.id) : null;
        const full = blank(table, {
          ...(existing || {}),
          ...row,
          id,
          shop_id: table === 'shops' ? id : ctx.shopId,
          created_at: existing?.created_at || row.created_at || now,
          updated_at: now,
        });
        await db.table(table).put(full);
        await enqueue(table, id);
        changed.add(table);
        return full;
      },
      /** تعديل حقول محددة. */
      async patch(table, id, changes) {
        const existing = await db.table(table).get(id);
        if (!existing) throw new Error(`patch: ${table}/${id} not found`);
        return this.put(table, { ...existing, ...changes, id });
      },
      /** حذف = علامة deleted (لا حذف فعلي، حتى لا يعيده جهاز آخر). */
      async remove(table, id) {
        return this.patch(table, id, { deleted: true });
      },
      /** إضافة سجل في جدول «إضافة فقط». لا يُعدَّل بعدها أبدًا. */
      async append(table, row) {
        const t = TABLE[table];
        if (!t || t.mode !== 'append') throw new Error(`append: ${table} is not an append-only table`);
        const full = blank(table, {
          device_id: ctx.deviceId ?? null,
          created_by: ctx.userId ?? null,
          ...row,
          id: row.id || uuid(),
          shop_id: ctx.shopId,
          created_at: row.created_at || clock(),
        });
        if (await db.table(table).get(full.id)) throw new Error(`append: ${table}/${full.id} exists`);
        await db.table(table).add(full);
        await enqueue(table, full.id);
        if (table === 'movements') await bumpStock(full);
        changed.add(table);
        return full;
      },
    };
  }

  async function bumpStock(m) {
    const s = (await db.stock.get(m.product_id)) || { product_id: m.product_id, qty: 0, avgCost: 0, last_sale_at: null };
    const next = applyMovement({ qty: s.qty, avgCost: s.avgCost }, m);
    await db.stock.put({
      ...s, ...next,
      last_sale_at: m.type === 'sale' && (!s.last_sale_at || m.created_at > s.last_sale_at) ? m.created_at : s.last_sale_at,
    });
  }

  /**
   * يشغّل fn(w) داخل معاملة واحدة على كل الجداول. مثال (بيع):
   *   await store.write(async (w) => { await w.put('invoices', …); await w.append('movements', …); });
   */
  async function write(fn) {
    const changed = new Set();
    // الدالة async ضرورية: بدونها تُحفظ الخطوات الأولى ولا تُلغى إن فشلت خطوة لاحقة (اختبار atomic)
    const result = await db.transaction('rw', TX_TABLES.map((n) => db.table(n)), async () => fn(writer(changed)));
    emit({ tables: [...changed], source: 'local' });
    return result;
  }

  return {
    write,
    put: (table, row) => write((w) => w.put(table, row)),
    patch: (table, id, changes) => write((w) => w.patch(table, id, changes)),
    remove: (table, id) => write((w) => w.remove(table, id)),
    append: (table, row) => write((w) => w.append(table, row)),
    pendingCount: () => db.outbox.count(),
  };
}
