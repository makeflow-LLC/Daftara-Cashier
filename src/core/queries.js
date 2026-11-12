// قراءات مشتركة للشاشات (الحساب نفسه في src/domain، هنا الجلب من قاعدة الجهاز فقط).
import { sum } from '../domain/money.js';
import { stockLevel } from '../domain/stock.js';
import { DEFAULT_LOW_STOCK_THRESHOLD, EXPIRY_WARNING_DAYS } from '../domain/features.js';
import { QTY_SCALE } from '../domain/units.js';

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** ملخص اليوم للرئيسية: المبيعات، الربح، عدد الفواتير، النقد في الدرج. */
export async function todaySummary(db) {
  const from = startOfDay().toISOString();
  const inv = (await db.invoices.where('created_at').aboveOrEqual(from).toArray())
    .filter((i) => !i.deleted && i.status === 'final');
  const sales = inv.filter((i) => i.type === 'sale');
  const returns = inv.filter((i) => i.type === 'sale_return');
  const salesTotal = sum(sales, (i) => i.total) - sum(returns, (i) => i.total);
  const profit = sum(sales, (i) => i.total - i.cost_total - i.fee_total)
    - sum(returns, (i) => i.total - i.cost_total);

  // النقد في الدرج: افتتاح الوردية المفتوحة + الداخل نقدًا − الخارج نقدًا منذ فتحها (أو منذ بداية اليوم)
  const sessions = (await db.cash_sessions.orderBy('opened_at').reverse().limit(5).toArray()).filter((s) => !s.deleted);
  const open = sessions.find((s) => !s.closed_at);
  const since = open ? open.opened_at : from;
  const cash = (await db.payments.where('created_at').aboveOrEqual(since).toArray()).filter((p) => p.method_kind === 'cash');
  const drawer = (open ? open.opening_cash : 0) + sum(cash, (p) => (p.direction === 'in' ? p.amount : -p.amount));

  return { salesTotal, profit, invoiceCount: sales.length, drawer, sessionOpen: !!open };
}

/** التنبيهات: نفاد، انخفاض، قرب انتهاء الصلاحية. */
export async function stockAlerts(db, { expiry = false } = {}) {
  const [products, stock] = await Promise.all([db.products.toArray(), db.stock.toArray()]);
  const qty = new Map(stock.map((s) => [s.product_id, s.qty]));
  const out = [], low = [], expiring = [];
  const soon = new Date(Date.now() + EXPIRY_WARNING_DAYS * 86400000).toISOString().slice(0, 10);
  for (const p of products) {
    if (p.deleted || p.parent_id) continue;
    const q = qty.get(p.id) ?? 0;
    const lvl = stockLevel(q, p.low_stock ?? DEFAULT_LOW_STOCK_THRESHOLD * QTY_SCALE);
    if (lvl === 'out' && qty.has(p.id)) out.push(p);
    else if (lvl === 'low') low.push(p);
    if (expiry && p.track_expiry && p.expiry_date && p.expiry_date <= soon) expiring.push(p);
  }
  return { out, low, expiring };
}
