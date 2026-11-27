// الضريبة ومراكز التكلفة: الضريبة لا تدخل الربح، تُحسب شاملة أو مضافة، تعود مع المرتجع، وضريبة المشتريات تُطرح منها.
// ومراكز التكلفة: مجموع صافيها = صافي ربح المحل.
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
import { createAccountingRepo } from '../src/features/accounting/repo.js';
import { makeLine, cartTotals } from '../src/domain/cart.js';
import { purchaseLine, purchaseTax } from '../src/domain/inventory.js';
import { makeClock } from '../src/domain/merge.js';
import { stockValue } from '../src/domain/stock.js';
import { taxConfig, taxOn, netOfTax, taxShare, taxOnTop, rateText, taxProblem } from '../src/domain/tax.js';
import { trialBalance, balances, incomeStatement, taxReport, contraChoices, DRAWER } from '../src/domain/accounting.js';
import { costCenters, centerProblem, centerReport, NO_CENTER } from '../src/domain/centers.js';
import { receiptModel } from '../src/domain/invoice.js';
import { buildReport } from '../src/domain/reports.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { HttpError } from '../src/sync/supabase.js';
import { createFakeServer } from './helpers/fake-server.mjs';
import { resolveFeatures } from '../src/domain/features.js';
import { uuid } from '../src/core/ids.js';

let n = 0;
async function setup() {
  const db = createDb(Dexie, `tax-${++n}-${Date.now()}`);
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'A' };
  const clock = makeClock();
  const store = createStore({ db, clock, getContext: () => ctx });
  const deps = { db, store, getContext: () => ctx, clock };
  const settings = {};
  const getSettings = () => settings;
  const saveSettings = async (patch) => { Object.assign(settings, patch); };
  const cashMethod = await store.put('payment_methods', { name: 'نقدًا', kind: 'cash', sort: 0 });
  const inventory = createInventoryRepo(deps);
  const customers = createCustomerRepo(deps);
  return {
    db, store, ctx, cashMethod, settings, inventory, customers,
    products: createProductRepo(deps), sales: createSaleRepo(deps), cash: createCashRepo({ ...deps, getSettings }), expenses: createExpenseRepo(deps),
    accounting: createAccountingRepo({ ...deps, getSettings, saveSettings, inventory, customers }),
  };
}
const bal = (b, key) => balances(b.entries).get(key) || 0;
const ALL = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' };
const reportOf = async (t) => buildReport({
  invoices: await t.db.invoices.toArray(), lines: await t.db.invoice_lines.toArray(), payments: await t.db.payments.toArray(),
  products: await t.db.products.toArray(), expenses: await t.db.expenses.toArray(), movements: await t.db.movements.toArray(), ...ALL,
});

