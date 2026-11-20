// المرحلة 2: المصاريف والرواتب، صافي الربح، المخازن والنقل، سند القبض، التبديل، المحادثة والتعميمات،
// وإصلاح «الربح بلا تكلفة» (صنف دخلت بضاعته بتعديل الكمية أو بِيع قبل تسجيلها).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createProductRepo } from '../src/features/products/repo.js';
import { createSaleRepo } from '../src/features/sale/repo.js';
import { createCustomerRepo } from '../src/features/customers/repo.js';
import { createInventoryRepo } from '../src/features/inventory/repo.js';
import { createCashRepo } from '../src/features/cash/repo.js';
import { createExpenseRepo } from '../src/features/expenses/repo.js';
import { makeLine } from '../src/domain/cart.js';
import { makeClock } from '../src/domain/merge.js';
import { applyMovement, foldProduct, foldByLocation, knownCost } from '../src/domain/stock.js';
import { buildReport, periodRange, reportSections } from '../src/domain/reports.js';
import { buildTransfer, transferHistory } from '../src/domain/inventory.js';
import { voucherModel, invoiceText } from '../src/domain/invoice.js';
import { formatInvoiceNumber, matchesInvoiceNumber } from '../src/domain/numbering.js';
import { sessionSummary } from '../src/domain/cash.js';
import {
  expenseTotals, expensesInRange, drawerExpenses, categoryName, customCategories, expenseProblem,
  payDate, salaryStatus, payrollDue, payrollSummary, addMonths, periodOf, periodLabel, employeeProblem, SALARY,
} from '../src/domain/expenses.js';
import {
  identity, people, cleanBody, buildThreads, threadMessages, unreadChats, announcements, unreadAnnouncements, visibleTo, GROUP,
} from '../src/domain/chat.js';
import { TABLE } from '../src/sync/tables.js';
import { uuid } from '../src/core/ids.js';

let n = 0;
async function setup() {
  const db = createDb(Dexie, `p2-${++n}-${Date.now()}`);
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'B' };
  const clock = makeClock();
  const store = createStore({ db, clock, getContext: () => ctx });
  const deps = { db, store, getContext: () => ctx, clock };
  const cashMethod = await store.put('payment_methods', { name: 'نقدًا', kind: 'cash', sort: 0 });
  const bank = await store.put('payment_methods', { name: 'تحويل بنكي', kind: 'transfer', sort: 1 });
  return {
    db, store, clock, cashMethod, bank,
    products: createProductRepo(deps), sales: createSaleRepo(deps), customers: createCustomerRepo(deps),
    inventory: createInventoryRepo(deps), cash: createCashRepo(deps), expenses: createExpenseRepo(deps),
  };
}
const sell = async (t, product, qty = 1000) => {
  const s = await t.db.stock.get(product.id);
  const line = makeLine(product, { qty, avgCost: s ? s.avgCost : null });
  return t.sales.checkout({ lines: [line], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: Math.round((line.unit_price * qty) / 1000) }] });
};

// ---------- الربح بلا تكلفة ----------
test('cost: a zero average cost means "unknown" — the product card cost is used', () => {
  assert.equal(knownCost(0, 500), 500);
  assert.equal(knownCost(null, 500), 500);
  assert.equal(knownCost(420, 500), 420);
  assert.equal(knownCost(0, 0), 0);
  // بيع قبل أي بضاعة: المتوسط صفر، وسطر البيع يأخذ تكلفة البطاقة
  assert.equal(makeLine({ id: 'p', name: 'x', unit: 'piece', sell_price: 800, cost_price: 500 }, { avgCost: 0 }).unit_cost, 500);
});

test('cost: stock entered by editing the quantity counts in the average cost', () => {
  assert.deepEqual(foldProduct([{ id: '1', created_at: '1', type: 'adjustment', qty: 20000, unit_cost: 500 }]), { qty: 20000, avgCost: 500 });
  // تسوية جرد بلا تكلفة لا تُنزل المتوسط
  assert.deepEqual(applyMovement({ qty: 10000, avgCost: 500 }, { type: 'adjustment', qty: 5000, unit_cost: 0 }), { qty: 15000, avgCost: 500 });
  // تسوية سالبة لا تغيّر المتوسط
  assert.deepEqual(applyMovement({ qty: 10000, avgCost: 500 }, { type: 'adjustment', qty: -3000, unit_cost: 900 }), { qty: 7000, avgCost: 500 });
});

