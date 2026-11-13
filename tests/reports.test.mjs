import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, periodRange, reportSections, reportSheets, dayKey } from '../src/domain/reports.js';

const I = (id, type, day, total, cost, x = {}) => ({ id, type, status: 'final', total, cost_total: cost, fee_total: 0, created_at: new Date(2026, 10, day, 12).toISOString(), ...x });
const L = (invoice_id, product_id, name, qty, total, unit_cost, unit_factor = 1000) => ({ invoice_id, product_id, name, qty, total, unit_cost, unit_factor });
const data = {
  invoices: [I('s1', 'sale', 10, 5000, 4000), I('s2', 'sale', 11, 3000, 2000), I('r1', 'sale_return', 11, 500, 400), I('p1', 'purchase', 11, 9000, 9000),
    I('old', 'sale', 1, 99999, 1), I('void', 'sale', 10, 7777, 1, { status: 'void' })],
  lines: [L('s1', 'a', 'حليب', 2000, 5000, 2000), L('s2', 'b', 'خبز', 10000, 3000, 200), L('r1', 'a', 'حليب', 200, 500, 2000), L('old', 'a', 'حليب', 1000, 99999, 1),
    L('s2', 'c', 'كرتونة', 0, 0, 0)],
  payments: [{ invoice_id: 's1', direction: 'in', method_kind: 'cash', method_id: 'm1', amount: 5000 }, { invoice_id: 's2', direction: 'in', method_kind: 'transfer', method_id: 'm2', amount: 2000 },
    { invoice_id: 's2', direction: 'in', method_kind: 'credit', amount: 1000 }, { invoice_id: 'r1', direction: 'out', method_kind: 'cash', amount: 500 }],
  products: [{ id: 'a', name: 'حليب', unit: 'piece', category_id: 'c1' }, { id: 'b', name: 'خبز', unit: 'piece', category_id: null }],
  categories: [{ id: 'c1', name: 'ألبان' }], methods: [{ id: 'm1', name: 'نقدًا' }, { id: 'm2', name: 'بنك فلسطين' }],
  from: new Date(2026, 10, 10).toISOString(), to: new Date(2026, 10, 12).toISOString(),
};

test('report: sales, returns, profit, per day, items, categories, methods', () => {
  const r = buildReport(data);
  assert.deepEqual([r.salesTotal, r.returnsTotal, r.net, r.profit, r.invoiceCount, r.avgInvoice, r.purchasesTotal], [8000, 500, 7500, 1900, 2, 4000, 9000]);
  assert.deepEqual(r.byDay.map((d) => [d.day, d.sales, d.profit, d.count]), [['2026-11-10', 5000, 1000, 1], ['2026-11-11', 2500, 900, 1]]);
  assert.deepEqual(r.best.map((x) => [x.name, x.qty, x.amount, x.profit]), [['حليب', 1800, 4500, 900], ['خبز', 10000, 3000, 1000]]);
  assert.equal(r.least[0].name, 'حليب');
  assert.deepEqual(r.byCategory, [{ name: 'ألبان', amount: 4500, profit: 900 }, { name: 'بلا تصنيف', amount: 3000, profit: 1000 }]);
  assert.deepEqual(r.byMethod, [{ name: 'نقدًا', total: 5000 }, { name: 'بنك فلسطين', total: 2000 }, { name: 'آجل', total: 1000 }]);
});

test('periods are local days', () => {
  const now = new Date(2026, 10, 13, 15, 30);
  const t = periodRange('today', now);
  assert.equal(new Date(t.from).getHours(), 0);
  assert.equal((Date.parse(t.to) - Date.parse(t.from)) / 3600000, 24);
  assert.equal(dayKey(new Date(periodRange('week', now).from)), '2026-11-07');
  assert.equal(dayKey(new Date(periodRange('month', now).from)), '2026-11-01');
  const c = periodRange('custom', now, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(dayKey(new Date(c.from)), '2026-10-01');
  assert.equal(dayKey(new Date(c.to)), '2026-11-01');
});

test('sections hide profit and cost for non-owners; sheets for Excel', () => {
  const r = buildReport(data);
  const snap = { stockCost: 1000, stockSell: 1500, customerDebts: 700, supplierBalances: 300 };
  const owner = reportSections(r, snap);
  assert.ok(owner.find((s) => s.title === 'الملخص').rows.some((x) => x[0] === 'الربح'));
  const cashier = reportSections(r, snap, { showProfit: false });
  const text = JSON.stringify(cashier);
  assert.ok(!text.includes('الربح') && !text.includes('بالتكلفة'));
  const sheets = reportSheets(owner);
  assert.equal(sheets[0].rows[0][0], 'البند');
  assert.ok(sheets.length >= 6);
  assert.ok(!/[٠-٩]/.test(JSON.stringify(sheets)));
});