test('tax: settings, inclusive and exclusive amounts, shares', () => {
  assert.equal(taxConfig({}), null);
  assert.equal(taxConfig({ tax: { enabled: false, rate: 1600 } }), null);
  assert.deepEqual(taxConfig({ tax: { enabled: true } }), { rate: 1600, inclusive: true, number: null, name: 'ضريبة القيمة المضافة' });
  assert.equal(taxConfig({ tax: { enabled: true, rate: 1700, inclusive: false, number: ' 562123 ' } }).number, '562123');
  assert.equal(taxProblem({ rate: 0 }), 'اكتب نسبة الضريبة (مثل 16)');
  assert.equal(taxProblem({ rate: 1600 }), null);
  assert.equal(rateText(1600), '16%');
  assert.equal(rateText(750), '7.5%');
  // 116 شاملة 16% ← 100 + 16
  assert.deepEqual(taxOn(11600, 1600, true), { net: 10000, tax: 1600, gross: 11600 });
  assert.deepEqual(taxOn(10000, 1600, false), { net: 10000, tax: 1600, gross: 11600 });
  assert.deepEqual(taxOn(0, 1600, true), { net: 0, tax: 0, gross: 0 });
  assert.equal(netOfTax(1160, 1600), 1000);
  assert.equal(taxShare(1600, 5000, 10000), 800);
  assert.equal(taxShare(1600, 10000, 10000), 1600);
  assert.equal(taxOnTop({ total: 11600, subtotal: 10000, discount: 0, tax: 1600 }), 1600);
  assert.equal(taxOnTop({ total: 11600, subtotal: 11600, discount: 0, tax: 1600 }), 0);
  assert.equal(taxOnTop({ total: 500, subtotal: 0, discount: 0 }), 0); // فاتورة قديمة بلا ضريبة
  // السلة: الشاملة لا تغيّر الإجمالي، والمضافة تزيده؛ والضريبة خارج الربح
  const lines = [{ key: 'a', product_id: 'p', unit_price: 11600, qty: 1000, factor: 1000, unit_cost: 6000, discount: 0 }];
  assert.deepEqual(cartTotals(lines, null, 0, { rate: 1600, inclusive: true }), { subtotal: 11600, discount: 0, tax: 1600, total: 11600, cost: 6000, profit: 4000, count: 1 });
  const ex = cartTotals(lines, { type: 'amount', value: 1600 }, 0, { rate: 1600, inclusive: false });
  assert.deepEqual([ex.tax, ex.total, ex.profit], [1600, 11600, 4000]);
  assert.equal(cartTotals(lines).tax, 0);
  // سند الصرف «ضريبة للدائرة» يظهر لمن يعمل بالضريبة فقط
  assert.ok(contraChoices('payment', [], { tax: true }).some((c) => c.key === 'vat'));
  assert.ok(!contraChoices('payment').some((c) => c.key === 'vat'));
  assert.equal(resolveFeatures('grocery').directSale, false);
});

test('tax: purchase prices inclusive or exclusive of tax; stock enters at the cost before tax', () => {
  const lines = [{ unit_cost: 1160, qty: 10000, name: 'أرز' }, { unit_cost: 580, qty: 2000, name: 'سكر' }];
  assert.deepEqual(purchaseTax(lines, null), { lines, subtotal: 12760, tax: 0, total: 12760 });
  const inc = purchaseTax(lines, { rate: 1600, mode: 'inclusive' });
  assert.deepEqual([inc.subtotal, inc.tax, inc.total], [11000, 1760, 12760]);
  assert.deepEqual(inc.lines.map((l) => l.unit_cost), [1000, 500]);
  const exc = purchaseTax(lines, { rate: 1600, mode: 'exclusive' });
  assert.deepEqual([exc.subtotal, exc.tax, exc.total], [12760, 2042, 14802]);
  assert.equal(purchaseTax(lines, { rate: 1600, mode: 'none' }).tax, 0);
});