test('cost: the reported bug — product created empty, quantity typed later, then sold', async () => {
  const t = await setup();
  const { product } = await t.products.save({ name: 'دفتر', sell_price: 800, cost_price: 500 });
  await t.products.save({ ...product }, { qty: 20000 });
  const r = await sell(t, await t.products.get(product.id), 2000);
  assert.equal(r.invoice.cost_total, 1000);
  assert.equal(r.profit, 600);
  // صنف لم يُسجَّل له مخزون أبدًا: كل بيع بتكلفة البطاقة (كان البيع الثاني يُحسب بلا تكلفة)
  const { product: pen } = await t.products.save({ name: 'قلم', sell_price: 200, cost_price: 100 });
  assert.equal((await sell(t, pen)).invoice.cost_total, 100);
  assert.equal((await sell(t, pen)).invoice.cost_total, 100);
});

test('cost: changing the cost on the product card revalues the stock, quantity unchanged', async () => {
  const t = await setup();
  const { product } = await t.products.save({ name: 'حليب', sell_price: 500, cost_price: 400 }, { qty: 10000 });
  await t.products.save({ ...product, cost_price: 450 });
  assert.deepEqual({ ...(await t.db.stock.get(product.id)), last_sale_at: null }, { product_id: product.id, qty: 10000, avgCost: 450, last_sale_at: null });
  assert.equal((await sell(t, await t.products.get(product.id))).invoice.cost_total, 450);
});

test('report repairs old zero-cost lines from the product card and gives net profit', () => {
  const day = '2026-11-10T10:00:00.000Z';
  const data = {
    from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z',
    products: [{ id: 'p1', name: 'دفتر', unit: 'piece', cost_price: 500 }],
    invoices: [{ id: 'i1', type: 'sale', status: 'final', created_at: day, total: 1600, cost_total: 0, fee_total: 0 }],
    lines: [{ invoice_id: 'i1', product_id: 'p1', name: 'دفتر', qty: 2000, unit_factor: 1000, unit_price: 800, total: 1600, unit_cost: 0 }],
    payments: [],
    expenses: [
      { id: 'e1', category: 'electricity', amount: 300, spent_at: day },
      { id: 'e2', category: 'rent', amount: 500, spent_at: day },
      { id: 'e3', category: 'rent', amount: 999, spent_at: day, deleted: true },
      { id: 'e4', category: 'rent', amount: 999, spent_at: '2026-10-30T10:00:00.000Z' },
    ],
    movements: [{ type: 'damage', qty: -1000, unit_cost: 500, product_id: 'p1', created_at: day }, { type: 'sale', qty: -2000, product_id: 'p1', created_at: day }],
  };
  const r = buildReport(data);
  assert.equal(r.costTotal, 1000);
  assert.equal(r.profit, 600);
  assert.equal(r.best[0].profit, 600);
  assert.equal(r.byDay[0].profit, 600);
  assert.equal(r.expensesTotal, 800);
  assert.deepEqual(r.expensesByCategory.map((c) => [c.name, c.total]), [['إيجار', 500], ['كهرباء', 300]]);
  assert.equal(r.damageTotal, 500);
  assert.equal(r.netProfit, 600 - 800 - 500);
  assert.deepEqual(r.byMonth, [{ month: '2026-11', sales: 1600, profit: 600, expenses: 800, damage: 500, net: -700 }]);
  const titles = (s) => s.map((x) => x.title);
  const owner = reportSections(r, null, { showProfit: true });
  assert.ok(titles(owner).includes('الأرباح والخسائر') && titles(owner).includes('المصاريف حسب البند'));
  assert.deepEqual(owner.find((s) => s.title === 'الأرباح والخسائر').rows.slice(-1)[0][0], 'صافي الخسارة');
  // الموظف الذي لا يرى الأرباح لا يرى المصاريف (فيها الرواتب)
  const cashier = reportSections(r, null, { showProfit: false });
  assert.ok(!titles(cashier).includes('الأرباح والخسائر') && !titles(cashier).includes('المصاريف حسب البند'));
});

test('report periods: last month, this year, last year', () => {
  const now = new Date(2026, 10, 20, 15, 0);
  const lm = periodRange('lastMonth', now);
  assert.equal(new Date(lm.from).getMonth(), 9);
  assert.equal(new Date(lm.to).getMonth(), 10);
  assert.equal(new Date(lm.to).getDate(), 1);
  const y = periodRange('year', now);
  assert.deepEqual([new Date(y.from).getFullYear(), new Date(y.from).getMonth(), new Date(y.from).getDate()], [2026, 0, 1]);
  assert.ok(new Date(y.to) > now);
  const ly = periodRange('lastYear', now);
  assert.deepEqual([new Date(ly.from).getFullYear(), new Date(ly.to).getFullYear()], [2025, 2026]);
});

