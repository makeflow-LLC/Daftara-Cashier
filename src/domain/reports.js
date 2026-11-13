// التقارير (نقي): من الفواتير وسطورها ودفعاتها لفترة → المبيعات والربح، الأكثر والأقل مبيعًا،
// حسب طريقة الدفع والتصنيف، وحسب اليوم. وأوراق التصدير (Excel) ونموذج الطباعة (PDF).
import { sum } from './money.js';
import { lineAmount, formatQty, packToBase } from './units.js';
import { formatMoney } from './currency.js';

function pad(n) { return String(n).padStart(2, '0'); }
export function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** فترة التقرير بتوقيت الجهاز: { from, to } ISO (to غير شاملة) واسمها. */
export function periodRange(kind, now = new Date(), custom = null) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  let label = 'اليوم';
  if (kind === 'week') { start.setDate(start.getDate() - 6); label = 'آخر 7 أيام'; }
  else if (kind === 'month') { start.setDate(1); label = 'هذا الشهر'; }
  else if (kind === 'custom' && custom) {
    const a = new Date(`${custom.from}T00:00:00`), b = new Date(`${custom.to}T00:00:00`);
    b.setDate(b.getDate() + 1);
    return { from: a.toISOString(), to: b.toISOString(), label: `${custom.from} إلى ${custom.to}` };
  }
  return { from: start.toISOString(), to: end.toISOString(), label };
}

/**
 * input: { invoices, lines, payments, products, categories, methods, from, to }
 * الفواتير الملغاة والمحذوفة لا تدخل. المرتجع يُطرح من المبيعات والربح والكميات.
 */