test('tax: sales, returns, purchases and the tax report — and tax never counts as profit', async () => {
  const t = await setup();
  const tax = { rate: 1600, inclusive: true };
  const { product: rice } = await t.products.save({ name: 'أرز', sell_price: 1740, cost_price: 0 });
  const supplier = await t.inventory.saveSupplier({ name: 'أبو خالد' });
  // شراء 10 بسعر 11.60 شامل الضريبة: تدخل البضاعة بـ 10.00 والضريبة 16.00 تُسترد، والتاجر له 116.00
  const buy = await t.inventory.savePurchase({ lines: [purchaseLine(rice, { qty: 10000, unitCost: 1160 })], supplierId: supplier.id, paid: 'credit', tax: { rate: 1600, mode: 'inclusive' } });
  assert.deepEqual([buy.invoice.subtotal, buy.invoice.tax, buy.invoice.total], [10000, 1600, 11600]);
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 11600);
  assert.equal((await t.db.stock.get(rice.id)).avgCost, 1000);
  assert.equal((await t.db.products.get(rice.id)).cost_price, 1000);
  // بيع 4 بسعر 17.40 شامل: الضريبة 9.60 من 69.60
  const line = makeLine(await t.db.products.get(rice.id), { qty: 4000, avgCost: 1000 });
  const sale = await t.sales.checkout({ lines: [line], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 6960 }], tax });
  assert.deepEqual([sale.invoice.total, sale.invoice.tax], [6960, 960]);
  assert.equal(sale.profit, 6960 - 960 - 4000);
  // مرتجع قطعة واحدة: يُرد 17.40 ومنها ضريبة 2.40
  const ret = await t.sales.returnable(sale.invoice.id);
  const back = await t.sales.processReturn(sale.invoice.id, [{ line: ret.rows[0].line, qty: 1000 }], 'cash');
  assert.deepEqual([back.invoice.total, back.invoice.tax, back.cash], [1740, 240, 1740]);
  // مرتجع شراء قطعتين: ينزل 23.20 مما عليك (20 بضاعة + 3.20 ضريبة)
  const pr = await t.inventory.purchaseReturnable(buy.invoice.id);
  const pback = await t.inventory.returnPurchase(buy.invoice.id, [{ line: pr.rows[0].line, qty: 2000 }], 'credit');
  assert.deepEqual([pback.invoice.subtotal, pback.invoice.tax, pback.total], [2000, 320, 2320]);
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 11600 - 2320);

  const b = await t.accounting.books();
  assert.ok(trialBalance(b.entries, b.chart).balanced);
  assert.ok(!b.entries.some((e) => e.lines.some((l) => l.account === 'suspense')));
  // حساب الضريبة: مبيعات 9.60 − 2.40 = 7.20، مشتريات 16 − 3.20 = 12.80 ← لك عند الدائرة 5.60
  const rep = taxReport(b.entries, ALL);
  assert.deepEqual([rep.output, rep.input, rep.net, rep.paid, rep.balance], [720, 1280, -560, 0, -560]);
  assert.equal(-bal(b, 'vat'), -560);
  assert.equal(rep.months.length, 1);
  // المبيعات والبضاعة بلا ضريبة، والدرج والتاجر بما دُفع فعلًا
  assert.equal(-bal(b, 'sales'), 6000);
  assert.equal(bal(b, 'sales_returns'), 1500);
  assert.equal(bal(b, DRAWER), 6960 - 1740);
  assert.equal(-bal(b, 'ap'), 9280);
  const stock = (await t.inventory.productsWithStock()).reduce((a, p) => a + stockValue(p.qty, p.avg_cost), 0);
  assert.equal(stock, 5000);
  assert.equal(bal(b, 'inventory'), stock);
  assert.equal(bal(b, 'stock_diff'), 0);
  // الربح واحد في التقرير وقائمة الدخل: (60 − 15) − (40 − 10) = 15
  const report = await reportOf(t);
  assert.deepEqual([report.salesTotal, report.taxTotal, report.purchaseTax, report.profit], [6960, 720, 1280, 1500]);
  assert.equal(incomeStatement(b.entries, b.chart).net, report.netProfit);
  assert.equal(report.best[0].profit, 1500);
  // دفع الضريبة بسند صرف يُنقص ما عليك للدائرة
  await t.accounting.saveVoucher({ type: 'payment', amount: 200, account: 'drawer', contra: 'vat' });
  const rep2 = taxReport((await t.accounting.books()).entries, ALL);
  assert.deepEqual([rep2.paid, rep2.balance], [200, -760]);
});

