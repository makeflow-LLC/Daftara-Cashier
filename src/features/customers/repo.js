// الزبائن على الجهاز. الرصيد لا يُحفظ أبدًا: مجموع قيود الزبون (دين +، دفعة −، مرتجع −).
import { normalizeArabic, normalizeBarcode } from '../../domain/product.js';
import { sum } from '../../domain/money.js';
import { statement, oldestUnpaidAt } from '../../domain/ledger.js';
import { uuid } from '../../core/ids.js';

export function createCustomerRepo({ db, store }) {
  function invalid(errors) { return Object.assign(new Error('invalid'), { errors }); }

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
      const rows = statement(entries);
      return { ...c, balance: rows.length ? rows[rows.length - 1].balance : 0, entries: rows.reverse(), raw: entries, oldestUnpaidAt: oldestUnpaidAt(entries) };
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
      const session = (await db.cash_sessions.orderBy('opened_at').reverse().limit(5).toArray()).find((s) => !s.deleted && !s.closed_at);
      const kind = method && method.kind === 'transfer' ? 'transfer' : 'cash';
      return store.write(async (w) => {
        const paymentId = uuid();
        await w.append('payments', {
          id: paymentId, customer_id: customerId, direction: 'in', method_id: method ? method.id : null, method_kind: kind,
          amount, cash_session_id: kind === 'cash' && session ? session.id : null, note: 'دفعة من دين',
        });
        return w.append('customer_entries', { customer_id: customerId, type: 'payment', amount: -amount, payment_id: paymentId });
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