export function buildReport({ invoices, lines, payments, products = [], categories = [], methods = [], from, to }) {
  const inPeriod = invoices.filter((i) => !i.deleted && i.status === 'final' && i.created_at >= from && i.created_at < to);
  const sales = inPeriod.filter((i) => i.type === 'sale');
  const returns = inPeriod.filter((i) => i.type === 'sale_return');
  const purchases = inPeriod.filter((i) => i.type === 'purchase');
  const salesTotal = sum(sales, (i) => i.total);
  const returnsTotal = sum(returns, (i) => i.total);
  const profit = sum(sales, (i) => i.total - i.cost_total - (i.fee_total || 0)) - sum(returns, (i) => i.total - i.cost_total);
  const net = salesTotal - returnsTotal;

  // حسب اليوم
  const days = new Map();
  for (const i of [...sales, ...returns]) {
    const k = dayKey(new Date(i.created_at));
    const d = days.get(k) || { day: k, sales: 0, profit: 0, count: 0 };
    const sign = i.type === 'sale' ? 1 : -1;
    d.sales += sign * i.total;
    d.profit += sign * (i.total - i.cost_total - (i.type === 'sale' ? i.fee_total || 0 : 0));
    if (i.type === 'sale') d.count += 1;
    days.set(k, d);
  }

  // حسب الصنف والتصنيف
  const sign = new Map([...sales.map((i) => [i.id, 1]), ...returns.map((i) => [i.id, -1])]);
  const prod = new Map(products.map((p) => [p.id, p]));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const items = new Map();
  for (const l of lines) {
    const s = sign.get(l.invoice_id);
    if (!s) continue;
    const key = l.product_id || `name:${l.name}`;
    const p = prod.get(l.product_id);
    const it = items.get(key) || { product_id: l.product_id, name: p ? p.name : l.name, unit: p ? p.unit : 'piece', category_id: p ? p.category_id : null, qty: 0, amount: 0, profit: 0 };
    it.qty += s * packToBase(l.qty, l.unit_factor || 1000);
    it.amount += s * l.total;
    it.profit += s * (l.total - lineAmount(l.unit_cost || 0, l.qty));
    items.set(key, it);
  }
  const sold = [...items.values()].filter((x) => x.qty > 0);
  const best = [...sold].sort((a, b) => b.amount - a.amount || b.qty - a.qty);
  const least = [...sold].sort((a, b) => a.qty - b.qty || a.amount - b.amount);
  const cats = new Map();
  for (const it of sold) {
    const name = catName.get(it.category_id) || 'بلا تصنيف';
    const c = cats.get(name) || { name, amount: 0, profit: 0 };
    c.amount += it.amount; c.profit += it.profit;
    cats.set(name, c);
  }

  // حسب طريقة الدفع (ما دُفع في فواتير البيع)
  const saleIds = new Set(sales.map((i) => i.id));
  const methodName = new Map(methods.map((m) => [m.id, m.name]));
  const byMethod = new Map();
  for (const p of payments) {
    if (p.direction !== 'in' || !saleIds.has(p.invoice_id)) continue;
    const name = p.method_kind === 'credit' ? 'آجل' : (methodName.get(p.method_id) || (p.method_kind === 'cash' ? 'نقدًا' : 'تحويل'));
    byMethod.set(name, (byMethod.get(name) || 0) + p.amount);
  }

  return {
    salesTotal, returnsTotal, net, profit, invoiceCount: sales.length, returnCount: returns.length,
    avgInvoice: sales.length ? Math.round(salesTotal / sales.length) : 0,
    purchasesTotal: sum(purchases, (i) => i.total),
    byDay: [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    best, least,
    byCategory: [...cats.values()].sort((a, b) => b.amount - a.amount),
    byMethod: [...byMethod.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
  };
}

/**
 * نموذج واحد للعرض والتصدير: أقسام، كل قسم جدول (عناوين + صفوف نصية جاهزة).
 * snapshot: { stockCost, stockSell, customerDebts, supplierBalances } — أرقام «الآن» لا الفترة.
 */
export function reportSections(r, snapshot, { currency = 'ILS', showProfit = true, top = 10 } = {}) {
  const m = (v) => formatMoney(v, currency);
  const cols = (...c) => (showProfit ? c : c.slice(0, -1));
  const sections = [
    { title: 'الملخص', head: ['البند', 'القيمة'], rows: [
      ['المبيعات', m(r.salesTotal)], ['المرتجعات', m(r.returnsTotal)], ['صافي المبيعات', m(r.net)],
      ...(showProfit ? [['الربح', m(r.profit)]] : []),
      ['عدد الفواتير', String(r.invoiceCount)], ['متوسط الفاتورة', m(r.avgInvoice)], ['المشتريات', m(r.purchasesTotal)],
    ] },
    { title: 'حسب طريقة الدفع', head: ['الطريقة', 'المبلغ'], rows: r.byMethod.map((x) => [x.name, m(x.total)]) },
    { title: 'حسب التصنيف', head: cols('التصنيف', 'المبيعات', 'الربح'), rows: r.byCategory.map((x) => cols(x.name, m(x.amount), m(x.profit))) },
    { title: 'الأكثر مبيعًا', head: cols('الصنف', 'الكمية', 'المبيعات', 'الربح'), rows: r.best.slice(0, top).map((x) => cols(x.name, formatQty(x.qty), m(x.amount), m(x.profit))) },
    { title: 'الأقل مبيعًا', head: cols('الصنف', 'الكمية', 'المبيعات', 'الربح'), rows: r.least.slice(0, top).map((x) => cols(x.name, formatQty(x.qty), m(x.amount), m(x.profit))) },
    { title: 'حسب اليوم', head: cols('اليوم', 'الفواتير', 'المبيعات', 'الربح'), rows: r.byDay.map((d) => cols(d.day, String(d.count), m(d.sales), m(d.profit))) },
  ];
  if (snapshot) {
    sections.push({ title: 'الوضع الآن', head: ['البند', 'القيمة'], rows: [
      ...(showProfit ? [['قيمة المخزون بالتكلفة', m(snapshot.stockCost)]] : []),
      ['قيمة المخزون بسعر البيع', m(snapshot.stockSell)], ['ديون الزبائن', m(snapshot.customerDebts)], ['عليك للموردين', m(snapshot.supplierBalances)],
    ] });
  }
  return sections.filter((s) => s.rows.length);
}

/** أوراق Excel من الأقسام: ورقة لكل قسم. */
export function reportSheets(sections) {
  return sections.map((s) => ({ name: s.title, cols: s.head.map((_, i) => (i === 0 ? 28 : 16)), rows: [s.head, ...s.rows] }));
}