test('tax: added on top — the receipt shows it, an edit recomputes it, a void removes it', async () => {
  const t = await setup();
  const tax = { rate: 1600, inclusive: false };
  const { product } = await t.products.save({ name: 'سكر', sell_price: 1000, cost_price: 600 });
  await t.products.save({ ...product }, { qty: 20000 });
  const line = (qty) => makeLine(product, { qty, avgCost: 600 });
  const sale = await t.sales.checkout({ lines: [line(5000)], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 5800 }], tax });
  assert.deepEqual([sale.invoice.subtotal, sale.invoice.tax, sale.invoice.total], [5000, 800, 5800]);
  await assert.rejects(t.sales.checkout({ lines: [line(1000)], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 1000 }], tax }), /أقل من الإجمالي/);
  const shop = { name: 'بقالة الأمل', settings: { tax: { enabled: true, rate: 1600, inclusive: false, number: '562123456' } } };
  const model = receiptModel({ invoice: sale.invoice, lines: await t.db.invoice_lines.where('invoice_id').equals(sale.invoice.id).toArray(), shop });
  assert.deepEqual(model.totals.slice(0, 3).map((x) => x.label), ['قبل الضريبة', 'ضريبة القيمة المضافة', 'الإجمالي']);
  assert.ok(model.shopAddress.includes('مشتغل مرخّص 562123456'));
  // فاتورة شاملة: «منها ضريبة» بعد الإجمالي؛ وفاتورة بلا ضريبة لا يتغير شكلها
  const incl = receiptModel({ invoice: { type: 'sale', total: 1160, subtotal: 1160, discount: 0, tax: 160, created_at: '2026-11-27T10:00:00.000Z' }, lines: [], shop });
  assert.deepEqual(incl.totals.map((x) => x.label), ['الإجمالي', 'منها ضريبة القيمة المضافة']);
  const plain = receiptModel({ invoice: { type: 'sale', total: 1160, subtotal: 1160, discount: 0, tax: 0, created_at: '2026-11-27T10:00:00.000Z' }, lines: [], shop });
  assert.deepEqual(plain.totals.map((x) => x.label), ['الإجمالي']);
  assert.equal(plain.shopAddress, '');
  // مرتجع قطعتين: 20 + 3.20 ضريبة
  const ret = await t.sales.returnable(sale.invoice.id);
  const back = await t.sales.processReturn(sale.invoice.id, [{ line: ret.rows[0].line, qty: 2000 }], 'cash');
  assert.deepEqual([back.invoice.subtotal, back.invoice.tax, back.invoice.total], [2000, 320, 2320]);
  // فاتورة أخرى تُعدَّل ثم تُلغى: لا يبقى منها ضريبة
  const s2 = await t.sales.checkout({ lines: [line(1000)], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 1160 }], tax });
  const s3 = await t.sales.checkout({ replaces: s2.invoice.id, lines: [line(3000)], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 3480 }], tax });
  assert.equal(s3.invoice.tax, 480);
  await t.sales.voidInvoice(s3.invoice.id);
  const b = await t.accounting.books();
  assert.ok(trialBalance(b.entries, b.chart).balanced);
  assert.equal(-bal(b, 'vat'), 800 - 320);
  assert.equal(bal(b, DRAWER), (await t.cash.summary()).expectedCash);
  assert.equal(bal(b, DRAWER), 5800 - 2320);
  const report = await reportOf(t);
  assert.equal(report.taxTotal, 480);
  assert.equal(report.profit, (5000 - 2000) - (3000 - 1200));
  assert.equal(incomeStatement(b.entries, b.chart).net, report.netProfit);
});

