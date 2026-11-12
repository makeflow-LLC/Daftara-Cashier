import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { makeClock } from '../src/domain/merge.js';
import { uuid } from '../src/core/ids.js';
import { createFakeServer } from './helpers/fake-server.mjs';

let n = 0;
function device(server, { shopId, prefix = 'A', session = { current: null }, clockMs } = {}) {
  const db = createDb(Dexie, `test-${++n}-${Date.now()}`);
  const ctx = { shopId, deviceId: uuid(), prefix, userId: null, deviceName: `d${n}` };
  const clock = makeClock(clockMs || (() => Date.now()));
  const events = [];
  const store = createStore({ db, clock, getContext: () => ctx, emit: (e) => events.push(e) });
  const sync = createSyncEngine({ db, api: server.api(session), getContext: () => ctx, emit: (e) => events.push(e) });
  return { db, ctx, store, sync, session, events };
}

async function newShop(dev, name = 'بقالة') {
  await dev.store.put('shops', { id: dev.ctx.shopId, name, shop_type: 'grocery' });
}

test('store: every write is timestamped, scoped to the shop and queued', async () => {
  const server = createFakeServer();
  const a = device(server, { shopId: uuid() });
  await newShop(a);
  const p = await a.store.put('products', { name: 'سكر', sell_price: 500 });
  assert.equal(p.shop_id, a.ctx.shopId);
  assert.ok(p.created_at && p.updated_at);
  assert.equal(p.unit, 'piece');          // أعمدة كاملة بقيمها الافتراضية
  assert.equal(await a.store.pendingCount(), 2);
  await a.store.patch('products', p.id, { sell_price: 600 });
  assert.equal(await a.store.pendingCount(), 2); // نفس السجل: قيد واحد في outbox
  await assert.rejects(a.store.put('movements', { product_id: p.id }), /not an lww table/);
  await assert.rejects(a.store.append('products', { name: 'x' }), /not an append-only table/);
});

test('store: a failed write leaves nothing behind (atomic)', async () => {
  const server = createFakeServer();
  const a = device(server, { shopId: uuid() });
  await newShop(a);
  const before = await a.store.pendingCount();
  await assert.rejects(a.store.write(async (w) => {
    await w.put('products', { name: 'شاي' });
    await w.append('movements', { product_id: 'p', type: 'sale', qty: -1000 });
    throw new Error('boom');
  }));
  assert.equal(await a.db.products.count(), 0);
  assert.equal(await a.db.movements.count(), 0);
  assert.equal(await a.db.stock.count(), 0);
  assert.equal(await a.store.pendingCount(), before);
});

test('movements keep a live stock cache', async () => {
  const server = createFakeServer();
  const a = device(server, { shopId: uuid() });
  await newShop(a);
  const p = await a.store.put('products', { name: 'رز' });
  await a.store.append('movements', { product_id: p.id, type: 'purchase', qty: 10000, unit_cost: 300 });
  await a.store.append('movements', { product_id: p.id, type: 'sale', qty: -2500 });
  const s = await a.db.stock.get(p.id);
  assert.equal(s.qty, 7500);
  assert.equal(s.avgCost, 300);
  assert.ok(s.last_sale_at);
});

test('offline first: works offline, syncs silently later', async () => {
  const server = createFakeServer();
  server.offline = true;
  const a = device(server, { shopId: uuid() });
  await newShop(a);
  await a.store.put('products', { name: 'زيت', sell_price: 2500 });
  let r = await a.sync.run();
  assert.ok(r.error);
  assert.equal(a.sync.status.state, 'offline');
  assert.equal(a.sync.status.pending, 2);
  server.offline = false;
  r = await a.sync.run();
  assert.equal(r.pushed, 2);
  assert.equal(a.sync.status.state, 'synced');
  assert.equal(a.sync.status.pending, 0);
  assert.equal(server.tables.get('cashier_products').size, 1);
});

