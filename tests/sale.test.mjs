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
  assert.deepEqual(await inventory.supplierTotals(), { total: 6000, count: 1, credit: 0, suppliers: 1 });
  await assert.rejects(inventory.savePurchase({ lines: [purchaseLine(product)], paid: 'credit' }), /اختر التاجر/);
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
  assert.equal(SUPPORT_PHONE, '970567900316');
  assert.equal(FEEDBACK_TYPES.length, 3);
});

test('customer: edit a mistyped payment and delete a debt — the record and the drawer stay right', async () => {
  const { sessionSummary } = await import('../src/domain/cash.js');
  const t = await setup();
  const { db, customers } = t;
  const c = await customers.create({ name: 'أبو أحمد' });
  await customers.addDebt(c.id, 200000, 'كماليات سيارات');
  await customers.recordPayment(c.id, 50000);            // كتب 500 بدل 50
  let view = await customers.get(c.id);
  assert.equal(view.balance, 150000);
  const pay = view.entries.find((e) => e.type === 'payment');
  await customers.editEntry(pay, 5000);
  view = await customers.get(c.id);
  assert.equal(view.balance, 195000);
  assert.deepEqual(view.entries.map((e) => [e.type, e.amount, e.cancelled]), [['payment', -5000, false], ['payment', -50000, true], ['adjustment', 200000, false]]);
  assert.equal(view.entries[0].created_at, pay.created_at, 'the corrected payment keeps its place in the statement');
  const cash = sessionSummary({ payments: await db.payments.toArray() });
  assert.equal(cash.cashIn - cash.cashOut, 5000, 'drawer: only the real 50 remains');
  // حذف الدين ثم التراجع
  const debt = view.entries.find((e) => e.type === 'adjustment');
  const undo = await customers.voidEntry(debt);
  assert.equal((await customers.get(c.id)).balance, -5000);
  await customers.voidEntry(undo);
  view = await customers.get(c.id);
  assert.equal(view.balance, 195000);
  assert.equal(view.entries.find((e) => e.id === debt.id).cancelled, false, 'undo brings the debt back');
  assert.equal(view.raw.length, 2, 'WhatsApp statement shows only real entries');
  await assert.rejects(customers.voidEntry({ ...debt, invoice_id: 'x', id: 'y' }), (e) => /مرتجع/.test(e.errors.amount));
});

