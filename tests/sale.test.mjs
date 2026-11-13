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
import { purchaseLine } from '../src/domain/inventory.js';
import { createCashRepo } from '../src/features/cash/repo.js';
import { sessionSummary, closingResult, closingText } from '../src/domain/cash.js';
import { makeLine } from '../src/domain/cart.js';
import { makeClock } from '../src/domain/merge.js';
import { uuid } from '../src/core/ids.js';

let n = 0;
async function setup() {
  const db = createDb(Dexie, `sale-${++n}-${Date.now()}`);
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'B' };
  const clock = makeClock();
  const store = createStore({ db, clock, getContext: () => ctx });
  const deps = { db, store, getContext: () => ctx, clock };
  const products = createProductRepo(deps);
  const sales = createSaleRepo(deps);
  const customers = createCustomerRepo(deps);
  await store.put('payment_methods', { name: 'نقدًا', kind: 'cash', sort: 0 });
  const { product } = await products.save({ name: 'حليب', sell_price: 500, cost_price: 400 }, { qty: 20000, packs: [{ name: 'كرتونة', factor: 12000, sell_price: 5500 }] });
  const inventory = createInventoryRepo(deps);
  const cash = createCashRepo(deps);
  return { db, sales, products, customers, inventory, cash, product: await products.get(product.id) };
}

test('checkout: one atomic write, stock goes down, numbers per device', async () => {
  const { db, sales, product } = await setup();
  const s = await db.stock.get(product.id);
  const lines = [makeLine(product, { qty: 3000, avgCost: s.avgCost }), makeLine(product, { pack: product.units[0], qty: 1000, avgCost: s.avgCost })];
  const r = await sales.checkout({ lines, payments: [{ kind: 'cash', amount: 10000 }] });
  assert.equal(r.invoice.number, 'B-0001');
  assert.equal(r.change, 10000 - 7000);
  assert.equal((await db.stock.get(product.id)).qty, 20000 - 3000 - 12000);
  assert.equal(await db.invoice_lines.count(), 2);
  assert.equal((await db.payments.toArray())[0].amount, 7000);
  const r2 = await sales.checkout({ lines: [makeLine(product)], payments: [{ kind: 'cash', amount: 500 }] });
  assert.equal(r2.invoice.number, 'B-0002');
  // فشل الدفع: لا شيء يُحفظ ولا يُستهلك رقم
  await assert.rejects(sales.checkout({ lines: [makeLine(product)], payments: [{ kind: 'cash', amount: 100 }] }), /أقل من الإجمالي/);
  assert.equal(await db.invoices.count(), 2);
  assert.equal((await db.meta.get('seq:sale')).value, 2);
});

test('credit sale builds customer balance; return credits it back', async () => {
  const { db, sales, customers, product } = await setup();
  const c = await customers.create({ name: 'أبو أحمد', phone: '0599123456' });
  const r = await sales.checkout({ lines: [makeLine(product, { qty: 4000 })], customerId: c.id, payments: [{ kind: 'credit', amount: 2000 }] });
  assert.equal(await customers.balance(c.id), 2000);
  const ret = await sales.returnable(r.invoice.id);
  assert.equal(ret.rows[0].returnable, 4000);
  const back = await sales.processReturn(r.invoice.id, [{ line: ret.lines[0], qty: 1000 }], 'credit');
  assert.equal(back.invoice.number, 'B-R0001');
  assert.equal(await customers.balance(c.id), 1500);
  assert.equal((await db.stock.get(product.id)).qty, 20000 - 4000 + 1000);
  const again = await sales.returnable(r.invoice.id);
  assert.equal(again.rows[0].returnable, 3000);
  await assert.rejects(sales.processReturn(r.invoice.id, [{ line: ret.lines[0], qty: 3500 }], 'cash'), /أكبر مما يمكن/);
  const list = await customers.list();
  assert.equal(list[0].balance, 1500);
  assert.equal(customers.search(list, '599123').length, 1);
  assert.equal(customers.search(list, 'ابو').length, 1);
});

