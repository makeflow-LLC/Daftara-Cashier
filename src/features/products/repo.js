// بيانات الأصناف على الجهاز: قراءة، بحث بالباركود، حفظ (مع حركة المخزون وسجل الأسعار والعبوات) — في معاملة واحدة.
// مستقلة عن الواجهة فتُختبر وحدها (tests/products.test.mjs).
import { signedQty } from '../../domain/stock.js';
import { normalizeBarcode, internalBarcode, isShareableBarcode, validateProduct, validatePack } from '../../domain/product.js';

export function createProductRepo({ db, store, getContext }) {
  async function stockMap() {
    const rows = await db.stock.toArray();
    return new Map(rows.map((s) => [s.product_id, s]));
  }

  const repo = {
    async list() {
      const [products, stock] = await Promise.all([db.products.toArray(), stockMap()]);
      return products
        .filter((p) => !p.deleted)
        .map((p) => ({ ...p, qty: stock.get(p.id)?.qty ?? 0, avg_cost: stock.get(p.id)?.avgCost ?? p.cost_price }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    },

    async get(id) {
      const p = await db.products.get(id);
      if (!p || p.deleted) return null;
      const [units, images, s] = await Promise.all([
        db.product_units.where('product_id').equals(id).toArray(),
        db.product_images.where('product_id').equals(id).toArray(),
        db.stock.get(id),
      ]);
      return {
        ...p,
        qty: s?.qty ?? 0,
        avg_cost: s?.avgCost ?? p.cost_price,
        units: units.filter((u) => !u.deleted),
        images: images.filter((i) => !i.deleted).sort((a, b) => a.position - b.position),
      };
    },

    /** يجد الصنف (أو عبوته) بالباركود. يرجع {product, pack} أو null. */
    async findByCode(raw) {
      const code = normalizeBarcode(raw);
      if (!code) return null;
      const p = (await db.products.where('barcode').equals(code).toArray()).find((x) => !x.deleted);
      if (p) return { product: p, pack: null };
      const u = (await db.product_units.where('barcode').equals(code).toArray()).find((x) => !x.deleted);
      if (u) {
        const prod = await db.products.get(u.product_id);
        if (prod && !prod.deleted) return { product: prod, pack: u };
      }
      return null;
    },

    /** باركود داخلي جديد لصنف بلا باركود (فريد لهذا الجهاز). */
    async nextInternalBarcode() {
      const ctx = getContext();
      for (;;) {
        const row = await db.meta.get('internalSeq');
        const seq = (row?.value || 0) + 1;
        await db.meta.put({ key: 'internalSeq', value: seq });
        const code = internalBarcode(ctx.prefix || 'A', seq);
        if (!(await repo.findByCode(code))) return code;
      }
    },

    /**
     * يحفظ صنفًا جديدًا أو معدّلًا.
     * input: حقول الصنف (id للتعديل). options:
     *   qty      — الكمية الموجودة الآن بالألف (null = لا تغيير). للجديد = رصيد افتتاحي، للتعديل = تسوية بالفرق
     *   packs    — قائمة العبوات كاملة (null = لا تغيير)
     * يرجع {product} أو يرمي خطأ فيه errors.
     */
    async save(input, { qty = null, packs = null } = {}) {
      const data = { ...input, barcode: input.barcode ? normalizeBarcode(input.barcode) : null, name: String(input.name || '').trim() };
      const v = validateProduct(data);
      if (!v.ok) throw Object.assign(new Error('invalid'), { errors: v.errors });
      if (data.barcode) {
        const dup = await repo.findByCode(data.barcode);
        if (dup && dup.product.id !== data.id) throw Object.assign(new Error('duplicate'), { errors: { barcode: `هذا الباركود مسجّل لـ «${dup.product.name}»` } });
      }
      for (const pk of packs || []) {
        const err = validatePack(pk);
        if (err) throw Object.assign(new Error('invalid pack'), { errors: { packs: err } });
        if (pk.barcode) {
          const dup = await repo.findByCode(pk.barcode);
          if (dup && dup.product.id !== data.id) throw Object.assign(new Error('duplicate'), { errors: { packs: `باركود العبوة مسجّل لـ «${dup.product.name}»` } });
        }
      }

      const before = data.id ? await db.products.get(data.id) : null;
      const isNew = !before;
      const ctx = getContext();
      const product = await store.write(async (w) => {
        const p = await w.put('products', data);
        // سجل الأسعار
        if (!isNew && (before.sell_price !== p.sell_price || before.cost_price !== p.cost_price)) {
          await w.append('price_history', {
            product_id: p.id, old_sell: before.sell_price, new_sell: p.sell_price,
            old_cost: before.cost_price, new_cost: p.cost_price, reason: 'manual',
          });
        }
        // المخزون: حركة لا رقم
        if (qty !== null && Number.isSafeInteger(qty)) {
          if (isNew) {
            if (qty !== 0) await w.append('movements', { product_id: p.id, type: 'opening', qty: signedQty('opening', qty), unit_cost: p.cost_price, note: 'رصيد افتتاحي' });
          } else {
            const s = await db.stock.get(p.id);
            const diff = qty - (s?.qty ?? 0);
            if (diff !== 0) await w.append('movements', { product_id: p.id, type: 'adjustment', qty: diff, unit_cost: p.cost_price, note: 'تعديل من بطاقة الصنف' });
          }
        }
        // العبوات
        if (packs) {
          const existing = await db.product_units.where('product_id').equals(p.id).toArray();
          const keep = new Set();
          for (const pk of packs) {
            const u = await w.put('product_units', {
              id: pk.id, product_id: p.id, name: pk.name.trim(), factor: pk.factor,
              barcode: pk.barcode ? normalizeBarcode(pk.barcode) : null, sell_price: pk.sell_price ?? null, deleted: false,
            });
            keep.add(u.id);
          }
          for (const u of existing) if (!u.deleted && !keep.has(u.id)) await w.remove('product_units', u.id);
        }
        // الكتالوج المشترك: باركود حقيقي + اسم فقط (يُرفع لاحقًا مع المزامنة)
        if (p.barcode && isShareableBarcode(p.barcode) && (isNew || before.name !== p.name || before.barcode !== p.barcode)) {
          const q = (await db.meta.get('catalogQueue'))?.value || [];
          q.push({ barcode: p.barcode, name: p.name });
          await db.meta.put({ key: 'catalogQueue', value: q.slice(-500) });
        }
        return p;
      });
      return { product, isNew, warnings: v.warnings, deviceId: ctx.deviceId };
    },

    remove(id) {
      return store.remove('products', id);
    },
    restore(id) {
      return store.patch('products', id, { deleted: false });
    },

    // ---------- التصنيفات ----------
    async categories() {
      return (await db.categories.orderBy('sort').toArray()).filter((c) => !c.deleted);
    },
    async addCategory(name) {
      const n = String(name || '').trim();
      if (!n) throw Object.assign(new Error('invalid'), { errors: { name: 'اكتب اسم التصنيف' } });
      const all = await repo.categories();
      const same = all.find((c) => c.name === n);
      if (same) return same;
      return store.put('categories', { name: n, sort: all.length });
    },
    renameCategory(id, name) {
      return store.patch('categories', id, { name: String(name).trim() });
    },
    removeCategory(id) {
      return store.remove('categories', id);
    },
  };
  return repo;
}
