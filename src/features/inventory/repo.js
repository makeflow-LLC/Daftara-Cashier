// المخزون على الجهاز: الشراء (يحدّث المخزون ومتوسط التكلفة)، التجار (الموردون) وديونهم، الجرد، التالف، والتنبيهات.
// كل تغيير في الكمية حركة تُضاف — لا رقم يُعدَّل.
import { buildPurchase, buildTransfer, transferHistory, stockAlerts, countSummary, reorderPlan, deadStock, VELOCITY_DAYS } from '../../domain/inventory.js';
import { oldestUnpaidAt, ledgerView, effectiveEntries, balanceOf, editableEntry, VOID_PREFIX } from '../../domain/ledger.js';
import { signedQty, knownCost, stockValue } from '../../domain/stock.js';
import { normalizeArabic, normalizeBarcode } from '../../domain/product.js';
import { sum } from '../../domain/money.js';
import { uuid } from '../../core/ids.js';

export function createInventoryRepo({ db, store, getContext, clock }) {
  function invalid(errors) { return Object.assign(new Error(Object.values(errors)[0]), { errors }); }
  async function nextSeq(type) {
    const key = `seq:${type}`;
    const seq = ((await db.meta.get(key))?.value || 0) + 1;
    await db.meta.put({ key, value: seq });
    return seq;
  }
  async function openSessionId() {
    const s = (await db.cash_sessions.orderBy('opened_at').reverse().limit(5).toArray()).find((x) => !x.deleted && !x.closed_at);
    return s ? s.id : null;
  }
  async function cashMethodId() {
    return (await db.payment_methods.toArray()).find((m) => m.kind === 'cash' && !m.deleted)?.id || null;
  }

  async function writeSupplierPayment(w, { supplierId, amount, method, note, cashSessionId, cashId, entryAt = null }) {
    const transfer = !!method && method.kind === 'transfer';
    const pid = uuid();
    await w.append('payments', {
      id: pid, supplier_id: supplierId, direction: 'out', method_id: transfer ? method.id : cashId, method_kind: transfer ? 'transfer' : 'cash',
      amount, cash_session_id: transfer ? null : cashSessionId, note: 'دفعة لتاجر',
    });
    return w.append('supplier_entries', {
      supplier_id: supplierId, type: 'payment', amount: -amount, payment_id: pid,
      note: note ? String(note).trim() || null : null, ...(entryAt ? { created_at: entryAt } : {}),
    });
  }
  async function writeSupplierVoid(w, entry, cashSessionId) {
    if (!editableEntry(entry) && !String(entry.note || '').startsWith(VOID_PREFIX)) throw invalid({ amount: 'هذه الحركة من فاتورة شراء — لا تُعدَّل من هنا' });
    let paymentId = null;
    if (entry.payment_id) {
      // الدفعة خرجت من الدرج: نعيدها إليه (أو العكس عند التراجع)
      const orig = await db.payments.get(entry.payment_id);
      if (orig) {
        paymentId = uuid();
        await w.append('payments', {
          id: paymentId, supplier_id: entry.supplier_id, direction: orig.direction === 'out' ? 'in' : 'out',
          method_id: orig.method_id, method_kind: orig.method_kind, amount: orig.amount,
          cash_session_id: orig.method_kind === 'cash' ? cashSessionId : null, note: 'تصحيح دفعة لتاجر',
        });
      }
    }
    return w.append('supplier_entries', { supplier_id: entry.supplier_id, type: entry.type, amount: -entry.amount, payment_id: paymentId, note: `${VOID_PREFIX}${entry.id}` });
  }

  const repo = {
    // ---------- الشراء ----------
    /** يحفظ الشراء، ويجعل تكلفة كل صنف = متوسط التكلفة المرجّح الجديد (مع سجل الأسعار). */
    async savePurchase(purchase) {
      const ctx = getContext();
      const [cashSessionId, cashId] = await Promise.all([openSessionId(), cashMethodId()]);
      return store.write(async (w) => {
        const seq = await nextSeq('purchase');
        const r = buildPurchase(purchase, { newId: uuid, now: clock(), prefix: ctx.prefix || 'A', seq, cashSessionId, cashMethodId: cashId, deviceId: ctx.deviceId });
        await w.put('invoices', r.invoice);
        for (const l of r.lines) await w.append('invoice_lines', l);
        for (const m of r.movements) await w.append('movements', m);
        for (const p of r.payments) await w.append('payments', p);
        for (const e of r.supplierEntries) await w.append('supplier_entries', e);
        for (const pid of new Set(r.movements.map((m) => m.product_id))) {
          // البضاعة دخلت المحل أو مخزنًا خارجيًا: متوسط التكلفة من مكان دخولها
          const [p, s] = await Promise.all([db.products.get(pid), purchase.branchId ? db.wh_stock.get([purchase.branchId, pid]) : db.stock.get(pid)]);
          if (p && s && s.avgCost > 0 && s.avgCost !== p.cost_price) {
            await w.append('price_history', { product_id: pid, old_sell: p.sell_price, new_sell: p.sell_price, old_cost: p.cost_price, new_cost: s.avgCost, reason: 'purchase' });
            await w.put('products', { ...p, cost_price: s.avgCost });
          }
        }
        await db.meta.delete('purchase:current');
        return { invoice: r.invoice, total: r.total };
      });
    },
    async loadDraft() { return (await db.meta.get('purchase:current'))?.value || null; },
    saveDraft(d) { return d && d.lines.length ? db.meta.put({ key: 'purchase:current', value: d }) : db.meta.delete('purchase:current'); },

    // ---------- التجار (الموردون) وما عليك لهم ----------
    // الرصيد لا يُحفظ: مجموع قيود التاجر (بضاعة بالدين +، رصيد سابق +، دفعة له −، مرتجع −).
    async suppliers() {
      const [ss, entries] = await Promise.all([db.suppliers.toArray(), db.supplier_entries.toArray()]);
      const by = new Map();
      for (const e of entries) { if (!by.has(e.supplier_id)) by.set(e.supplier_id, []); by.get(e.supplier_id).push(e); }
      return ss.filter((s) => !s.deleted).map((s) => {
        const all = by.get(s.id) || [];
        const balance = balanceOf(all);
        return { ...s, balance, oldestUnpaidAt: balance > 0 ? oldestUnpaidAt(effectiveEntries(all)) : null };
      }).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'ar'));
    },
    searchSuppliers(list, query) {
      const q = normalizeArabic(query);
      if (!q) return list;
      const digits = normalizeBarcode(query).replace(/\D/g, '').replace(/^0+/, '');
      return list.filter((s) => normalizeArabic(s.name).includes(q) || (digits && s.phone && s.phone.replace(/\D/g, '').includes(digits)));
    },
    /** total: مجموع ما عليك للتجار، count: عددهم، credit: ما لك عندهم (دفعت أكثر أو مرتجع)، suppliers: عدد التجار كلهم. */
    async supplierTotals() {
      const all = await repo.suppliers();
      const owing = all.filter((s) => s.balance > 0);
      return { total: sum(owing, (s) => s.balance), count: owing.length, credit: sum(all.filter((s) => s.balance < 0), (s) => -s.balance), suppliers: all.length };
    },
    /** التاجر مع كشف حسابه (الأحدث أولًا، الملغى بعلامة) ورصيده وتاريخ أقدم دين لم تسدّده. */
    async supplier(id) {
      const s = await db.suppliers.get(id);
      if (!s || s.deleted) return null;
      const entries = await db.supplier_entries.where('supplier_id').equals(id).toArray();
      const effective = effectiveEntries(entries);
      return { ...s, balance: balanceOf(entries), entries: ledgerView(entries), raw: effective, oldestUnpaidAt: oldestUnpaidAt(effective) };
    },
    /**
     * تاجر جديد أو تعديله. opening (للجديد فقط): ما عليك له الآن من دفترك القديم — يُسجَّل «رصيد سابق».
     */
    async saveSupplier({ id, name, phone = null, note = null, opening = 0 }) {
      const n = String(name || '').trim();
      if (!n) throw invalid({ name: 'اكتب اسم التاجر' });
      if (!Number.isSafeInteger(opening) || opening < 0) throw invalid({ opening: 'الرصيد السابق غير صحيح' });
      const data = { name: n, phone: phone ? normalizeBarcode(phone) : null, note: note ? String(note).trim() : null };
      if (id) return store.patch('suppliers', id, data);
      return store.write(async (w) => {
        const row = await w.put('suppliers', data);
        if (opening > 0) await w.append('supplier_entries', { supplier_id: row.id, type: 'opening', amount: opening });
        return row;
      });
    },
    removeSupplier(id) { return store.remove('suppliers', id); },
    restoreSupplier(id) { return store.patch('suppliers', id, { deleted: false }); },

    /** دين جديد عليك للتاجر بلا فاتورة أصناف («أخذت بضاعة بـ 800»). لا يغيّر المخزون. */
    async addSupplierDebt(supplierId, amount, note = null) {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid({ amount: 'اكتب مبلغ الدين' });
      return store.append('supplier_entries', { supplier_id: supplierId, type: 'adjustment', amount, note: note ? String(note).trim() || null : null });
    },

    /**
     * دفعة للتاجر: تنقص ما عليك له. نقدًا (الافتراضي) تخرج من الدرج؛ تحويل أو محفظة لا يمسّان الدرج.
     * method: طريقة الدفع { id, kind } أو null = نقدًا.
     */
    async paySupplier(supplierId, amount, { method = null, note = null } = {}) {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid({ amount: 'اكتب مبلغ الدفعة' });
      const [cashSessionId, cashId] = await Promise.all([openSessionId(), cashMethodId()]);
      return store.write((w) => writeSupplierPayment(w, { supplierId, amount, method, note, cashSessionId, cashId }));
    },

    /**
     * حذف قيد يدوي (دين أو دفعة أو رصيد سابق): لا يُمحى شيء، بل يُضاف قيد عكسي، والدفعة تُصحَّح في الدرج أيضًا.
     * يرجع القيد العكسي (لـ «تراجع»: voidSupplierEntry عليه يعيد الأصلي).
     */
    async voidSupplierEntry(entry) {
      const cashSessionId = await openSessionId();
      return store.write((w) => writeSupplierVoid(w, entry, cashSessionId));
    },

    /** تعديل مبلغ قيد يدوي أو ملاحظته = إلغاؤه + قيد جديد مكانه في نفس تاريخه بالكشف، في معاملة واحدة. */
    async editSupplierEntry(entry, amount, note = null) {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid({ amount: 'اكتب المبلغ' });
      const [cashSessionId, cashId] = await Promise.all([openSessionId(), cashMethodId()]);
      const cleanNote = note === null ? entry.note : (String(note).trim() || null);
      return store.write(async (w) => {
        await writeSupplierVoid(w, entry, cashSessionId);
        if (entry.type === 'payment') {
          const orig = entry.payment_id ? await db.payments.get(entry.payment_id) : null;
          const method = orig && orig.method_kind === 'transfer' ? { id: orig.method_id, kind: 'transfer' } : null;
          return writeSupplierPayment(w, { supplierId: entry.supplier_id, amount, method, note: cleanNote, cashSessionId, cashId, entryAt: entry.created_at });
        }
        const sign = entry.amount < 0 ? -1 : 1;
        return w.append('supplier_entries', { supplier_id: entry.supplier_id, type: entry.type, amount: sign * amount, note: cleanNote, created_at: entry.created_at });
      });
    },

    // ---------- التنبيهات ----------
    async productsWithStock() {
      const [products, stock] = await Promise.all([db.products.toArray(), db.stock.toArray()]);
      const st = new Map(stock.map((s) => [s.product_id, s]));
      return products.filter((p) => !p.deleted).map((p) => ({ ...p, qty: st.get(p.id)?.qty ?? 0, avg_cost: knownCost(st.get(p.id)?.avgCost, p.cost_price), last_sale_at: st.get(p.id)?.last_sale_at ?? null }));
    },
    /** المباع من كل صنف منذ تاريخ (بالوحدة الأساسية وبالألف، بعد طرح المرتجع): Map(product_id → qty) */
    async soldSince(fromIso) {
      const ms = await db.movements.where('created_at').aboveOrEqual(fromIso).toArray();
      const out = new Map();
      for (const m of ms) {
        if (m.type !== 'sale' && m.type !== 'sale_return') continue;
        out.set(m.product_id, (out.get(m.product_id) || 0) - m.qty);
      }
      return out;
    },
    /** المساعد: ما يخلص قريبًا (بسرعة البيع) والراكد (بقيمته). */
    async assistant({ now = Date.now() } = {}) {
      const products = await repo.productsWithStock();
      const sold = await repo.soldSince(new Date(now - VELOCITY_DAYS * 86400000).toISOString());
      return { soon: reorderPlan(products, sold, { now }), dead: deadStock(products, { now }) };
    },
    async alerts({ expiry = true } = {}) {
      return stockAlerts(await repo.productsWithStock(), { expiry });
    },

    // ---------- التالف ----------
    async damage(productId, qty, note = null) {
      if (!Number.isSafeInteger(qty) || qty <= 0) throw invalid({ qty: 'اكتب الكمية التالفة' });
      const s = await db.stock.get(productId);
      const p = await db.products.get(productId);
      return store.append('movements', { product_id: productId, type: 'damage', qty: signedQty('damage', qty), unit_cost: knownCost(s ? s.avgCost : 0, p ? p.cost_price : 0) || null, note });
    },

    // ---------- المخازن الخارجية ----------
    // المخزن سجل في branches (غير الرئيسي). حركاته تحمل branch_id، فلا تدخل في مخزون المحل الذي يُباع منه.
    async warehouses() {
      const [branches, stock, products] = await Promise.all([db.branches.toArray(), db.wh_stock.toArray(), db.products.toArray()]);
      const prod = new Map(products.filter((p) => !p.deleted).map((p) => [p.id, p]));
      return branches.filter((b) => !b.deleted && !b.is_main).map((b) => {
        const rows = stock.filter((s) => s.branch_id === b.id && s.qty > 0 && prod.has(s.product_id));
        return { ...b, items: rows.length, value: rows.reduce((a, s) => a + stockValue(s.qty, knownCost(s.avgCost, prod.get(s.product_id).cost_price)), 0) };
      }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    },
    async saveWarehouse({ id = null, name }) {
      const n = String(name || '').trim();
      if (!n) throw invalid({ name: 'اكتب اسم المخزن' });
      const same = (await db.branches.toArray()).find((b) => !b.deleted && !b.is_main && b.name === n && b.id !== id);
      if (same) throw invalid({ name: 'يوجد مخزن بهذا الاسم' });
      return id ? store.patch('branches', id, { name: n }) : store.put('branches', { name: n, is_main: false });
    },
    /** لا يُحذف مخزن فيه بضاعة: انقلها أو صفّرها أولًا. */
    async removeWarehouse(id) {
      if ((await db.wh_stock.where('branch_id').equals(id).toArray()).some((s) => s.qty > 0)) throw invalid({ name: 'في المخزن بضاعة — انقلها إلى المحل أولًا' });
      return store.remove('branches', id);
    },
    /** أصناف مكان مع كمياتها: branchId = مخزن، أو null = المحل. كل الأصناف (حتى ما كميته صفر) للاختيار منها. */
    async stockAt(branchId = null) {
      if (!branchId) return repo.productsWithStock();
      const [products, stock] = await Promise.all([db.products.toArray(), db.wh_stock.where('branch_id').equals(branchId).toArray()]);
      const st = new Map(stock.map((s) => [s.product_id, s]));
      return products.filter((p) => !p.deleted).map((p) => ({ ...p, qty: st.get(p.id)?.qty ?? 0, avg_cost: knownCost(st.get(p.id)?.avgCost, p.cost_price) }));
    },
    /** كمية كل صنف في المخازن كلها: Map(product_id → [{ branch_id, qty }]) — لعرض «في المخزن 40» بجانب مخزون المحل. */
    async warehouseQty() {
      const out = new Map();
      for (const s of await db.wh_stock.toArray()) {
        if (s.qty <= 0) continue;
        if (!out.has(s.product_id)) out.set(s.product_id, []);
        out.get(s.product_id).push({ branch_id: s.branch_id, qty: s.qty });
      }
      return out;
    },
    /**
     * يضبط الكمية الموجودة فعلًا من صنف في مخزن (بضاعة موجودة من قبل، أو تصحيح): حركة بالفرق.
     * أول إدخال = رصيد افتتاحي بتكلفة الصنف.
     */
    async setWarehouseQty(branchId, productId, actual) {
      if (!Number.isSafeInteger(actual) || actual < 0) throw invalid({ qty: 'اكتب الكمية الموجودة في المخزن' });
      const [p, s] = await Promise.all([db.products.get(productId), db.wh_stock.get([branchId, productId])]);
      if (!p || p.deleted) throw invalid({ qty: 'الصنف غير موجود' });
      const diff = actual - (s ? s.qty : 0);
      if (diff === 0) return null;
      const first = !s;
      return store.append('movements', {
        branch_id: branchId, product_id: productId, type: first ? 'opening' : 'adjustment', qty: first ? signedQty('opening', diff) : diff,
        unit_cost: knownCost(s ? s.avgCost : 0, p.cost_price) || null, note: first ? 'بضاعة موجودة في المخزن' : 'تصحيح كمية المخزن',
      });
    },
    /**
     * نقل بضاعة: from / to = معرّف مخزن أو null للمحل. lines: [{ product_id, name, qty }].
     * لا يُنقل أكثر من الموجود في المصدر. يرجع { transferId, count }.
     */
    async transfer({ from = null, to = null, lines, note = null }) {
      const full = [];
      for (const l of lines) {
        const [p, s] = await Promise.all([db.products.get(l.product_id), from ? db.wh_stock.get([from, l.product_id]) : db.stock.get(l.product_id)]);
        full.push({ ...l, available: s ? Math.max(0, s.qty) : 0, unit_cost: knownCost(s ? s.avgCost : 0, p ? p.cost_price : 0) });
      }
      const r = buildTransfer({ lines: full, from, to, note: note ? String(note).trim() || null : null }, { newId: uuid, now: clock() });
      await store.write(async (w) => { for (const m of r.movements) await w.append('movements', m); });
      return { transferId: r.transferId, count: full.length };
    },
    /** آخر عمليات النقل، مع أسماء الأصناف. */
    async transfers(limit = 30) {
      const [ms, products] = await Promise.all([db.movements.where('[ref_type+ref_id]').between(['transfer', ''], ['transfer', '\uffff']).toArray(), db.products.toArray()]);
      const names = new Map(products.map((p) => [p.id, p]));
      return transferHistory(ms).slice(0, limit).map((t) => ({ ...t, items: t.items.map((i) => ({ ...i, name: names.get(i.product_id)?.name || 'صنف محذوف', unit: names.get(i.product_id)?.unit || 'piece' })) }));
    },

    // ---------- الجرد ----------
    /** counted: [{ product_id, name, recorded, actual, unit_cost }] — ينشئ حركات تسوية بالفروق ويحفظ سجل الجرد. */
    async applyCount(counted) {
      // الفرق يُحسب من المخزون وقت الاعتماد (قد يكون بِيع شيء أثناء الجرد)
      const fresh = [];
      for (const c of counted) {
        const s = await db.stock.get(c.product_id);
        fresh.push({ ...c, recorded: s ? s.qty : 0, unit_cost: s ? s.avgCost : c.unit_cost });
      }
      const sm = countSummary(fresh);
      return store.write(async (w) => {
        const count = await w.put('stock_counts', { status: 'applied', diff_value: sm.diffValue, applied_at: clock(), note: `${sm.rows.length} صنف` });
        for (const r of sm.changed) {
          await w.append('movements', { product_id: r.product_id, type: 'adjustment', qty: r.diff, unit_cost: r.unit_cost, ref_type: 'stock_count', ref_id: count.id, note: 'جرد' });
        }
        await db.meta.delete('count:current');
        return { diffValue: sm.diffValue, changed: sm.changed.length, counted: sm.rows.length };
      });
    },
    async loadCount() { return (await db.meta.get('count:current'))?.value || []; },
    saveCount(items) { return items.length ? db.meta.put({ key: 'count:current', value: items }) : db.meta.delete('count:current'); },
  };
  return repo;
}