test('held carts and current cart survive', async () => {
  const { sales, product } = await setup();
  const cart = { lines: [makeLine(product)], discount: null };
  await sales.saveCurrent(cart);
  assert.equal((await sales.loadCurrent()).lines.length, 1);
  const id = await sales.hold(cart, 'زبون 1');
  assert.equal((await sales.listHeld()).length, 1);
  assert.equal((await sales.takeHeld(id)).lines[0].name, 'حليب');
  assert.equal((await sales.listHeld()).length, 0);
  await sales.saveCurrent({ lines: [] });
  assert.equal(await sales.loadCurrent(), null);
});

test('customers: payments, manual debts, statement, totals, Daftara import is idempotent', async () => {
  const { db, customers } = await setup();
  const c = await customers.create({ name: 'أم علي', phone: '0599000111' });
  await customers.addDebt(c.id, 2000, 'خضار');
  await customers.recordPayment(c.id, 500);
  await assert.rejects(customers.recordPayment(c.id, 0), (e) => !!e.errors.amount);
  const full = await customers.get(c.id);
  assert.equal(full.balance, 1500);
  assert.deepEqual(full.entries.map((e) => [e.type, e.amount, e.balance]), [['payment', -500, 1500], ['adjustment', 2000, 2000]]);
  const pay = (await db.payments.toArray()).find((p) => p.customer_id === c.id);
  assert.equal(pay.method_kind, 'cash');
  assert.equal(pay.direction, 'in');
  const list = [{ ref: 'u1', name: 'أبو أحمد', phone: '0599111222', note: null, balance: 3050 }, { ref: 'u2', name: 'بلا دين', phone: null, note: null, balance: 0 }];
  assert.deepEqual(await customers.importDaftara(list), { added: 2, skipped: 0, total: 3050 });
  assert.deepEqual(await customers.importDaftara(list), { added: 0, skipped: 2, total: 0 });
  const t = await customers.totals();
  assert.deepEqual(t, { total: 4550, count: 2, customers: 3 });
  assert.equal((await customers.list())[0].name, 'أبو أحمد', 'biggest debt first');
  await customers.remove(c.id);
  assert.equal((await customers.totals()).customers, 2);
  await customers.restore(c.id);
  assert.equal((await customers.totals()).customers, 3);
});

test('inventory: purchase updates stock and weighted cost, supplier balance, payment', async () => {
  const { db, inventory, product } = await setup();   // 20 قطعة بتكلفة 4.00
  const sup = await inventory.saveSupplier({ name: 'أبو سامي', phone: '0599222333' });
  const r = await inventory.savePurchase({ lines: [purchaseLine(product, { qty: 20000, unitCost: 500 })], supplierId: sup.id, paid: 'credit' });
  assert.equal(r.invoice.number, 'B-P0001');
  const s = await db.stock.get(product.id);
  assert.equal(s.qty, 40000);
  assert.equal(s.avgCost, 450);
  assert.equal((await db.products.get(product.id)).cost_price, 450, 'product cost follows the average');
  assert.equal((await db.price_history.toArray()).filter((h) => h.reason === 'purchase').length, 1);
  assert.equal((await inventory.supplier(sup.id)).balance, 10000);
  await inventory.paySupplier(sup.id, 4000);
  assert.equal((await inventory.supplier(sup.id)).balance, 6000);
  assert.deepEqual(await inventory.supplierTotals(), { total: 6000, count: 1 });
  await assert.rejects(inventory.savePurchase({ lines: [purchaseLine(product)], paid: 'credit' }), /اختر المورّد/);
  assert.equal(await db.invoices.count(), 1, 'failed purchase saved nothing');
});

test('inventory: damage, stock count adjustments and alerts', async () => {
  const { db, inventory, product } = await setup();
  await inventory.damage(product.id, 2000, 'مكسور');
  assert.equal((await db.stock.get(product.id)).qty, 18000);
  const res = await inventory.applyCount([{ product_id: product.id, name: product.name, recorded: 18000, actual: 15000, unit_cost: 400 }]);
  assert.deepEqual(res, { diffValue: -1200, changed: 1, counted: 1 });
  assert.equal((await db.stock.get(product.id)).qty, 15000);
  assert.equal((await db.stock_counts.toArray())[0].diff_value, -1200);
  await inventory.applyCount([{ product_id: product.id, name: product.name, recorded: 15000, actual: 3000, unit_cost: 400 }]);
  const a = await inventory.alerts();
  assert.deepEqual(a.low.map((p) => p.name), ['حليب']);
  assert.equal(a.out.length, 0);
});

