// المخزون على الجهاز: الشراء (يحدّث المخزون ومتوسط التكلفة)، الموردون وحساباتهم، الجرد، التالف، والتنبيهات.
// كل تغيير في الكمية حركة تُضاف — لا رقم يُعدَّل.
import { buildPurchase, stockAlerts, countSummary } from '../../domain/inventory.js';
import { statement } from '../../domain/ledger.js';
import { signedQty } from '../../domain/stock.js';
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
          const [p, s] = await Promise.all([db.products.get(pid), db.stock.get(pid)]);
          if (p && s && s.avgCost !== p.cost_price) {
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

    // ---------- الموردون ----------
    async suppliers() {
      const [ss, entries] = await Promise.all([db.suppliers.toArray(), db.supplier_entries.toArray()]);
      const bal = new Map();
      for (const e of entries) bal.set(e.supplier_id, (bal.get(e.supplier_id) || 0) + e.amount);
      return ss.filter((s) => !s.deleted).map((s) => ({ ...s, balance: bal.get(s.id) || 0 }))
        .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'ar'));
    },
    searchSuppliers(list, query) {
      const q = normalizeArabic(query);
      return q ? list.filter((s) => normalizeArabic(s.name).includes(q)) : list;
    },
    async supplierTotals() {
      const owing = (await repo.suppliers()).filter((s) => s.balance > 0);
      return { total: sum(owing, (s) => s.balance), count: owing.length };
    },
    async supplier(id) {
      const s = await db.suppliers.get(id);
      if (!s || s.deleted) return null;
      const rows = statement(await db.supplier_entries.where('supplier_id').equals(id).toArray());
      return { ...s, balance: rows.length ? rows[rows.length - 1].balance : 0, entries: rows.reverse() };
    },
    async saveSupplier({ id, name, phone = null, note = null }) {
      const n = String(name || '').trim();
      if (!n) throw invalid({ name: 'اكتب اسم المورّد' });
      const data = { name: n, phone: phone ? normalizeBarcode(phone) : null, note: note ? String(note).trim() : null };
      return id ? store.patch('suppliers', id, data) : store.put('suppliers', data);
    },
    removeSupplier(id) { return store.remove('suppliers', id); },
    restoreSupplier(id) { return store.patch('suppliers', id, { deleted: false }); },
    /** دفعة للمورّد: تنقص ما عليك له، وتخرج من الدرج. */
    async paySupplier(supplierId, amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid({ amount: 'اكتب مبلغ الدفعة' });
      const [cashSessionId, cashId] = await Promise.all([openSessionId(), cashMethodId()]);
      return store.write(async (w) => {
        const pid = uuid();
        await w.append('payments', { id: pid, supplier_id: supplierId, direction: 'out', method_id: cashId, method_kind: 'cash', amount, cash_session_id: cashSessionId, note: 'دفعة لمورّد' });
        return w.append('supplier_entries', { supplier_id: supplierId, type: 'payment', amount: -amount, payment_id: pid });
      });
    },

    // ---------- التنبيهات ----------
    async productsWithStock() {
      const [products, stock] = await Promise.all([db.products.toArray(), db.stock.toArray()]);
      const st = new Map(stock.map((s) => [s.product_id, s]));
      return products.filter((p) => !p.deleted).map((p) => ({ ...p, qty: st.get(p.id)?.qty ?? 0, avg_cost: st.get(p.id)?.avgCost ?? p.cost_price, last_sale_at: st.get(p.id)?.last_sale_at ?? null }));
    },
    async alerts({ expiry = true } = {}) {
      return stockAlerts(await repo.productsWithStock(), { expiry });
    },

    // ---------- التالف ----------
    async damage(productId, qty, note = null) {
      if (!Number.isSafeInteger(qty) || qty <= 0) throw invalid({ qty: 'اكتب الكمية التالفة' });
      const s = await db.stock.get(productId);
      return store.append('movements', { product_id: productId, type: 'damage', qty: signedQty('damage', qty), unit_cost: s ? s.avgCost : null, note });
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