// ---------- المصاريف ----------
test('expenses: categories, totals, range, validation', () => {
  assert.equal(categoryName('electricity'), 'كهرباء');
  assert.equal(categoryName('ضيافة'), 'ضيافة');
  assert.deepEqual(customCategories(['  ضيافة ', 'ضيافة', 'كهرباء', '', 'rent', 'نظافة']), ['ضيافة', 'نظافة']);
  assert.equal(expenseProblem({ amount: 0, category: 'rent', spent_at: '2026-11-01T00:00:00Z' }), 'اكتب مبلغ المصروف');
  assert.equal(expenseProblem({ amount: 100, category: '', spent_at: '2026-11-01T00:00:00Z' }), 'اختر بند المصروف');
  assert.equal(expenseProblem({ amount: 100, category: 'rent', spent_at: '2026-11-01T00:00:00Z' }), null);
  const list = [
    { category: 'rent', amount: 500, spent_at: '2026-11-02T00:00:00Z' }, { category: 'rent', amount: 100, spent_at: '2026-11-05T00:00:00Z' },
    { category: null, amount: 50, spent_at: '2026-11-03T00:00:00Z' }, { category: 'rent', amount: 9, spent_at: '2026-11-03T00:00:00Z', deleted: true },
  ];
  const t = expenseTotals(list);
  assert.deepEqual([t.total, t.count], [650, 3]);
  assert.deepEqual(t.byCategory.map((c) => [c.key, c.total, c.count]), [['rent', 600, 2], ['other', 50, 1]]);
  assert.deepEqual(expensesInRange(list, '2026-11-03T00:00:00Z', '2026-11-06T00:00:00Z').map((e) => e.amount), [100, 50]);
});

test('expenses: cash expenses leave the drawer; "outside the drawer" and transfers do not; delete restores', async () => {
  const t = await setup();
  await t.cash.open(10000);
  const e1 = await t.expenses.save({ category: 'electricity', amount: 3500, method: t.cashMethod });
  await t.expenses.save({ category: 'rent', amount: 120000, method: null });
  await t.expenses.save({ category: 'internet', amount: 9000, method: t.bank });
  let s = await t.cash.summary();
  assert.equal(s.expenses, 3500);
  assert.equal(s.expectedCash, 10000 - 3500);
  assert.ok(e1.cash_session_id);
  await t.expenses.save({ id: e1.id, category: 'electricity', amount: 4000, method: t.cashMethod });
  assert.equal((await t.cash.summary()).expectedCash, 6000);
  await t.expenses.remove(e1.id);
  assert.equal((await t.cash.summary()).expectedCash, 10000);
  await t.expenses.restore(e1.id);
  s = await t.cash.summary();
  assert.equal(s.expectedCash, 6000);
  await assert.rejects(t.expenses.save({ category: 'rent', amount: 0 }), /مبلغ/);
  // الإغلاق يحفظ المتوقع بعد المصاريف
  const c = await t.cash.close(6000);
  assert.equal(c.state, 'match');
  assert.equal(sessionSummary({ opening: 100, payments: [], expenses: 30 }).expectedCash, 70);
  // مصروف سُجّل قبل فتح الصندوق لا يدخل
  assert.equal(drawerExpenses([{ amount: 5, method_id: 'c', created_at: '2026-01-01' }, { amount: 7, method_id: 'c', created_at: '2026-02-01' }, { amount: 9, method_id: null, created_at: '2026-02-01' }], new Set(['c']), '2026-01-15'), 7);
});

