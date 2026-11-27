// مراكز التكلفة (نقي): «أي قسم يربح وأيها يخسر؟» — قسم، فرع، سيارة توزيع، مشروع.
// المراكز في settings.costCenters للمحل: [{ id, name, categories: [معرّفات تصنيفات], active }]
//   إيراد المركز وتكلفة بضاعته: من مبيعات التصنيفات المربوطة به (كل تصنيف لمركز واحد).
//   مصاريفه: كل مصروف أو سند اختير له المركز (expenses.cost_center، vouchers.cost_center).
// ما ليس له مركز يظهر في سطر «بلا مركز»، فمجموع الصافي = صافي ربح المحل في المدة.
import { divRound, allocate } from './money.js';
import { lineAmount } from './units.js';

export const NO_CENTER = 'none';

/** مراكز المحل بعد التنظيف. */
export function costCenters(settings) {
  const list = settings && Array.isArray(settings.costCenters) ? settings.costCenters : [];
  const out = [];
  const taken = new Set();
  for (const c of list) {
    const name = String(c?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!c || !c.id || !name) continue;
    // تصنيف لمركز واحد: الأول يأخذه
    const categories = (Array.isArray(c.categories) ? c.categories : []).filter((x) => x && !taken.has(x));
    categories.forEach((x) => taken.add(x));
    out.push({ id: String(c.id), name, categories, active: c.active !== false });
  }
  return out;
}

/** رسالة خطأ أو null. */
export function centerProblem({ name }, existing = [], exceptId = null) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) return 'اكتب اسم المركز';
  if (existing.some((c) => c.id !== exceptId && c.active !== false && c.name === n)) return 'يوجد مركز بهذا الاسم';
  return null;
}

/**
 * ربح كل مركز في فترة [from, to).
 * data: { invoices, lines, products, expenses, vouchers, accountTypes: Map('acc:<id>' → نوع الحساب الخاص) }
 * يرجع { rows: [{ id, name, sales, cost, expenses, other, net }], total: { … } } — rows فيها «بلا مركز» أخيرًا إن كان له حركة.
 */
export function centerReport(data, centers, { from = null, to = null } = {}) {
  const { invoices = [], lines = [], products = [], expenses = [], vouchers = [], accountTypes = new Map() } = data;
  const inRange = (d) => (!from || d >= from) && (!to || d < to);
  const active = new Set(centers.map((c) => c.id));
  const byCat = new Map();
  for (const c of centers) for (const cat of c.categories) byCat.set(cat, c.id);
  const catOf = new Map(products.map((p) => [p.id, p.category_id || null]));
  const acc = new Map();
  const row = (id) => {
    const k = id && active.has(id) ? id : NO_CENTER;
    if (!acc.has(k)) acc.set(k, { id: k, sales: 0, cost: 0, expenses: 0, other: 0 });
    return acc.get(k);
  };
  // المبيعات والمرتجعات سطرًا سطرًا: الصافي بعد خصم الفاتورة وضريبتها
  const inv = new Map();
  for (const i of invoices) {
    if (i.deleted || i.status !== 'final' || !inRange(i.created_at)) continue;
    if (i.type === 'sale' || i.type === 'sale_return') inv.set(i.id, { i, lines: [] });
  }
  for (const l of lines) { const x = inv.get(l.invoice_id); if (x) x.lines.push(l); }
  for (const { i, lines: ls } of inv.values()) {
    const sign = i.type === 'sale' ? 1 : -1;
    const totals = ls.map((l) => l.total);
    const shares = allocate(i.discount || 0, totals);
    const base = Math.max(1, (i.subtotal || 0) - (i.discount || 0));
    // الضريبة الشاملة جزء من السطر فتُطرح منه؛ المضافة فوق المجموع فلا تمسّ السطور
    const inclusive = (i.tax || 0) > 0 && (i.total || 0) <= (i.subtotal || 0) - (i.discount || 0);
    ls.forEach((l, k) => {
      const net = totals[k] - shares[k];
      const r = row(byCat.get(catOf.get(l.product_id)));
      r.sales += sign * (net - (inclusive ? divRound(net * i.tax, base) : 0));
      r.cost += sign * lineAmount(l.unit_cost || 0, l.qty);
    });
  }
  for (const e of expenses) {
    if (e.deleted || !inRange(e.spent_at || e.created_at)) continue;
    row(e.cost_center).expenses += e.amount;
  }
  // سندات القبض والصرف المباشرة على حساب إيراد أو مصروف (لا مسحوبات ولا تحويلات)
  for (const v of vouchers) {
    if (v.deleted || v.status === 'void' || v.ref_table || !inRange(v.voucher_at || v.created_at)) continue;
    const type = v.contra === 'other_income' ? 'income' : v.contra === 'other_expense' ? 'expense' : accountTypes.get(v.contra) || null;
    if (v.type === 'receipt' && type === 'income') row(v.cost_center).other += v.amount;
    if (v.type === 'payment' && type === 'expense') row(v.cost_center).expenses += v.amount;
  }
  const name = new Map(centers.map((c) => [c.id, c.name]));
  const rows = [];
  for (const c of centers) {
    const r = acc.get(c.id);
    if (!r && !c.active) continue;
    rows.push({ id: c.id, name: c.name, sales: 0, cost: 0, expenses: 0, other: 0, ...(r || {}) });
  }
  if (acc.has(NO_CENTER)) rows.push({ ...acc.get(NO_CENTER), name: 'بلا مركز' });
  const total = { sales: 0, cost: 0, expenses: 0, other: 0, net: 0 };
  for (const r of rows) {
    r.name = r.name || name.get(r.id) || '';
    r.net = r.sales - r.cost + r.other - r.expenses;
    total.sales += r.sales; total.cost += r.cost; total.expenses += r.expenses; total.other += r.other; total.net += r.net;
  }
  return { rows, total };
}
