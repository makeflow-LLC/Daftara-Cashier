// بيانات الأصناف على الجهاز: قراءة، بحث بالباركود، حفظ (مع حركة المخزون وسجل الأسعار والعبوات) — في معاملة واحدة.
// مستقلة عن الواجهة فتُختبر وحدها (tests/products.test.mjs).
import { signedQty, knownCost } from '../../domain/stock.js';
import { normalizeBarcode, internalBarcode, isInternalBarcode, isAcceptableBarcode, isShareableBarcode, validateProduct, validatePack } from '../../domain/product.js';
import { normalizeScaleCode, parseScaleBarcode, scaleQuantity } from '../../domain/scale.js';
import { mainPack } from '../../domain/units.js';
import { linkPlan } from '../../domain/link.js';
import { uuid } from '../../core/ids.js';

export function createProductRepo({ db, store, getContext }) {
  async function stockMap() {
    const rows = await db.stock.toArray();
    return new Map(rows.map((s) => [s.product_id, s]));
  }

  const repo = {
    async list() {
      const [products, stock, units] = await Promise.all([db.products.toArray(), stockMap(), db.product_units.toArray()]);
      // العبوة الرئيسية لكل صنف (الكرتونة): للعرض «1 كرتونة و22 قطعة» وللبيع والشراء بالكرتونة
      const byProduct = new Map();
      for (const u of units) { if (!u.deleted) byProduct.set(u.product_id, [...(byProduct.get(u.product_id) || []), u]); }
      return products
        .filter((p) => !p.deleted)
        .map((p) => ({ ...p, qty: stock.get(p.id)?.qty ?? 0, avg_cost: knownCost(stock.get(p.id)?.avgCost, p.cost_price), pack: mainPack(byProduct.get(p.id)) }))
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
        avg_cost: knownCost(s?.avgCost, p.cost_price),
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

    /** الصنف برقمه في الميزان (PLU). */
    async findByScaleCode(raw) {
      const code = normalizeScaleCode(raw);
      if (!code) return null;
      return (await db.products.where('scale_code').equals(code).toArray()).find((x) => !x.deleted) || null;
    },

    /**
     * ما يقرؤه الماسح: باركود الصنف أو العبوة أولًا، ثم ملصق الميزان (إن شُغّل في الإعدادات).
     * يرجع { product, pack, qty?, discount?, scale? } أو null. scale = ما قُرئ من الملصق إن لم يُعرف صنفه.
     */
    async resolveScan(raw, scaleCfg) {
      const hit = await repo.findByCode(raw);
      if (hit) return hit;
      const parsed = parseScaleBarcode(normalizeBarcode(raw), scaleCfg);
      if (!parsed) return null;
      const product = await repo.findByScaleCode(parsed.code);
      if (!product) return { product: null, pack: null, scale: parsed };
      const q = scaleQuantity(product, parsed);
      if (!q) return { product, pack: null, scale: parsed, invalid: true };
      return { product, pack: null, qty: q.qty, discount: q.discount, scale: parsed };
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
      if ('scale_code' in input) data.scale_code = input.scale_code ? normalizeScaleCode(input.scale_code) : null;
      const v = validateProduct(data);
      if (input.scale_code && !data.scale_code) { v.ok = false; v.errors.scale_code = 'رقم الميزان أرقام فقط (حتى 6)'; }
      if (!v.ok) throw Object.assign(new Error('invalid'), { errors: v.errors });
      if (data.scale_code) {
        const dup = await repo.findByScaleCode(data.scale_code);
        if (dup && dup.id !== data.id) throw Object.assign(new Error('duplicate'), { errors: { scale_code: `رقم الميزان مسجّل لـ «${dup.name}»` } });
      }
      if (data.barcode) {
        const dup = await repo.findByCode(data.barcode);
        if (dup && dup.product.id !== data.id) throw Object.assign(new Error('duplicate'), { errors: { barcode: `هذا الباركود مسجّل لـ «${dup.product.name}»` } });
      }
      // باركود واحد لا يكون للقطعة وللعبوة معًا (ولا لعبوتين): الماسح لن يعرف أيهما يبيع
      const packCodes = (packs || (data.id ? (await db.product_units.where('product_id').equals(data.id).toArray()).filter((u) => !u.deleted) : []))
        .map((pk) => normalizeBarcode(pk.barcode)).filter(Boolean);
      if ((data.barcode && packCodes.includes(data.barcode)) || new Set(packCodes).size !== packCodes.length) {
        throw Object.assign(new Error('duplicate'), { errors: { packs: 'باركود القطعة وباركود العبوة لا يكونان نفس الرقم' } });
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
        // التكلفة عُدّلت يدويًا والبضاعة موجودة: نعيد تقييم المخزون بها (خروج ثم دخول بنفس الكمية)،
        // فيصير متوسط التكلفة = ما كتبه صاحب المحل، ويُحسب ربح البيع القادم به.
        if (!isNew && before.cost_price !== p.cost_price && p.cost_price > 0) {
          const s = await db.stock.get(p.id);
          if (s && s.qty > 0 && s.avgCost !== p.cost_price) {
            await w.append('movements', { product_id: p.id, type: 'adjustment', qty: -s.qty, unit_cost: null, note: 'إعادة تقييم التكلفة' });
            await w.append('movements', { product_id: p.id, type: 'adjustment', qty: s.qty, unit_cost: p.cost_price, note: 'إعادة تقييم التكلفة' });
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

    /**
     * يربط الحبة بالكرتونة في صنف واحد (domain/link.js). args: { cartonId, pieceId?, pieceBarcode?, count, piecePrice? }
     * في معاملة واحدة: الصنف بسعر الحبة وباركودها، الكرتونة عبوته، المخزون بالحبات، والمكرر يُدمج ويُحذف.
     */
    async linkPiece({ cartonId, pieceId = null, pieceBarcode = null, count, piecePrice = null }) {
      const carton = await db.products.get(cartonId);
      const piece = pieceId ? await db.products.get(pieceId) : null;
      if (!carton || carton.deleted) throw new Error('الصنف غير موجود');
      const units = (await db.product_units.where('product_id').equals(cartonId).toArray()).filter((u) => !u.deleted);
      const cartonPack = mainPack(units);
      const code = pieceBarcode ? normalizeBarcode(pieceBarcode) : null;
      const st = async (id) => { const x = await db.stock.get(id); return { qty: x?.qty ?? 0, avgCost: x?.avgCost ?? 0 }; };
      const plan = linkPlan({
        carton, cartonPack, cartonStock: await st(cartonId), piece, pieceStock: piece ? await st(piece.id) : undefined,
        pieceBarcode: code, count, piecePrice, makeId: uuid,
      });
      for (const c of [plan.product.barcode, plan.pack.barcode].filter(Boolean)) {
        const dup = await repo.findByCode(c);
        if (dup && dup.product.id !== cartonId && dup.product.id !== pieceId) throw new Error(`الباركود ${c} مسجّل لـ «${dup.product.name}»`);
      }
      await store.write(async (w) => {
        if (piece) await w.put('products', { ...piece, barcode: null, deleted: true });
        const p = await w.put('products', plan.product);
        if (carton.sell_price !== p.sell_price || carton.cost_price !== p.cost_price) {
          await w.append('price_history', { product_id: p.id, old_sell: carton.sell_price, new_sell: p.sell_price, old_cost: carton.cost_price, new_cost: p.cost_price, reason: 'link' });
        }
        await w.put('product_units', plan.pack);
        for (const m of plan.movements) await w.append('movements', m);
      });
      return plan;
    },

    /** «كرتونة لصنف موجود»: يضيف عبوة بباركودها لصنف يُباع بالحبة. */
    async addPack(productId, { barcode, count, sellPrice = null, name = 'كرتونة' }) {
      const prod = await repo.get(productId);
      if (!prod) throw new Error('الصنف غير موجود');
      if (prod.barcode && normalizeBarcode(barcode) === prod.barcode) throw new Error('هذا باركود الحبة نفسها، لا الكرتونة');
      const packs = [...prod.units.filter((u) => u.barcode !== normalizeBarcode(barcode)), { id: uuid(), name, factor: count, barcode: normalizeBarcode(barcode), sell_price: sellPrice }];
      const { units, images, qty, avg_cost, ...rest } = prod;
      return repo.save(rest, { packs });
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