test('cost centers: sales by category, expenses by choice, and the nets add up to the shop profit', async () => {
  assert.equal(centerProblem({ name: ' ' }), 'اكتب اسم المركز');
  assert.equal(centerProblem({ name: 'خضار' }, [{ id: '1', name: 'خضار', active: true }]), 'يوجد مركز بهذا الاسم');
  // تصنيف لمركز واحد: الأول يأخذه
  assert.deepEqual(costCenters({ costCenters: [{ id: 'a', name: 'أ', categories: ['x', 'y'] }, { id: 'b', name: 'ب', categories: ['y', 'z'] }, { id: '', name: 'بلا رقم' }] }).map((c) => c.categories), [['x', 'y'], ['z']]);
  const t = await setup();
  const veg = await t.products.addCategory('خضار');
  const dairy = await t.products.addCategory('ألبان');
  const mk = async (name, sell, cost, category_id) => { const { product } = await t.products.save({ name, sell_price: sell, cost_price: cost, category_id }); await t.products.save({ ...product }, { qty: 50000 }); return t.db.products.get(product.id); };
  const tomato = await mk('بندورة', 400, 250, veg.id);
  const milk = await mk('حليب', 600, 480, dairy.id);
  const pen = await mk('قلم', 200, 100, null);
  const vegC = await t.accounting.saveCenter({ name: 'قسم الخضار', categories: [veg.id] });
  const dairyC = await t.accounting.saveCenter({ name: 'قسم الألبان', categories: [dairy.id] });
  const van = await t.accounting.saveCenter({ name: 'سيارة التوزيع' });
  await assert.rejects(t.accounting.saveCenter({ name: 'قسم الخضار' }), /يوجد مركز/);
  // فاتورة فيها الثلاثة مع خصم 10%: يُوزَّع على السطور
  const lines = [makeLine(tomato, { qty: 10000, avgCost: 250 }), makeLine(milk, { qty: 5000, avgCost: 480 }), makeLine(pen, { qty: 5000, avgCost: 100 })];
  const sale = await t.sales.checkout({ lines, discount: { type: 'percent', value: 1000 }, payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 7200 }] });
  const ret = await t.sales.returnable(sale.invoice.id);
  await t.sales.processReturn(sale.invoice.id, [{ line: ret.rows[1].line, qty: 1000 }], 'cash'); // حليب واحد يرجع
  await t.expenses.save({ category: 'transport', amount: 300, method: t.cashMethod, cost_center: van.id });
  await t.expenses.save({ category: 'electricity', amount: 200, method: t.cashMethod, cost_center: dairyC.id });
  await t.expenses.save({ category: 'rent', amount: 500, method: null });
  await t.accounting.saveVoucher({ type: 'receipt', amount: 150, account: 'drawer', contra: 'other_income', cost_center: vegC.id });
  await t.accounting.saveVoucher({ type: 'payment', amount: 80, account: 'drawer', contra: 'other_expense', cost_center: van.id });
  await t.accounting.saveVoucher({ type: 'payment', amount: 999, account: 'drawer', contra: 'owner', cost_center: van.id }); // مسحوبات: ليست مصروفًا
  const v = await t.accounting.saveExpenseVoucher({ category: 'maintenance', amount: 120, method: null, cost_center: van.id });
  assert.equal((await t.db.expenses.get(v.ref_id)).cost_center, van.id);
  const rep = await t.accounting.centerReport(ALL);
  const row = (id) => rep.rows.find((r) => r.id === id);
  assert.deepEqual([row(vegC.id).sales, row(vegC.id).cost, row(vegC.id).other, row(vegC.id).net], [3600, 2500, 150, 1250]);
  assert.deepEqual([row(dairyC.id).sales, row(dairyC.id).cost, row(dairyC.id).expenses], [2700 - 540, 2400 - 480, 200]);
  assert.deepEqual([row(van.id).sales, row(van.id).expenses, row(van.id).net], [0, 300 + 80 + 120, -500]);
  assert.deepEqual([row(NO_CENTER).sales, row(NO_CENTER).cost, row(NO_CENTER).expenses], [900, 500, 500]);
  // مجموع المراكز = صافي ربح المحل في قائمة الدخل
  const b = await t.accounting.books();
  assert.equal(rep.total.net, incomeStatement(b.entries, b.chart).net);
  // تالف من الخضار يُحسب على مركزه، والمجموع يبقى مطابقًا لتقرير الأرباح (مع إيراد ومصروف السندات)
  await t.inventory.damage(tomato.id, 2000);
  const rep2 = await t.accounting.centerReport(ALL);
  assert.equal(rep2.rows.find((r) => r.id === vegC.id).cost, 2500 + 500);
  assert.equal(rep2.total.net, (await reportOf(t)).netProfit + 150 - 80);
  t.accounting.invalidate(); // في التطبيق يفعلها أي تغيّر في البيانات (core/app.js)
  assert.equal(rep2.total.net, incomeStatement((await t.accounting.books()).entries, b.chart).net);
  // مركز مغلق يختفي من الخيارات وتبقى حركاته في التقرير؛ وتصنيف يُنقل لمركز آخر
  await t.accounting.closeCenter(van.id);
  assert.ok(!t.accounting.centers().find((c) => c.id === van.id).active);
  assert.equal((await t.accounting.centerReport(ALL)).rows.find((r) => r.id === van.id).net, -500);
  await t.accounting.saveCenter({ id: dairyC.id, name: 'قسم الألبان', categories: [dairy.id, veg.id] });
  assert.deepEqual(t.accounting.centers().find((c) => c.id === vegC.id).categories, []);
  // بمراكز بلا أي ربط ولا مصاريف: كل شيء «بلا مركز»
  const none = centerReport({ invoices: await t.db.invoices.toArray(), lines: await t.db.invoice_lines.toArray(), products: await t.db.products.toArray() }, [], ALL);
  assert.deepEqual(none.rows.map((r) => r.id), [NO_CENTER]);
});