// ---------- الرواتب ----------
test('payroll: pay day, paid / partial / late, reminders', () => {
  assert.equal(payDate('2026-02', 31), '2026-02-28');
  assert.equal(payDate('2028-02', 30), '2028-02-29');
  assert.equal(payDate('2026-11', 5), '2026-11-05');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(periodOf('2026-11-20'), '2026-11');
  assert.equal(periodLabel('2026-03'), 'شهر 3/2026');
  assert.equal(employeeProblem({ name: 'أحمد', salary: 200000, payDay: 5 }), null);
  assert.equal(employeeProblem({ name: '', salary: 200000, payDay: 5 }), 'اكتب اسم الموظف');
  assert.equal(employeeProblem({ name: 'أحمد', salary: 200000, payDay: 40 }), 'يوم الدفع بين 1 و 31');

  const ahmad = { id: 'a', name: 'أحمد', salary: 200000, payDay: 5, since: '2026-09-01', active: true };
  const sara = { id: 's', name: 'سارة', salary: 150000, payDay: 31, since: '2026-11-10', active: true };
  const pay = (employee_id, period, amount, extra = {}) => ({ category: SALARY, employee_id, period, amount, ...extra });
  const exp = [pay('a', '2026-09', 200000), pay('a', '2026-10', 150000), pay('a', '2026-10', 50000, { deleted: true }), pay('a', '2026-11', 200000)];
  // أحمد: سبتمبر مدفوع، أكتوبر ناقص 500 ومتأخر، نوفمبر مدفوع
  assert.equal(salaryStatus(ahmad, exp, '2026-11-20').state, 'paid');
  const oct = salaryStatus(ahmad, exp, '2026-11-20', '2026-10');
  assert.deepEqual([oct.paid, oct.remaining, oct.state, oct.days], [150000, 50000, 'overdue', -46]);
  // سارة: موعدها آخر الشهر — بعد 10 أيام (لاحقًا)، ثم قريب، ثم اليوم
  assert.equal(salaryStatus(sara, exp, '2026-11-20').state, 'later');
  assert.equal(salaryStatus(sara, exp, '2026-11-28').state, 'soon');
  assert.equal(salaryStatus(sara, exp, '2026-11-30').state, 'today');
  // موعد سبق إضافة الموظف: لا يُعدّ متأخرًا ولا يُذكَّر به
  assert.equal(salaryStatus(sara, exp, '2026-11-20', '2026-10').state, 'unknown');
  const due = payrollDue([ahmad, sara, { ...ahmad, id: 'x', active: false }], exp, '2026-11-29');
  assert.deepEqual(due.map((d) => [d.employee.name, d.period, d.state]), [['أحمد', '2026-10', 'overdue'], ['سارة', '2026-11', 'soon']]);
  assert.deepEqual(payrollSummary(due), { title: '2 رواتب حان موعدها', total: 200000, overdue: 1 });
  assert.equal(payrollSummary([due[0]]).title, 'راتب أحمد متأخر');
  assert.equal(payrollSummary([]), null);
});

// ---------- المخازن والنقل ----------
test('warehouse: stock is kept apart from the shop; transfer moves it with its cost', async () => {
  const t = await setup();
  const { product } = await t.products.save({ name: 'ألوان', sell_price: 1500, cost_price: 1000 }, { qty: 2000 });
  const wh = await t.inventory.saveWarehouse({ name: 'المخزن الكبير' });
  await assert.rejects(t.inventory.saveWarehouse({ name: 'المخزن الكبير' }), /بهذا الاسم/);
  await t.inventory.setWarehouseQty(wh.id, product.id, 40000);
  assert.equal((await t.db.stock.get(product.id)).qty, 2000, 'shop stock untouched');
  assert.deepEqual(await t.db.wh_stock.get([wh.id, product.id]), { branch_id: wh.id, product_id: product.id, qty: 40000, avgCost: 1000 });
  assert.deepEqual((await t.inventory.warehouses()).map((w) => [w.name, w.items, w.value]), [['المخزن الكبير', 1, 40000]]);
  // لا يُنقل أكثر من الموجود
  await assert.rejects(t.inventory.transfer({ from: wh.id, to: null, lines: [{ product_id: product.id, name: 'ألوان', qty: 50000 }] }), /أكبر من الموجود/);
  await t.inventory.transfer({ from: wh.id, to: null, lines: [{ product_id: product.id, name: 'ألوان', qty: 10000 }] });
  assert.equal((await t.db.stock.get(product.id)).qty, 12000);
  assert.equal((await t.db.wh_stock.get([wh.id, product.id])).qty, 30000);
  // والعكس: من المحل إلى المخزن
  await t.inventory.transfer({ from: null, to: wh.id, lines: [{ product_id: product.id, name: 'ألوان', qty: 2000 }] });
  assert.equal((await t.db.stock.get(product.id)).qty, 10000);
  assert.equal((await t.db.wh_stock.get([wh.id, product.id])).qty, 32000);
  const hist = await t.inventory.transfers();
  assert.deepEqual(hist.map((h) => [h.from, h.to, h.items[0].qty, h.items[0].name]), [[null, wh.id, 2000, 'ألوان'], [wh.id, null, 10000, 'ألوان']]);
  // تصحيح كمية المخزن = تسوية بالفرق؛ ولا يُحذف مخزن فيه بضاعة
  await t.inventory.setWarehouseQty(wh.id, product.id, 30000);
  assert.equal((await t.db.wh_stock.get([wh.id, product.id])).qty, 30000);
  await assert.rejects(t.inventory.removeWarehouse(wh.id), /بضاعة/);
  assert.equal((await t.inventory.stockAt(wh.id)).find((p) => p.id === product.id).qty, 30000);
  assert.deepEqual([...(await t.inventory.warehouseQty()).get(product.id)], [{ branch_id: wh.id, qty: 30000 }]);
  // المخزون يُعاد من الحركات (مزامنة، استعادة نسخة) بنفس التوزيع
  const f = foldByLocation(await t.db.movements.where('product_id').equals(product.id).toArray());
  assert.equal(f.shop.qty, 10000);
  assert.equal(f.warehouses.get(wh.id).qty, 30000);
});

