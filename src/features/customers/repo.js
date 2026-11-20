// الزبائن على الجهاز. الرصيد لا يُحفظ أبدًا: مجموع قيود الزبون (دين +، دفعة −، مرتجع −).
import { normalizeArabic, normalizeBarcode } from '../../domain/product.js';
import { sum } from '../../domain/money.js';
import { oldestUnpaidAt, ledgerView, effectiveEntries, balanceOf, editableEntry, cancelledIds, isVoidEntry, VOID_PREFIX } from '../../domain/ledger.js';
import { formatInvoiceNumber } from '../../domain/numbering.js';
import { uuid } from '../../core/ids.js';

export function createCustomerRepo({ db, store, getContext = () => ({}) }) {
  function invalid(errors) { return Object.assign(new Error('invalid'), { errors }); }

  async function openSession() {
    return (await db.cash_sessions.orderBy('opened_at').reverse().limit(5).toArray()).find((x) => !x.deleted && !x.closed_at) || null;
  }
  /** رقم سند القبض التالي من عدّاد هذا الجهاز (A-V0001) — داخل نفس معاملة الحفظ. */
  async function nextReceiptNumber() {
    const seq = ((await db.meta.get('seq:receipt'))?.value || 0) + 1;
    await db.meta.put({ key: 'seq:receipt', value: seq });
    const prefix = getContext().prefix;
    return formatInvoiceNumber(/^[A-Z]{1,3}$/.test(prefix || '') ? prefix : 'A', 'receipt', seq);
  }
  async function writePayment(w, { customerId, amount, method_id, kind, session, entryAt = null, number = null }) {
    const paymentId = uuid();
    await w.append('payments', {
      id: paymentId, customer_id: customerId, direction: 'in', method_id, method_kind: kind,
      amount, cash_session_id: kind === 'cash' && session ? session.id : null, note: 'دفعة من دين',
      number: number || await nextReceiptNumber(), // كل دفعة لها سند قبض برقم
    });
    return w.append('customer_entries', { customer_id: customerId, type: 'payment', amount: -amount, payment_id: paymentId, ...(entryAt ? { created_at: entryAt } : {}) });
  }
  async function writeVoid(w, entry, session) {
    if (!editableEntry(entry) && !String(entry.note || '').startsWith(VOID_PREFIX)) throw invalid({ amount: 'هذه الحركة من فاتورة — صحّحها بمرتجع من الفاتورة' });
    let paymentId = null;
    if (entry.payment_id) {
      // الدفعة دخلت الدرج: نُخرجها منه (أو العكس عند التراجع)
      const orig = await db.payments.get(entry.payment_id);
      if (orig) {
        paymentId = uuid();
        await w.append('payments', {
          id: paymentId, customer_id: entry.customer_id, direction: orig.direction === 'in' ? 'out' : 'in',
          method_id: orig.method_id, method_kind: orig.method_kind, amount: orig.amount,
          cash_session_id: orig.method_kind === 'cash' && session ? session.id : null, note: 'تصحيح دفعة',
        });
      }
    }
    return w.append('customer_entries', {
      customer_id: entry.customer_id, type: entry.type, amount: -entry.amount, payment_id: paymentId, note: `${VOID_PREFIX}${entry.id}`,
    });
  }

  const repo = {
    /** كل الزبائن مع أرصدتهم؛ الأكثر دينًا أولًا. */
    async list() {
      const [cs, entries] = await Promise.all([db.customers.toArray(), db.customer_entries.toArray()]);
      const bal = new Map();
      for (const e of entries) bal.set(e.customer_id, (bal.get(e.customer_id) || 0) + e.amount);
      return cs.filter((c) => !c.deleted).map((c) => ({ ...c, balance: bal.get(c.id) || 0 }))
        .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'ar'));
    },
    search(list, query) {
      const q = normalizeArabic(query);
      if (!q) return list;
      const digits = normalizeBarcode(query).replace(/\D/g, '').replace(/^0+/, '');
      return list.filter((c) => normalizeArabic(c.name).includes(q) || (digits && c.phone && c.phone.replace(/\D/g, '').includes(digits)));
    },
    /** الزبائن الذين عليهم دين، مع تاريخ أقدم دين غير مسدَّد (للتذكير الجماعي). */
    async debtors() {
      const [cs, entries] = await Promise.all([db.customers.toArray(), db.customer_entries.toArray()]);
      const by = new Map();
      for (const e of entries) { if (!by.has(e.customer_id)) by.set(e.customer_id, []); by.get(e.customer_id).push(e); }
      const out = [];
      for (const c of cs) {
        if (c.deleted) continue;
        const all = by.get(c.id) || [];
        const balance = balanceOf(all);
        if (balance <= 0) continue;
        out.push({ ...c, balance, oldestUnpaidAt: oldestUnpaidAt(effectiveEntries(all)) });
      }
      return out.sort((a, b) => b.balance - a.balance);
    },
    /** مجموع ما على الزبائن (الأرصدة الموجبة فقط) وعدد المدينين. */
    async totals() {
      const list = await repo.list();
      const owing = list.filter((c) => c.balance > 0);
      return { total: sum(owing, (c) => c.balance), count: owing.length, customers: list.length };
    },
    async balance(id) {
      return sum(await db.customer_entries.where('customer_id').equals(id).toArray(), (e) => e.amount);
    },
    /** الزبون مع كشف حسابه (الأحدث أولًا) ورصيده وتاريخ أقدم دين غير مسدَّد. */
    async get(id) {
      const c = await db.customers.get(id);
      if (!c || c.deleted) return null;
      const entries = await db.customer_entries.where('customer_id').equals(id).toArray();
      const effective = effectiveEntries(entries);
      return { ...c, balance: balanceOf(entries), entries: ledgerView(entries), raw: effective, oldestUnpaidAt: oldestUnpaidAt(effective) };
    },
    async create({ name, phone = null, note = null }) {
      const n = String(name || '').trim();
      if (!n) throw invalid({ name: 'اكتب اسم الزبون' });
      return store.put('customers', { name: n, phone: phone ? normalizeBarcode(phone) : null, note: note ? String(note).trim() : null });
    },
    async update(id, { name, phone, note }) {
      const n = String(name || '').trim();
      if (!n) throw invalid({ name: 'اكتب اسم الزبون' });
      return store.patch('customers', id, { name: n, phone: phone ? normalizeBarcode(phone) : null, note: note ? String(note).trim() : null });
    },
    remove(id) { return store.remove('customers', id); },
    restore(id) { return store.patch('customers', id, { deleted: false }); },

    /** دفعة من الزبون: تنقص دينه، وتدخل الدرج إن كانت نقدًا. */
    async recordPayment(customerId, amount, method = null) {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid({ amount: 'اكتب مبلغ الدفعة' });
      const session = await openSession();
      return store.write((w) => writePayment(w, { customerId, amount, method_id: method ? method.id : null, kind: method && method.kind === 'transfer' ? 'transfer' : 'cash', session }));
    },

    /**
     * بيانات سند القبض لدفعة: { payment, customer, methodName, balanceAfter, entry, cancelled } أو null.
     * balanceAfter = رصيد الزبون بعد هذه الدفعة مباشرة (من كشف حسابه).
     */
    async receipt(paymentId) {
      const payment = await db.payments.get(paymentId);
      if (!payment || !payment.customer_id) return null;
      const [customer, entries, method] = await Promise.all([
        db.customers.get(payment.customer_id),
        db.customer_entries.where('customer_id').equals(payment.customer_id).toArray(),
        payment.method_id ? db.payment_methods.get(payment.method_id) : null,
      ]);
      const entry = ledgerView(entries).find((e) => e.payment_id === paymentId) || null;
      return {
        payment, customer: customer || null, methodName: method ? method.name : null, entry,
        balanceAfter: entry && !entry.cancelled ? entry.balance : null, cancelled: !!(entry && entry.cancelled),
      };
    },
    /** سندات القبض (دفعات الزبائن من ديونهم) غير الملغاة، الأحدث أولًا: [{ payment, customerName }]. */
    async receipts(limit = 300) {
      const [payments, entries, customers] = await Promise.all([db.payments.toArray(), db.customer_entries.toArray(), db.customers.toArray()]);
      const gone = cancelledIds(entries); // دفعة حُذفت (قيد عكسي) لا سند لها
      const live = new Set(entries.filter((e) => e.type === 'payment' && e.payment_id && !isVoidEntry(e) && !gone.has(e.id)).map((e) => e.payment_id));
      const names = new Map(customers.map((c) => [c.id, c.name]));
      return payments.filter((p) => p.direction === 'in' && p.customer_id && !p.invoice_id && live.has(p.id))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit)
        .map((payment) => ({ payment, customerName: names.get(payment.customer_id) || '' }));
    },

    /**
     * حذف قيد (دين أو دفعة): لا يُمحى شيء، بل يُضاف قيد عكسي، والدفعة النقدية تُصحَّح في الدرج أيضًا.
     * يرجع القيد العكسي (لـ «تراجع»: voidEntry عليه يعيد الأصلي).
     */
    async voidEntry(entry) {
      const session = await openSession();
      return store.write((w) => writeVoid(w, entry, session));
    },

    /** تعديل مبلغ قيد أو ملاحظته = إلغاؤه + قيد جديد مكانه (في نفس تاريخه بالكشف)، في معاملة واحدة. */
    async editEntry(entry, amount, note = null) {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid({ amount: 'اكتب المبلغ' });
      const session = await openSession();
      return store.write(async (w) => {
        await writeVoid(w, entry, session);
        if (entry.type === 'payment') {
          const orig = entry.payment_id ? await db.payments.get(entry.payment_id) : null;
          return writePayment(w, {
            customerId: entry.customer_id, amount, method_id: orig ? orig.method_id : null,
            kind: orig && orig.method_kind === 'transfer' ? 'transfer' : 'cash', session, entryAt: entry.created_at,
            number: orig ? orig.number : null, // السند المعدَّل يحتفظ برقمه
          });
        }
        const sign = entry.amount < 0 ? -1 : 1;
        return w.append('customer_entries', {
          customer_id: entry.customer_id, type: entry.type, amount: sign * amount,
          note: note === null ? entry.note : (String(note).trim() || null), created_at: entry.created_at,
        });
      });
    },
    /** دين يدوي بلا فاتورة (مثل دفتر الديون): «أخذ بـ 20 شيكل». */
    async addDebt(customerId, amount, note = null) {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw invalid({ amount: 'اكتب مبلغ الدين' });
      return store.append('customer_entries', { customer_id: customerId, type: 'adjustment', amount, note: note ? String(note).trim() : null });
    },

    /**
     * استيراد من دفترة: قائمة parseDaftaraBackup. الزبون المستورد سابقًا (نفس المرجع) لا يتكرر،
     * فاستيراد الملف مرتين لا يضاعف الديون. يرجع { added, skipped, total }.
     */
    async importDaftara(list) {
      const existing = new Set((await db.customers.toArray()).filter((c) => c.source === 'daftara' && !c.deleted).map((c) => c.external_ref));
      let added = 0, skipped = 0, total = 0;
      await store.write(async (w) => {
        for (const c of list) {
          if (existing.has(c.ref)) { skipped++; continue; }
          const row = await w.put('customers', { name: c.name, phone: c.phone ? normalizeBarcode(c.phone) : null, note: c.note, source: 'daftara', external_ref: c.ref });
          if (c.balance !== 0) await w.append('customer_entries', { customer_id: row.id, type: 'import', amount: c.balance });
          added++;
          total += Math.max(0, c.balance);
        }
      });
      return { added, skipped, total };
    },
  };
  return repo;
}
