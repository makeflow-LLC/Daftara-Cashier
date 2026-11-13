// حفظ البيع والمرتجع والسلال المعلّقة على الجهاز. كل بيع معاملة واحدة: الفاتورة وسطورها والدفعات
// وحركات المخزون وقيد دين الزبون — إما كلها أو لا شيء. رقم الفاتورة من عدّاد هذا الجهاز (A-0001…).
import { buildSale, buildReturn, returnableLines } from '../../domain/cart.js';
import { uuid } from '../../core/ids.js';

export function createSaleRepo({ db, store, getContext, clock }) {
  async function nextSeq(type) {
    const key = `seq:${type}`;
    const seq = ((await db.meta.get(key))?.value || 0) + 1;
    await db.meta.put({ key, value: seq });
    return seq;
  }

  async function openSessionId() {
    const ctx = getContext();
    const s = (await db.cash_sessions.orderBy('opened_at').reverse().limit(10).toArray())
      .find((x) => !x.deleted && !x.closed_at && (!x.device_id || x.device_id === ctx.deviceId));
    return s ? s.id : null;
  }

  async function writeAll(w, r) {
    await w.put('invoices', r.invoice);
    for (const l of r.lines) await w.append('invoice_lines', l);
    for (const p of r.payments) await w.append('payments', p);
    for (const m of r.movements) await w.append('movements', m);
    for (const e of r.customerEntries) await w.append('customer_entries', e);
  }

  const repo = {
    async paymentMethods() {
      return (await db.payment_methods.orderBy('sort').toArray()).filter((m) => !m.deleted && m.active);
    },

    /** يحفظ البيع. يرجع { invoice, change, profit }. */
    async checkout(sale) {
      const ctx = getContext();
      const cashSessionId = await openSessionId();
      return store.write(async (w) => {
        const seq = await nextSeq('sale');
        const r = buildSale(sale, {
          newId: uuid, now: clock(), prefix: ctx.prefix || 'A', seq,
          currency: sale.currency || 'ILS', cashSessionId, deviceId: ctx.deviceId,
        });
        await writeAll(w, r);
        await db.meta.delete('cart:current');
        return { invoice: r.invoice, change: r.change, profit: r.profit };
      });
    },

    // ---------- السلة الحالية (تبقى لو أُغلق التطبيق فجأة) ----------
    async loadCurrent() { return (await db.meta.get('cart:current'))?.value || null; },
    saveCurrent(cart) { return cart && cart.lines.length ? db.meta.put({ key: 'cart:current', value: cart }) : db.meta.delete('cart:current'); },

    // ---------- السلال المعلّقة ----------
    async hold(cart, label = null) {
      const id = uuid();
      await db.held.put({ id, created_at: clock(), label, cart });
      return id;
    },
    async listHeld() { return db.held.orderBy('created_at').toArray(); },
    async takeHeld(id) {
      const h = await db.held.get(id);
      await db.held.delete(id);
      return h ? h.cart : null;
    },

    // ---------- الفواتير والمرتجع ----------
    async recentSales(limit = 50) {
      return (await db.invoices.orderBy('created_at').reverse().limit(limit * 2).toArray())
        .filter((i) => i.type === 'sale' && !i.deleted).slice(0, limit);
    },
    async invoice(id) {
      const inv = await db.invoices.get(id);
      if (!inv) return null;
      const lines = (await db.invoice_lines.where('invoice_id').equals(id).toArray()).sort((a, b) => (a.position || 0) - (b.position || 0));
      return { invoice: inv, lines };
    },
    /** سطور الفاتورة مع ما رُجع منها سابقًا وما يمكن إرجاعه. */
    async returnable(invoiceId) {
      const { invoice, lines } = await repo.invoice(invoiceId);
      const returns = (await db.invoices.where('type').equals('sale_return').toArray()).filter((r) => r.original_invoice_id === invoiceId && !r.deleted);
      const prev = [];
      for (const r of returns) prev.push(...(await db.invoice_lines.where('invoice_id').equals(r.id).toArray()));
      return { invoice, lines, rows: returnableLines(lines, prev) };
    },
    /** picks: [{ line, qty }] ؛ refund: 'cash' | 'credit' */
    async processReturn(invoiceId, picks, refund) {
      const ctx = getContext();
      const { invoice, lines, rows } = await repo.returnable(invoiceId);
      for (const p of picks) {
        const row = rows.find((r) => r.line.id === p.line.id);
        if (!row || p.qty > row.returnable) throw new Error('الكمية أكبر مما يمكن إرجاعه');
      }
      const cashSessionId = await openSessionId();
      const cash = (await repo.paymentMethods()).find((m) => m.kind === 'cash');
      return store.write(async (w) => {
        const seq = await nextSeq('sale_return');
        const r = buildReturn(invoice, lines, picks.map((p) => ({ line: lines.find((l) => l.id === p.line.id), qty: p.qty })), refund, {
          newId: uuid, now: clock(), prefix: ctx.prefix || 'A', seq, cashSessionId, cashMethodId: cash?.id, deviceId: ctx.deviceId,
        });
        await writeAll(w, r);
        return { invoice: r.invoice, total: r.total };
      });
    },
  };
  return repo;
}