test('warehouse: a purchase can be received into the warehouse', async () => {
  const t = await setup();
  const { product } = await t.products.save({ name: 'قلم', sell_price: 200, cost_price: 100 }, { qty: 10000 });
  const wh = await t.inventory.saveWarehouse({ name: 'مخزن' });
  const line = { product_id: product.id, unit_id: null, name: 'قلم', unit: 'piece', factor: 1000, qty: 50000, unit_cost: 90 };
  const r = await t.inventory.savePurchase({ lines: [line], paid: 'cash', branchId: wh.id });
  assert.equal(r.invoice.branch_id, wh.id);
  assert.deepEqual([(await t.db.stock.get(product.id)).qty, (await t.db.stock.get(product.id)).avgCost], [10000, 100]);
  assert.deepEqual([(await t.db.wh_stock.get([wh.id, product.id])).qty, (await t.db.wh_stock.get([wh.id, product.id])).avgCost], [50000, 90]);
});

test('transfer builder: pairs of movements, validation, history', () => {
  let i = 0;
  const env = { newId: () => `id${++i}`, now: '2026-11-20T10:00:00.000Z' };
  const r = buildTransfer({ from: 'w1', to: null, lines: [{ product_id: 'p', name: 'x', qty: 3000, unit_cost: 500, available: 5000 }] }, env);
  assert.deepEqual(r.movements.map((m) => [m.branch_id, m.type, m.qty, m.unit_cost, m.ref_type, m.ref_id]),
    [['w1', 'transfer_out', -3000, 500, 'transfer', r.transferId], [null, 'transfer_in', 3000, 500, 'transfer', r.transferId]]);
  assert.throws(() => buildTransfer({ from: null, to: null, lines: [{ product_id: 'p', name: 'x', qty: 1 }] }, env), /مختلفين/);
  assert.throws(() => buildTransfer({ from: 'w1', to: null, lines: [] }, env), /صنفًا/);
  assert.throws(() => buildTransfer({ from: 'w1', to: null, lines: [{ product_id: 'p', name: 'x', qty: 9000, available: 5000 }] }, env), /أكبر/);
  assert.deepEqual(transferHistory(r.movements).map((t) => [t.from, t.to, t.items.length]), [['w1', null, 1]]);
});

// ---------- سند القبض ----------
test('receipt voucher: every debt payment gets a number and a customer copy', async () => {
  const t = await setup();
  const c = await t.customers.create({ name: 'أبو خالد', phone: '0599123456' });
  await t.customers.addDebt(c.id, 10000);
  const e1 = await t.customers.recordPayment(c.id, 4000, t.cashMethod);
  const e2 = await t.customers.recordPayment(c.id, 1000, t.bank);
  const p1 = await t.db.payments.get(e1.payment_id);
  assert.equal(p1.number, 'B-V0001');
  assert.equal((await t.db.payments.get(e2.payment_id)).number, 'B-V0002');
  const r = await t.customers.receipt(e1.payment_id);
  assert.deepEqual([r.customer.name, r.methodName, r.balanceAfter, r.cancelled], ['أبو خالد', 'نقدًا', 6000, false]);
  const m = voucherModel({ payment: r.payment, customer: r.customer, shop: { name: 'مكتبة' }, methodName: r.methodName, balanceAfter: r.balanceAfter });
  assert.equal(m.title, 'سند قبض');
  assert.deepEqual(m.totals.map((x) => [x.label, x.value.replace(/[^\d.]/g, '')]), [['المبلغ المستلم', '40.00'], ['طريقة الدفع', ''], ['الرصيد قبل الدفعة', '100.00'], ['الباقي عليه', '60.00']]);
  assert.match(invoiceText(m), /سند قبض B-V0001/);
  assert.match(invoiceText(m), /استلمنا من: أبو خالد/);
  // تعديل الدفعة يحتفظ برقم السند؛ حذفها يخرجها من السندات
  const e1b = await t.customers.editEntry(e1, 5000);
  assert.equal((await t.db.payments.get(e1b.payment_id)).number, 'B-V0001');
  assert.deepEqual((await t.customers.receipts()).map((x) => [x.payment.number, x.payment.amount, x.customerName]).sort(), [['B-V0001', 5000, 'أبو خالد'], ['B-V0002', 1000, 'أبو خالد']]);
  await t.customers.voidEntry((await t.customers.get(c.id)).entries.find((e) => e.payment_id === e2.payment_id));
  assert.deepEqual((await t.customers.receipts()).map((x) => x.payment.number), ['B-V0001']);
  assert.equal(formatInvoiceNumber('A', 'receipt', 12), 'A-V0012');
  assert.ok(matchesInvoiceNumber('A-V0012', '12') && matchesInvoiceNumber('A-V0012', 'a-v12'));
  // سُدّد الحساب كاملًا
  assert.match(voucherModel({ payment: { amount: 100, created_at: '2026-11-20T10:00:00Z' }, balanceAfter: 0 }).foot, /سُدّد/);
});