test('two devices of one shop converge (products, sales, stock)', async () => {
  const server = createFakeServer();
  const shopId = uuid();
  const a = device(server, { shopId });
  await newShop(a);
  const sugar = await a.store.put('products', { name: 'سكر', sell_price: 500 });
  await a.store.append('movements', { product_id: sugar.id, type: 'purchase', qty: 20000, unit_cost: 300 });
  await a.sync.run();

  // الجهاز الثاني: نفس الحساب (دخل برقم الجوال وكلمة السر)، حرفه المفضّل A محجوز فيأخذ B
  const b = device(server, { shopId, prefix: 'A', session: { current: { ...a.session.current } } });
  await b.sync.run();
  assert.equal((await b.db.meta.get('devicePrefix')).value, 'B');
  assert.equal((await b.db.products.get(sugar.id)).name, 'سكر');
  assert.equal((await b.db.stock.get(sugar.id)).qty, 20000);
  assert.equal((await b.db.shops.get(shopId)).name, 'بقالة');

  // بيع على الجهازين وهما مقطوعان
  server.offline = true;
  await a.store.append('movements', { product_id: sugar.id, type: 'sale', qty: -3000 });
  await b.store.append('movements', { product_id: sugar.id, type: 'sale', qty: -4000 });
  await a.sync.run(); await b.sync.run();
  server.offline = false;
  await a.sync.run(); await b.sync.run(); await a.sync.run();
  assert.equal((await a.db.stock.get(sugar.id)).qty, 13000);
  assert.equal((await b.db.stock.get(sugar.id)).qty, 13000);
  assert.equal(await a.db.movements.count(), 3);
  assert.equal(await b.db.movements.count(), 3);
});

test('last write wins across devices, even with server time format', async () => {
  const server = createFakeServer();
  const shopId = uuid();
  let t = Date.parse('2026-03-01T08:00:00Z');
  const a = device(server, { shopId, clockMs: () => t });
  await newShop(a);
  const p = await a.store.put('products', { name: 'حليب', sell_price: 400 });
  await a.sync.run();
  const b = device(server, { shopId, session: { current: { ...a.session.current } }, clockMs: () => t });
  await b.sync.run();

  server.offline = true;
  t += 60_000; await a.store.patch('products', p.id, { sell_price: 450 }); // أقدم
  t += 60_000; await b.store.patch('products', p.id, { sell_price: 480 }); // أحدث
  server.offline = false;
  await b.sync.run(); // الأحدث يصل الخادم أولًا
  await a.sync.run(); // تعديل A الأقدم يُرفض على الخادم، ويأخذ A نسخة B
  await b.sync.run();
  assert.equal((await a.db.products.get(p.id)).sell_price, 480);
  assert.equal((await b.db.products.get(p.id)).sell_price, 480);
  assert.equal([...server.tables.get('cashier_products').values()][0].sell_price, 480);
  assert.equal(await a.store.pendingCount(), 0);
});

test('a rejected record is isolated, the rest still syncs', async () => {
  const server = createFakeServer();
  const a = device(server, { shopId: uuid() });
  await newShop(a);
  await a.store.put('products', { name: 'جيد 1' });
  const bad = await a.store.put('products', { name: 'معطوب' });
  await a.store.put('products', { name: 'جيد 2' });
  server.reject = (table, row) => row.id === bad.id;
  for (let i = 0; i < 5; i++) await a.sync.run();
  assert.equal(server.tables.get('cashier_products').size, 2);
  const left = await a.db.outbox.toArray();
  assert.equal(left.length, 1);
  assert.equal(left[0].dead, true);
  assert.equal(a.sync.status.state, 'error');
});

test('pull asks once and skips tables with nothing new', async () => {
  const server = createFakeServer();
  const a = device(server, { shopId: uuid() });
  await newShop(a);
  await a.store.put('products', { name: 'خبز' });
  await a.sync.run();
  await a.sync.run(); // استقرار المؤشرات
  const before = server.requests;
  await a.sync.run();
  // لا شيء جديد: سؤال heads فقط (الجلسة والتسجيل محفوظان، ولا رفع)
  assert.equal(server.requests - before, 1);
});

test('another account cannot claim the shop', async () => {
  const server = createFakeServer();
  const shopId = uuid();
  const a = device(server, { shopId });
  await newShop(a);
  await a.sync.run();
  const stranger = device(server, { shopId });
  const r = await stranger.sync.run();
  assert.ok(r.error);
  assert.equal(stranger.sync.status.state, 'error');
});

test('concurrent run() calls share one sync', async () => {
  const server = createFakeServer();
  const a = device(server, { shopId: uuid() });
  await newShop(a);
  const [x, y] = [a.sync.run(), a.sync.run()];
  assert.equal(x, y);
  await x;
});