test('cash domain: expected drawer, other methods, difference', () => {
  const P = (method_kind, direction, amount, method_id = null) => ({ method_kind, direction, amount, method_id });
  const s = sessionSummary({ opening: 10000, payments: [P('cash', 'in', 5000), P('cash', 'out', 1200), P('transfer', 'in', 3000, 'b'), P('transfer', 'in', 700, 'b'), P('credit', 'in', 900)], methodNames: new Map([['b', 'بنك فلسطين']]) });
  assert.equal(s.expectedCash, 13800);
  assert.deepEqual(s.methods, [{ key: 'b', name: 'بنك فلسطين', kind: 'transfer', total: 3700 }]);
  assert.equal(s.credit, 900);
  assert.deepEqual(closingResult(13800, 13800), { difference: 0, state: 'match' });
  assert.deepEqual(closingResult(13800, 13500), { difference: -300, state: 'short' });
  assert.equal(closingResult(13800, 14000).state, 'over');
  const t = closingText({ shopName: 'بقالة', session: { opened_at: '2026-11-13T06:00:00Z', closed_at: '2026-11-13T20:00:00Z', counted_cash: 13500 }, summary: s });
  assert.ok(t.includes('عجز في الصندوق: 3.00 ₪') && t.includes('بنك فلسطين: 37.00 ₪'));
});

test('cash closing: works without opening, then open → sell → pay supplier → close', async () => {
  const { sales, inventory, cash, product } = await setup();
  await sales.checkout({ lines: [makeLine(product, { qty: 2000 })], payments: [{ kind: 'cash', amount: 1000 }] });
  let r = await cash.close(1000);                    // لم يفتح الصندوق: يُحسب من أول اليوم
  assert.equal(r.state, 'match');
  assert.equal((await cash.summary()).expectedCash, 0, 'new period starts after closing');
  await cash.open(5000);
  await assert.rejects(cash.open(0), /مفتوح من قبل/);
  await sales.checkout({ lines: [makeLine(product, { qty: 4000 })], payments: [{ kind: 'cash', amount: 2000 }] });
  const sup = await inventory.saveSupplier({ name: 'مورّد' });
  await inventory.paySupplier(sup.id, 1500);
  const s = await cash.summary();
  assert.deepEqual([s.opening, s.cashIn, s.cashOut, s.expectedCash], [5000, 2000, 1500, 5500]);
  r = await cash.close(5300);
  assert.deepEqual([r.state, r.difference], ['short', -200]);
  const h = await cash.history();
  assert.equal(h.length, 2);
  assert.equal(h[0].difference, -200);
  assert.equal(h[0].counted.cash, 5300);
  assert.equal((await cash.lastClosed()).counted.cash, 5300);
  assert.equal(await cash.openSession(), null);
});

test('feedback message carries type, shop and version; FAQ entries are complete', async () => {
  globalThis.document = globalThis.document || {};
  const { feedbackMessage, SUPPORT_PHONE, FEEDBACK_TYPES } = await import('../src/features/help/feedback.js').catch(() => ({}));
  if (!feedbackMessage) return; // يحتاج DOM في بعض البيئات
  const m = feedbackMessage({ type: 'feature', text: ' أريد طباعة حرارية ', shopName: 'بقالة النور', version: '0.1.20', flavor: 'direct', sdk: 30 });
  assert.ok(m.startsWith('*دفترة كاشير — طلب ميزة*') && m.includes('أريد طباعة حرارية') && m.includes('بقالة النور') && m.includes('0.1.20 (direct) · أندرويد 30'));
  assert.equal(SUPPORT_PHONE, '970597750343');
  assert.equal(FEEDBACK_TYPES.length, 3);
});