// ---------- التبديل ----------
test('exchange: return in cash then a new sale — the drawer moves by the price difference only', async () => {
  const t = await setup();
  const { product: a } = await t.products.save({ name: 'دفتر', sell_price: 800, cost_price: 500 }, { qty: 5000 });
  const { product: b } = await t.products.save({ name: 'ألوان', sell_price: 1500, cost_price: 1000 }, { qty: 5000 });
  const s = await sell(t, a, 2000);
  const before = (await t.cash.summary()).expectedCash;
  const rows = (await t.sales.returnable(s.invoice.id)).rows;
  const ret = await t.sales.processReturn(s.invoice.id, [{ line: rows[0].line, qty: 1000 }], 'cash');
  assert.equal(ret.total, 800);
  // البيع الجديد: الجزء المقابل لرصيد المرتجع نقدًا والفرق بالتحويل (كما تبنيه ورقة الدفع)
  const line = makeLine(b, { avgCost: 1000 });
  await t.sales.checkout({ lines: [line], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 800 }, { kind: 'transfer', method_id: t.bank.id, amount: 700 }] });
  const after = await t.cash.summary();
  assert.equal(after.expectedCash, before, 'cash drawer unchanged: refund out = credit in');
  assert.equal(after.methods.find((m) => m.key === t.bank.id).total, 700);
  assert.equal((await t.db.stock.get(a.id)).qty, 4000);
  assert.equal((await t.db.stock.get(b.id)).qty, 4000);
});

// ---------- المحادثة والتعميمات ----------
test('chat: identity, private threads stay private, unread counts', () => {
  const staff = { enabled: true, owner: { name: 'جهاد' }, members: [{ id: 'm1', name: 'أحمد', active: true }, { id: 'm2', name: 'سارة', active: true }, { id: 'm3', name: 'قديم', active: false }] };
  assert.deepEqual(identity(staff, { owner: true, name: 'جهاد' }), { id: 'owner', name: 'جهاد', owner: true });
  assert.deepEqual(identity(staff, { id: 'm1', name: 'أحمد' }), { id: 'm1', name: 'أحمد', owner: false });
  assert.equal(identity(staff, null), null);
  assert.deepEqual(identity(null, null, 'C'), { id: 'dev:C', name: 'الجهاز C', owner: true });
  assert.deepEqual(people(staff, 'm1').map((p) => p.name), ['جهاد', 'سارة']);
  assert.deepEqual(people(null, 'dev:A'), []);
  assert.equal(cleanBody('  مرحبا \r\n\n\n\n  بكم  '), 'مرحبا\n\n  بكم');
  assert.equal(cleanBody('   '), '');
  assert.equal(cleanBody('x'.repeat(3000)).length, 2000);

  const msg = (id, from, to, body, at, kind = 'chat', extra = {}) => ({ id, kind, from_id: from, from_name: { owner: 'جهاد', m1: 'أحمد', m2: 'سارة' }[from], to_id: to, body, created_at: at, ...extra });
  const all = [
    msg('1', 'owner', null, 'صباح الخير', '2026-11-20T08:00:00Z'),
    msg('2', 'm1', 'owner', 'سؤال خاص', '2026-11-20T09:00:00Z'),
    msg('3', 'owner', 'm1', 'جواب خاص', '2026-11-20T09:05:00Z'),
    msg('4', 'm2', null, 'خلص الورق', '2026-11-20T10:00:00Z'),
  ];
  // سارة لا ترى ما بين أحمد وصاحب المحل
  assert.ok(!visibleTo(all[1], 'm2') && !visibleTo(all[2], 'm2') && visibleTo(all[0], 'm2'));
  assert.deepEqual(threadMessages(all, 'm2', 'owner'), []);
  assert.deepEqual(threadMessages(all, 'm1', 'owner').map((m) => m.body), ['سؤال خاص', 'جواب خاص']);
  assert.deepEqual(threadMessages(all, 'owner', GROUP).map((m) => m.body), ['صباح الخير', 'خلص الورق']);
  const threads = buildThreads(all, 'm1', { [GROUP]: '2026-11-20T08:30:00Z' }, people(staff, 'm1'));
  assert.deepEqual(threads.map((t) => [t.name, t.unread, t.last ? t.last.body : null]), [['كل أهل المحل', 1, 'خلص الورق'], ['جهاد', 1, 'جواب خاص'], ['سارة', 0, null]]);
  assert.equal(unreadChats(all, 'm1', {}), 3);
  assert.equal(unreadChats(all, 'm1', { [GROUP]: '2026-11-20T11:00:00Z', owner: '2026-11-20T09:05:00Z' }), 0);
  assert.equal(unreadChats(all, 'm2', {}), 1);
});

