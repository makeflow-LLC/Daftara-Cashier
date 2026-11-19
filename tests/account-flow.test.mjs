import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { createAccount } from '../src/core/account.js';
import { makeClock } from '../src/domain/merge.js';
import { uuid } from '../src/core/ids.js';
import { createFakeServer } from './helpers/fake-server.mjs';

let n = 0;
async function device(server, shopId = null) {
  const db = createDb(Dexie, `acc-${++n}-${Date.now()}`);
  await db.open();
  const ctx = { shopId, deviceId: uuid(), prefix: 'A', userId: null };
  const store = createStore({ db, clock: makeClock(), getContext: () => ctx });
  const api = server.api({ current: null });
  const sync = createSyncEngine({ db, api, getContext: () => ctx });
  const app = {
    db, ctx, api, sync, store,
    meta: { async get(k, d = null) { const r = await db.meta.get(k); return r && r.value != null ? r.value : d; }, set: (key, value) => db.meta.put({ key, value }) },
  };
  app.account = createAccount(app);
  return app;
}

test('phone + password: protect on one phone, log in on a new phone, everything comes back', async () => {
  const server = createFakeServer();
  const shopId = uuid();
  const a = await device(server, shopId);
  await a.store.put('shops', { id: shopId, name: 'بقالة الأمل', shop_type: 'grocery' });
  const p = await a.store.put('products', { name: 'سكر', sell_price: 500 });
  await a.store.append('movements', { product_id: p.id, type: 'opening', qty: 10000 });
  await assert.rejects(a.account.protect('0599123456', '123', '123'), /6 أحرف/);
  await assert.rejects(a.account.protect('0599123456', '123456', '654321'), /غير متطابقتين/);
  assert.equal(await a.account.protect('0599 123 456', 'secret1', 'secret1'), '970599123456');
  assert.equal(await a.account.phone(), '970599123456');

  // جوال جديد بلا محل
  const b = await device(server);
  await assert.rejects(b.account.login('0599123456', 'wrong'), /غير صحيحة/);
  const r = await b.account.login('+970599123456', 'secret1');
  assert.equal(r.shopId, shopId);
  assert.equal(r.name, 'بقالة الأمل');
  assert.equal((await b.db.shops.get(shopId)).name, 'بقالة الأمل');
  assert.equal((await b.db.products.get(p.id)).name, 'سكر');
  assert.equal((await b.db.stock.get(p.id)).qty, 10000, 'stock rebuilt from movements');
  assert.equal(await b.meta.get('shopId'), shopId);
  assert.equal(await b.meta.get('devicePrefix'), 'B', 'the new phone gets its own invoice letter');
  assert.equal(await b.account.refresh(), '970599123456');

  // الجهاز الجديد يبيع، والقديم يرى
  await b.store.append('movements', { product_id: p.id, type: 'sale', qty: -2000 });
  await b.sync.run();
  await a.sync.run();
  assert.equal((await a.db.stock.get(p.id)).qty, 8000);

  // رقم محل آخر لا يُسرق
  const c = await device(server, uuid());
  await c.store.put('shops', { id: c.ctx.shopId, name: 'محل آخر' });
  await assert.rejects(c.account.protect('0599123456', 'abcdef', 'abcdef'), /مسجّل لمحل آخر/);
});

test('login without internet leaves the phone clean (no half-empty shop)', async () => {
  const server = createFakeServer();
  const b = await device(server);
  server.offline = true;
  await assert.rejects(b.account.login('0599123456', 'secret1'), /إنترنت/);
  assert.equal(b.ctx.shopId, null);
  assert.equal(await b.meta.get('shopId'), null);
});

test('after five wrong passwords the account waits', async () => {
  const server = createFakeServer();
  const shopId = uuid();
  const a = await device(server, shopId);
  await a.store.put('shops', { id: shopId, name: 'محل' });
  await a.account.protect('0599000111', 'secret1', 'secret1');
  const b = await device(server);
  for (let i = 0; i < 5; i++) await assert.rejects(b.account.login('0599000111', `x${i}`));
  await assert.rejects(b.account.login('0599000111', 'secret1'), /انتظر/);
});

test('explore first, then a gentle nudge, then the account is required (one-session pass when offline)', async () => {
  const server = createFakeServer();
  const shopId = uuid();
  const a = await device(server, shopId);
  a.config = { syncEnabled: true };
  await a.store.put('shops', { id: shopId, name: 'محل' });
  await a.account.init();
  assert.equal(a.account.stage, 'explore');
  assert.equal(a.account.required, false, 'a new shop browses freely');
  assert.equal(a.account.missing, true);
  for (let i = 0; i < 3; i++) await a.store.put('invoices', { type: 'sale', number: `A-${i}` });
  await a.store.put('invoices', { type: 'purchase', number: 'P-1' });
  assert.equal(await a.account.check(), 'nudge');
  assert.equal(a.account.required, false, 'a nudge never blocks');
  for (let i = 3; i < 20; i++) await a.store.put('invoices', { type: 'sale', number: `A-${i}` });
  assert.equal(await a.account.check(), 'required');
  assert.equal(a.account.required, true);
  server.offline = true;
  await assert.rejects(a.account.protect('0599000222', 'secret1', 'secret1'), (e) => e.kind === 'offline');
  a.account.skipForNow();
  assert.equal(a.account.required, false, 'works offline this session');
  // الفتح القادم: خدمة جديدة ← يُطلب من جديد
  const { createAccount } = await import('../src/core/account.js');
  a.account = createAccount(a);
  await a.account.init();
  assert.equal(a.account.required, true);
  server.offline = false;
  await a.account.protect('0599000222', 'secret1', 'secret1');
  assert.equal(a.account.required, false);
  a.account = createAccount(a);
  await a.account.init();
  assert.equal(a.account.required, false, 'stays satisfied after restart');
  // نسخة بلا خادم: لا حساب ولا إلزام
  // محل عمره 3 أيام بلا فواتير: الحساب مطلوب أيضًا
  const old = await device(server, uuid());
  old.config = { syncEnabled: true };
  await old.store.put('shops', { id: old.ctx.shopId, name: 'قديم', created_at: new Date(Date.now() - 3 * 86400000 - 1000).toISOString() });
  await old.account.init();
  assert.equal(old.account.required, true);
  const b = await device(server, uuid());
  b.config = { syncEnabled: false };
  await b.account.init();
  assert.equal(b.account.required, false);
  await assert.rejects(a.account.protect('12', 'secret1', 'secret1'), (e) => e.kind === 'input');
});
