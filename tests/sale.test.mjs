import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createProductRepo } from '../src/features/products/repo.js';
import { createSaleRepo } from '../src/features/sale/repo.js';
import { createCustomerRepo } from '../src/features/customers/repo.js';
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
  return { db, sales, products, customers, product: await products.get(product.id) };
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