test('announcements: who read them; the writer never counts as a reader', () => {
  const a1 = { id: 'a1', kind: 'announce', from_id: 'owner', from_name: 'جهاد', body: 'الدوام 9', created_at: '2026-11-20T08:00:00Z' };
  const a2 = { id: 'a2', kind: 'announce', from_id: 'owner', from_name: 'جهاد', body: 'سعر جديد', created_at: '2026-11-21T08:00:00Z' };
  const read = (id, from, name, ref) => ({ id, kind: 'read', from_id: from, from_name: name, ref_id: ref, body: '', created_at: '2026-11-21T09:00:00Z' });
  const all = [a1, a2, read('r1', 'm1', 'أحمد', 'a1'), read('r2', 'm1', 'أحمد', 'a1'), read('r3', 'owner', 'جهاد', 'a1')];
  const owner = announcements(all, 'owner');
  assert.deepEqual(owner.map((a) => [a.id, a.mine, a.readByMe, a.readers.map((r) => r.name)]), [['a2', true, true, []], ['a1', true, true, ['أحمد']]]);
  assert.deepEqual(unreadAnnouncements(all, 'm1').map((a) => a.id), ['a2']);
  assert.deepEqual(unreadAnnouncements(all, 'm2').map((a) => a.id), ['a2', 'a1']);
  assert.deepEqual(unreadAnnouncements(all, 'owner'), []);
});

test('messages are append-only and stay open after the subscription ends', async () => {
  assert.equal(TABLE.messages.mode, 'append');
  const { LOCKED_TABLES } = await import('../src/domain/license.js');
  assert.ok(!LOCKED_TABLES.includes('messages') && !LOCKED_TABLES.includes('expenses'));
  const t = await setup();
  const row = await t.store.append('messages', { kind: 'chat', from_id: 'owner', from_name: 'جهاد', body: 'مرحبا' });
  assert.equal((await t.db.messages.get(row.id)).body, 'مرحبا');
  assert.equal(await t.db.outbox.where('table').equals('messages').count(), 1);
});

// ---------- المزامنة بين جهازين ----------
test('sync: warehouse stock, messages and expenses reach the second device', async () => {
  const { createSyncEngine } = await import('../src/sync/engine.js');
  const { createFakeServer } = await import('./helpers/fake-server.mjs');
  const server = createFakeServer();
  const shopId = uuid();
  const make = (session, prefix) => {
    const db = createDb(Dexie, `p2s-${++n}-${Date.now()}`);
    const ctx = { shopId, deviceId: uuid(), prefix, userId: null, deviceName: prefix };
    const store = createStore({ db, clock: makeClock(), getContext: () => ctx });
    return { db, ctx, store, session, sync: createSyncEngine({ db, api: server.api(session), getContext: () => ctx, emit: () => {} }) };
  };
  const a = make({ current: null }, 'A');
  await a.store.put('shops', { id: shopId, name: 'مكتبة', shop_type: 'stationery' });
  const p = await a.store.put('products', { name: 'دفتر', sell_price: 800, cost_price: 500 });
  const wh = await a.store.put('branches', { name: 'المخزن الكبير', is_main: false });
  await a.store.append('movements', { product_id: p.id, type: 'opening', qty: 5000, unit_cost: 500 });
  await a.store.append('movements', { product_id: p.id, branch_id: wh.id, type: 'opening', qty: 100000, unit_cost: 480 });
  await a.store.append('movements', { product_id: p.id, branch_id: wh.id, type: 'transfer_out', qty: -10000, unit_cost: 480, ref_type: 'transfer' });
  await a.store.append('movements', { product_id: p.id, type: 'transfer_in', qty: 10000, unit_cost: 480, ref_type: 'transfer' });
  await a.store.append('messages', { kind: 'announce', from_id: 'owner', from_name: 'جهاد', body: 'الدوام 9' });
  await a.store.put('expenses', { category: 'salary', amount: 200000, employee_id: uuid(), period: '2026-11', spent_at: '2026-11-05T10:00:00.000Z' });
  const r = await a.sync.run();
  assert.ok(!r.error, String(r.error));
  const b = make({ current: { ...a.session.current } }, 'A');
  await b.sync.run();
  // مخزون المحل (ما يُباع منه) ومخزون المخزن منفصلان على الجهاز الثاني أيضًا
  const shop = await b.db.stock.get(p.id);
  assert.deepEqual([shop.qty, shop.avgCost], [15000, 487]); // (5×500 + 10×480) ÷ 15 = 486.67
  const w = await b.db.wh_stock.get([wh.id, p.id]);
  assert.deepEqual([w.qty, w.avgCost], [90000, 480]);
  assert.deepEqual((await b.db.messages.toArray()).map((m) => [m.kind, m.body]), [['announce', 'الدوام 9']]);
  assert.deepEqual((await b.db.expenses.toArray()).map((e) => [e.category, e.amount, e.period]), [['salary', 200000, '2026-11']]);
});