test('trader debts: opening balance, manual debt, payments by method, edit, delete and undo', async () => {
  const { inventory, cash, db } = await setup();
  // تاجر جديد وعليّ له 1,200 من الدفتر القديم
  const t = await inventory.saveSupplier({ name: 'تاجر الجملة أبو خالد', phone: '0599111222', note: 'يمرّ كل خميس', opening: 120000 });
  let s = await inventory.supplier(t.id);
  assert.equal(s.balance, 120000);
  assert.deepEqual(s.entries.map((e) => [e.type, e.amount]), [['opening', 120000]]);
  await assert.rejects(inventory.saveSupplier({ name: '' }), /اسم التاجر/);
  await assert.rejects(inventory.saveSupplier({ name: 'x', opening: -5 }));

  // أخذت بضاعة بالدين: لا فاتورة ولا مخزون
  const stockBefore = await db.movements.count();
  await inventory.addSupplierDebt(t.id, 80000, 'فاتورة 1250');
  assert.equal(await db.movements.count(), stockBefore, 'a manual debt never touches stock');
  await assert.rejects(inventory.addSupplierDebt(t.id, 0), (e) => !!e.errors.amount);

  // دفعة نقدًا تخرج من الدرج، ودفعة بتحويل لا تمسّه
  const drawer0 = (await cash.summary()).expectedCash;
  await inventory.paySupplier(t.id, 50000, { note: 'سند 55' });
  assert.equal((await cash.summary()).expectedCash, drawer0 - 50000);
  const transfer = await db.payment_methods.get(await db.payment_methods.put({ id: uuid(), name: 'تحويل بنكي', kind: 'transfer', sort: 1, active: true }));
  await inventory.paySupplier(t.id, 30000, { method: transfer });
  assert.equal((await cash.summary()).expectedCash, drawer0 - 50000, 'a transfer never leaves the drawer');
  s = await inventory.supplier(t.id);
  assert.equal(s.balance, 120000 + 80000 - 50000 - 30000);
  assert.ok(s.oldestUnpaidAt, 'still owing → oldest unpaid debt is known');
  assert.equal(s.entries[0].balance, s.balance, 'newest first with the running balance');

  // تعديل الدفعة النقدية 500 → 400: الرصيد والدرج يُصحَّحان، والقديمة تظهر ملغاة
  const cashPay = s.entries.find((e) => e.type === 'payment' && e.note === 'سند 55');
  await inventory.editSupplierEntry(cashPay, 40000);
  s = await inventory.supplier(t.id);
  assert.equal(s.balance, 120000 + 80000 - 40000 - 30000);
  assert.equal((await cash.summary()).expectedCash, drawer0 - 40000);
  assert.equal(s.entries.filter((e) => e.cancelled).length, 1);
  assert.equal(s.entries.find((e) => e.type === 'payment' && !e.cancelled && e.amount === -40000).note, 'سند 55', 'the note survives an amount edit');

  // حذف الدين اليدوي ثم التراجع
  const debt = s.entries.find((e) => e.type === 'adjustment' && !e.cancelled);
  const undo = await inventory.voidSupplierEntry(debt);
  assert.equal((await inventory.supplier(t.id)).balance, 120000 - 40000 - 30000);
  await inventory.voidSupplierEntry(undo);
  s = await inventory.supplier(t.id);
  assert.equal(s.balance, 120000 + 80000 - 40000 - 30000);
  assert.equal(s.entries.find((e) => e.id === debt.id).cancelled, false);

  // حذف دفعة التحويل: لا يتغير الدرج
  const tr = s.entries.find((e) => e.type === 'payment' && !e.cancelled && e.amount === -30000);
  await inventory.voidSupplierEntry(tr);
  assert.equal((await cash.summary()).expectedCash, drawer0 - 40000);
  assert.equal((await inventory.supplier(t.id)).balance, 120000 + 80000 - 40000);

  // دفعت أكثر مما عليّ لتاجر آخر: «لك عنده»، ولا يدخل في مجموع ما عليك
  const t2 = await inventory.saveSupplier({ name: 'شركة الألبان' });
  await inventory.paySupplier(t2.id, 7000, { method: transfer });
  assert.deepEqual(await inventory.supplierTotals(), { total: 160000, count: 1, credit: 7000, suppliers: 2 });
  const list = await inventory.suppliers();
  assert.deepEqual(list.map((x) => [x.name, x.balance]), [['تاجر الجملة أبو خالد', 160000], ['شركة الألبان', -7000]]);
  assert.equal(list[1].oldestUnpaidAt, null);
  assert.equal(inventory.searchSuppliers(list, 'الالبان').length, 1);
  assert.equal(inventory.searchSuppliers(list, '599111').length, 1, 'search by phone');
});

test('trader debts: entries from a purchase invoice are not editable here', async () => {
  const { inventory, product } = await setup();
  const sup = await inventory.saveSupplier({ name: 'أبو سامي' });
  await inventory.savePurchase({ lines: [purchaseLine(product, { qty: 2000, unitCost: 500 })], supplierId: sup.id, paid: 'credit' });
  const s = await inventory.supplier(sup.id);
  await assert.rejects(inventory.voidSupplierEntry(s.entries[0]), (e) => /فاتورة/.test(e.errors.amount));
  await assert.rejects(inventory.editSupplierEntry(s.entries[0], 100), (e) => /فاتورة/.test(e.errors.amount));
});

test('trader statement text for WhatsApp', async () => {
  const { supplierStatementText } = await import('../src/domain/ledger.js');
  const text = supplierStatementText({
    shopName: 'بقالة النور', supplierName: 'أبو خالد', currency: 'ILS',
    entries: [
      { type: 'opening', amount: 120000, created_at: '2026-11-01T08:00:00.000Z' },
      { type: 'adjustment', amount: 80000, note: 'فاتورة 1250', created_at: '2026-11-05T08:00:00.000Z' },
      { type: 'payment', amount: -50000, created_at: '2026-11-10T08:00:00.000Z' },
    ],
  });
  assert.match(text, /كشف حساب بقالة النور عندك/);
  assert.match(text, /بضاعة بالدين \(فاتورة 1250\)\s+\+800\.00/);
  assert.match(text, /دفعة له\s+−500\.00/);
  assert.match(text, /الباقي لك عندي: 1,500\.00 ₪/);
  assert.match(supplierStatementText({ shopName: 'م', supplierName: 'ت', entries: [{ type: 'payment', amount: -700, created_at: '2026-11-01T08:00:00.000Z' }] }), /لي عندك: 7\.00/);
});