test('sync: a column the server does not know yet is sent again once it does (invoice tax, expense cost centre)', async () => {
  const server = createFakeServer();
  const t = await setup();
  const real = server.api({ current: null });
  let known = false;
  const old = { ...real, rest: { ...real.rest, async upsert(name, rows, opts) {
    for (const [tbl, col] of [['cashier_invoices', 'tax'], ['cashier_expenses', 'cost_center'], ['cashier_vouchers', 'cost_center']]) {
      if (!known && name === tbl && rows.some((r) => col in r)) throw new HttpError(400, { code: 'PGRST204', message: `Could not find the '${col}' column of '${name}' in the schema cache` }, name);
    }
    return real.rest.upsert(name, rows, opts);
  } } };
  await t.store.put('shops', { id: t.ctx.shopId, name: 'بقالة', shop_type: 'grocery' });
  const { product } = await t.products.save({ name: 'سكر', sell_price: 1160, cost_price: 600 });
  const withTax = await t.sales.checkout({ lines: [makeLine(product, { qty: 1000, avgCost: 600 })], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 1160 }], tax: { rate: 1600, inclusive: true } });
  const noTax = await t.sales.checkout({ lines: [makeLine(product, { qty: 1000, avgCost: 600 })], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 1160 }] });
  const centre = uuid();
  const exp = await t.expenses.save({ category: 'rent', amount: 500, method: null, cost_center: centre });
  const engine = createSyncEngine({ db: t.db, api: old, getContext: () => t.ctx, emit: () => {} });
  let r = await engine.run();
  assert.ok(!r.error, String(r.error));
  // وصلت الفواتير والمصروف بلا العمود الجديد، ولا شيء عالق
  assert.equal(await t.db.outbox.count(), 0);
  assert.ok(!('tax' in server.tables.get('cashier_invoices').get(withTax.invoice.id)));
  // نتذكر فقط ما حمل قيمة في العمود
  assert.deepEqual((await t.db.meta.get('stripped:invoices')).value, [withTax.invoice.id]);
  assert.deepEqual((await t.db.meta.get('stripped:expenses')).value, [exp.id]);
  // الخادم حُدّث (setup.sql): أول رفع ناجح بكامل الأعمدة يعيد تلك السجلات، فتصل قيمها
  known = true;
  const engine2 = createSyncEngine({ db: t.db, api: old, getContext: () => t.ctx, emit: () => {} });
  await t.sales.checkout({ lines: [makeLine(product, { qty: 1000, avgCost: 600 })], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 1160 }] });
  await t.expenses.save({ category: 'water', amount: 50, method: null });
  await engine2.run();
  await engine2.run();
  assert.equal(await t.db.outbox.count(), 0);
  assert.equal(server.tables.get('cashier_invoices').get(withTax.invoice.id).tax, 160);
  // فاتورة بلا ضريبة لا تُعاد (الخادم الحقيقي يعطيها القيمة الافتراضية صفرًا)
  assert.ok(!server.tables.get('cashier_invoices').get(noTax.invoice.id).tax);
  // والجهاز لم يفقد القيمة حين سحب نسخته الناقصة من الخادم القديم
  assert.equal((await t.db.invoices.get(withTax.invoice.id)).tax, 160);
  assert.equal(server.tables.get('cashier_expenses').get(exp.id).cost_center, centre);
  assert.equal(await t.db.meta.get('stripped:invoices'), undefined);
});