test('sync: a server that was not updated yet does not block uploads (unknown column / missing table)', async () => {
  const { createSyncEngine, schemaGap } = await import('../src/sync/engine.js');
  const { HttpError } = await import('../src/sync/supabase.js');
  const { createFakeServer } = await import('./helpers/fake-server.mjs');
  assert.deepEqual(schemaGap(new HttpError(400, { code: 'PGRST204', message: "Could not find the 'number' column of 'cashier_payments' in the schema cache" }, 'x')), { column: 'number' });
  assert.deepEqual(schemaGap(new HttpError(404, { code: 'PGRST205', message: "Could not find the table 'public.cashier_messages' in the schema cache" }, 'x')), { table: true });
  assert.equal(schemaGap(new HttpError(400, { message: 'check constraint' }, 'x')), null);
  assert.equal(schemaGap(new Error('x')), null);

  const server = createFakeServer();
  const shopId = uuid();
  const session = { current: null };
  const db = createDb(Dexie, `p2g-${++n}-${Date.now()}`);
  const ctx = { shopId, deviceId: uuid(), prefix: 'A', userId: null, deviceName: 'A' };
  const store = createStore({ db, clock: makeClock(), getContext: () => ctx });
  // خادم قديم: لا يعرف payments.number ولا أعمدة الرواتب، وليس فيه جدول الرسائل
  const real = server.api(session);
  const calls = [];
  const old = { ...real, rest: { ...real.rest, async upsert(name, rows, opts) {
    calls.push(name);
    if (name === 'cashier_messages') throw new HttpError(404, { code: 'PGRST205', message: "Could not find the table 'public.cashier_messages' in the schema cache" }, name);
    for (const col of ['number', 'employee_id', 'period', 'created_by']) {
      if ((name === 'cashier_payments' && col === 'number' || name === 'cashier_expenses' && col !== 'number') && rows.some((r) => col in r)) {
        throw new HttpError(400, { code: 'PGRST204', message: `Could not find the '${col}' column of '${name}' in the schema cache` }, name);
      }
    }
    return real.rest.upsert(name, rows, opts);
  } } };
  const sync = createSyncEngine({ db, api: old, getContext: () => ctx, emit: () => {} });
  await store.put('shops', { id: shopId, name: 'مكتبة', shop_type: 'stationery' });
  await store.append('payments', { direction: 'in', method_kind: 'cash', amount: 4000, number: 'A-V0001' });
  await store.put('expenses', { category: 'salary', amount: 1000, employee_id: uuid(), period: '2026-11', spent_at: '2026-11-05T10:00:00.000Z' });
  await store.append('messages', { kind: 'chat', from_id: 'owner', body: 'مرحبا' });
  const r = await sync.run();
  assert.ok(!r.error, String(r.error));
  // الدفعة والمصروف وصلا (بلا الأعمدة الجديدة)، والرسالة تنتظر تحديث الخادم — لا شيء «مرفوض»
  assert.equal(server.tables.get('cashier_payments').size, 1);
  assert.ok(!('number' in [...server.tables.get('cashier_payments').values()][0]));
  assert.equal(server.tables.get('cashier_expenses').size, 1);
  assert.deepEqual((await db.outbox.toArray()).map((e) => [e.table, !!e.dead, e.tries]), [['messages', false, 0]]);
  assert.equal(sync.status.state, 'synced');
  assert.equal(calls.filter((c) => c === 'cashier_messages').length, 1, 'one try per sync, not fifty');
  // بعد تحديث الخادم: الرسالة تُرفع في المزامنة التالية
  const sync2 = createSyncEngine({ db, api: real, getContext: () => ctx, emit: () => {} });
  await sync2.run();
  assert.equal(await db.outbox.count(), 0);
  assert.equal(server.tables.get('cashier_messages').size, 1);
});
