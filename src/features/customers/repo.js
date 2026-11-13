// الزبائن على الجهاز. الرصيد لا يُحفظ أبدًا: مجموع قيود الزبون (بيع آجل +، دفعة −، مرتجع −).
// (أساس المرحلة 3: كشف الحساب والدفعات والاستيراد من دفترة تُبنى فوقه.)
import { normalizeArabic, normalizeBarcode } from '../../domain/product.js';
import { sum } from '../../domain/money.js';

export function createCustomerRepo({ db, store }) {
  const repo = {
    async list() {
      const [cs, entries] = await Promise.all([db.customers.toArray(), db.customer_entries.toArray()]);
      const bal = new Map();
      for (const e of entries) bal.set(e.customer_id, (bal.get(e.customer_id) || 0) + e.amount);
      return cs.filter((c) => !c.deleted).map((c) => ({ ...c, balance: bal.get(c.id) || 0 }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    },
    search(list, query) {
      const q = normalizeArabic(query);
      if (!q) return list;
      const digits = normalizeBarcode(query).replace(/^0+/, '');
      return list.filter((c) => normalizeArabic(c.name).includes(q) || (digits && c.phone && c.phone.replace(/\D/g, '').includes(digits)));
    },
    async balance(id) {
      return sum(await db.customer_entries.where('customer_id').equals(id).toArray(), (e) => e.amount);
    },
    async create({ name, phone = null }) {
      const n = String(name || '').trim();
      if (!n) throw Object.assign(new Error('invalid'), { errors: { name: 'اكتب اسم الزبون' } });
      return store.put('customers', { name: n, phone: phone ? normalizeBarcode(phone) : null });
    },
  };
  return repo;
}
