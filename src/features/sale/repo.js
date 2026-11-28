// حفظ البيع والمرتجع والسلال المعلّقة على الجهاز. كل بيع معاملة واحدة: الفاتورة وسطورها والدفعات
// وحركات المخزون وقيد دين الزبون — إما كلها أو لا شيء. رقم الفاتورة من عدّاد هذا الجهاز (A-0001…).
import { buildSale, buildReturn, returnableLines, creditLeft, buildVoid, voidProblem } from '../../domain/cart.js';
import { priorReturns } from '../../domain/tax.js';
import { uuid } from '../../core/ids.js';

/** هل يُكمل هذا المرتجع كل ما بقي من الفاتورة؟ */
export function completesReturn(rows, picks) {
  const q = new Map(picks.map((p) => [p.line.id, p.qty]));
  return rows.every((r) => (q.get(r.line.id) || 0) === r.returnable);
}

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

  /** الفاتورة وكل ما كُتب معها (للإلغاء): سطورها ودفعاتها وقيد دينها ومرتجعاتها. */
  async function invoiceData(invoiceId) {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) return { invoice: null, lines: [], payments: [], entries: [], returns: [] };
    const [lines, payments, entries, returns] = await Promise.all([
      db.invoice_lines.where('invoice_id').equals(invoiceId).toArray(),
      db.payments.where('invoice_id').equals(invoiceId).toArray(),
      invoice.customer_id ? db.customer_entries.where('customer_id').equals(invoice.customer_id).toArray() : [],
      returnsOf(invoiceId),
    ]);
    return { invoice, lines: lines.sort((a, b) => (a.position || 0) - (b.position || 0)), payments, entries: entries.filter((e) => e.invoice_id === invoiceId), returns };
  }
  async function returnsOf(invoiceId) {
    return (await db.invoices.where('type').equals('sale_return').toArray()).filter((r) => r.original_invoice_id === invoiceId && !r.deleted && r.status !== 'void');
  }
  async function voidable(invoiceId) {
    const d = await invoiceData(invoiceId);
    const problem = voidProblem(d.invoice, d.returns);
    if (problem) throw new Error(problem);
    return d;
  }
  /** داخل معاملة: الحركات العكسية + الفاتورة تصير ملغاة + سطر في سجل العمليات (من ومتى). */
  async function writeVoid(w, d, { now, cashSessionId, action }) {
    const v = buildVoid(d, { newId: uuid, now, cashSessionId });
    for (const p of v.payments) await w.append('payments', p);
    for (const m of v.movements) await w.append('movements', m);
    for (const e of v.customerEntries) await w.append('customer_entries', e);
    const invoice = await w.patch('invoices', d.invoice.id, { status: 'void' });
    await w.append('audit_log', {
      user_id: w.ctx.userId ?? null, action, entity: 'invoice', entity_id: d.invoice.id,
      data: { number: d.invoice.number, total: d.invoice.total, refund: v.refund, credit: v.credit }, created_at: now,
    });
    return { invoice, refund: v.refund, credit: v.credit };
  }

  const repo = {
    async paymentMethods() {
      return (await db.payment_methods.orderBy('sort').toArray()).filter((m) => !m.deleted && m.active);
    },

    /**
     * يحفظ البيع. يرجع { invoice, change, profit }.
     * sale.replaces = رقم فاتورة تُعدَّل: تُلغى الأصلية وتُحفظ هذه مكانها برقمها وتاريخها — في المعاملة نفسها.
     */
    async checkout(sale) {
      const ctx = getContext();
      const cashSessionId = await openSessionId();
      const old = sale.replaces ? await voidable(sale.replaces) : null;
      return store.write(async (w) => {
        const now = clock();
        if (old) await writeVoid(w, old, { now, cashSessionId, action: 'invoice_edit' });
        const seq = old ? old.invoice.seq : await nextSeq('sale');
        const r = buildSale(sale, {
          newId: uuid, now, prefix: ctx.prefix || 'A', seq,
          currency: sale.currency || (old ? old.invoice.currency : 'ILS'), cashSessionId, deviceId: ctx.deviceId,
          replaces: old ? old.invoice : null,
        });
        await writeAll(w, r);
        await db.meta.delete('cart:current');
        return { invoice: r.invoice, change: r.change, profit: r.profit };
      });
    },

    // ---------- إلغاء الفاتورة وتعديلها ----------
    /** ما يُعرض قبل الإلغاء أو التعديل: { problem (سبب المنع أو null), invoice, lines, refund, credit }. */
    async voidPreview(invoiceId) {
      const d = await invoiceData(invoiceId);
      const problem = voidProblem(d.invoice, d.returns);
      if (problem) return { problem, invoice: d.invoice, lines: d.lines, refund: 0, credit: 0 };
      const v = buildVoid(d, { newId: uuid, now: clock(), cashSessionId: null });
      return { problem: null, invoice: d.invoice, lines: d.lines, refund: v.refund, credit: v.credit };
    },
    /** يلغي فاتورة بيع: البضاعة ترجع، ما دُفع يخرج من الصندوق، ودين الزبون ينزل. يرجع { invoice, refund, credit }. */
    async voidInvoice(invoiceId) {
      const d = await voidable(invoiceId);
      const cashSessionId = await openSessionId();
      return store.write((w) => writeVoid(w, d, { now: clock(), cashSessionId, action: 'invoice_void' }));
    },
    /** من ألغى الفاتورة أو عدّلها ومتى (من سجل العمليات): { action, user_id, created_at } أو null. */
    async voidInfo(invoiceId) {
      const rows = (await db.audit_log.toArray()).filter((a) => a.entity === 'invoice' && a.entity_id === invoiceId);
      return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null;
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
      return (await db.invoices.orderBy('created_at').reverse().limit(limit * 3).toArray())
        .filter((i) => i.type === 'sale' && !i.deleted && i.status !== 'void').slice(0, limit);
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
      const returns = await returnsOf(invoiceId);
      const prev = [];
      for (const r of returns) prev.push(...(await db.invoice_lines.where('invoice_id').equals(r.id).toArray()));
      // creditLeft: ما بقي دينًا من هذه الفاتورة — المرتجع يُخصم منه أولًا (refund = 'auto')
      // prior: ما رُدّ في مرتجعاتها السابقة (لضريبة المرتجع التالي: تُحسب تراكميًا)
      return { invoice, lines, rows: returnableLines(lines, prev), creditLeft: invoice.customer_id ? creditLeft(invoice, returns) : 0, prior: priorReturns(returns) };
    },
    /** picks: [{ line, qty }] ؛ refund: 'auto' (كما دُفعت: من الدين أولًا) | 'cash' | 'credit' */
    async processReturn(invoiceId, picks, refund) {
      const ctx = getContext();
      const { invoice, lines, rows, creditLeft: left, prior } = await repo.returnable(invoiceId);
      for (const p of picks) {
        const row = rows.find((r) => r.line.id === p.line.id);
        if (!row || p.qty > row.returnable) throw new Error('الكمية أكبر مما يمكن إرجاعه');
      }
      const cashSessionId = await openSessionId();
      const cash = (await repo.paymentMethods()).find((m) => m.kind === 'cash');
      return store.write(async (w) => {
        const seq = await nextSeq('sale_return');
        const r = buildReturn(invoice, lines, picks.map((p) => ({ line: lines.find((l) => l.id === p.line.id), qty: p.qty })), refund, {
          newId: uuid, now: clock(), prefix: ctx.prefix || 'A', seq, cashSessionId, cashMethodId: cash?.id, deviceId: ctx.deviceId, creditLeft: left, prior, completes: completesReturn(rows, picks),
        });
        await writeAll(w, r);
        return { invoice: r.invoice, total: r.total, credit: r.credit, cash: r.cash };
      });
    },
  };
  return repo;
}
