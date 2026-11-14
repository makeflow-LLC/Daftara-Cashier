import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import nacl from 'tweetnacl';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createLicense, LicenseError, LICENSE_META } from '../src/core/license.js';
import { exportBackup, restoreBackup } from '../src/core/backup.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { HttpError } from '../src/sync/supabase.js';
import { makeCode } from '../src/domain/license.js';
import { makeClock } from '../src/domain/merge.js';
import { uuid } from '../src/core/ids.js';

const DAY = 86400000;
const keys = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
const pub = Buffer.from(keys.publicKey).toString('base64');
const verifier = async () => (m, s, k) => nacl.sign.detached.verify(m, s, k);
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

let n = 0;
async function setup({ at = Date.now(), installedAt } = {}) {
  const db = createDb(Dexie, `lic-${++n}-${Date.now()}`);
  await db.open();
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'A' };
  const time = { now: at };
  const meta = { async get(k, d = null) { const r = await db.meta.get(k); return r && r.value !== undefined && r.value !== null ? r.value : d; }, set: (key, value) => db.meta.put({ key, value }) };
  const mk = () => createLicense({ meta, info: { installedAt }, deviceId: ctx.deviceId, clock: () => time.now, publicKey: pub, verifier });
  const lic = mk();
  await lic.init();
  const store = createStore({ db, clock: makeClock(), getContext: () => ctx, guard: (t) => lic.guard(t) });
  return { db, ctx, time, meta, lic, mk, store };
}

test('trial: 30 days from install, then read-only; the clock cannot be turned back', async () => {
  const t0 = Date.UTC(2026, 0, 1);
  const { lic, time, mk } = await setup({ at: t0 });
  assert.equal(lic.state.status, 'trial');
  assert.equal(lic.state.daysLeft, 30);
  time.now = t0 + 31 * DAY;
  assert.equal(lic.compute().status, 'expired');
  assert.ok(lic.state.readOnly);
  time.now = t0 + 2 * DAY; // أرجع ساعة الجوال
  assert.equal(lic.compute().status, 'expired');
  const again = mk(); // أعاد تشغيل التطبيق
  await again.init();
  assert.equal(again.state.status, 'expired');
});

test('read-only: selling and editing products are refused, debt payments and settings still work', async () => {
  const t0 = Date.UTC(2026, 0, 1);
  const { store, time, lic, db, ctx } = await setup({ at: t0 });
  await store.put('shops', { id: ctx.shopId, name: 'محل' });
  const p = await store.put('products', { name: 'سكر', sell_price: 500 });
  time.now = t0 + 40 * DAY;
  lic.compute();
  await assert.rejects(store.put('products', { name: 'شاي', sell_price: 100 }), LicenseError);
  await assert.rejects(store.patch('products', p.id, { sell_price: 1 }), (e) => e.license === true);
  await assert.rejects(store.write(async (w) => {
    await w.append('payments', { amount: 100 });
    await w.put('invoices', { type: 'sale', total: 100 });
  }), LicenseError);
  assert.equal(await db.payments.count(), 0, 'the whole sale is rolled back');
  await store.append('customer_entries', { customer_id: uuid(), amount: -500, kind: 'payment' });
  await store.patch('shops', ctx.shopId, { name: 'محل جديد' });
  assert.equal(await db.customer_entries.count(), 1);
});

test('activation code: signed for this device only, survives restart, forged codes are dropped', async () => {
  const t0 = Date.UTC(2026, 0, 1);
  const { lic, time, mk, meta } = await setup({ at: t0 + 40 * DAY, installedAt: t0 });
  assert.ok(lic.state.readOnly);
  const sign = (m) => nacl.sign.detached(m, keys.secretKey);
  const exp = ymd(time.now + 30 * DAY);
  const other = makeCode({ device: 'AAAAA-BBBBB', expires: exp, plan: 'm' }, sign);
  assert.equal((await lic.redeem(other)).reason, 'هذا الكود لجهاز آخر');
  const evil = nacl.sign.keyPair();
  const forged = makeCode({ device: lic.device, expires: exp, plan: 'y' }, (m) => nacl.sign.detached(m, evil.secretKey));
  assert.equal((await lic.redeem(forged)).ok, false);
  assert.ok(lic.state.readOnly);
  const good = makeCode({ device: lic.device, expires: exp, plan: 'm' }, sign);
  const r = await lic.redeem(`تفضل الكود:\n${good}\nشكرًا`);
  assert.ok(r.ok);
  assert.equal(lic.state.status, 'active');
  assert.equal(lic.state.plan, 'monthly');
  const again = mk();
  await again.init();
  assert.equal(again.state.status, 'active');
  // كود مكتوب يدويًا في قاعدة الجهاز
  await meta.set('license:code', { code: forged, expiresAt: '2099-01-01T00:00:00Z', plan: 'yearly' });
  const hacked = mk();
  await hacked.init();
  await new Promise((res) => setTimeout(res, 20));
  assert.ok(hacked.state.readOnly, 'unsigned stored code is ignored');
  // بعد انتهاء الكود: مهلة 3 أيام ثم قراءة فقط
  await meta.set('license:code', { code: good, expiresAt: r.expiresAt, plan: 'monthly' });
  const later = mk();
  await later.init();
  time.now = Date.parse(r.expiresAt) + 2 * DAY;
  assert.equal(later.compute().status, 'grace');
  time.now = Date.parse(r.expiresAt) + 4 * DAY;
  assert.equal(later.compute().status, 'expired');
});

test('server: verdict is stored, shortens a reinstalled trial, and blocks the push without losing rows', async () => {
  const t0 = Date.UTC(2026, 0, 1);
  const { db, ctx, lic, store, time } = await setup({ at: t0 });
  await store.put('shops', { id: ctx.shopId, name: 'محل' });
  await store.put('products', { name: 'سكر', sell_price: 500 });
  const calls = [];
  let answer = { is_active: true, plan: 'trial', expires_at: null, trial_ends_at: new Date(t0 - DAY).toISOString(), server_now: new Date(t0).toISOString() };
  const upserts = [];
  const api = {
    auth: { getSession: async () => ({}), signInAnonymously: async () => ({}) },
    rest: {
      async rpc(fn, args) { calls.push(fn); if (fn === 'cashier_license_checkin') { if (!answer) throw new HttpError(404, 'no function', fn); return answer; } if (fn === 'cashier_register_device') return 'A'; return null; },
      async upsert(table, rows) { upserts.push([table, rows.length]); },
      async select(table) { return table === 'cashier_shop_heads' ? [{ heads: {} }] : []; },
    },
  };
  const engine = createSyncEngine({ db, api, getContext: () => ctx, gate: (a) => lic.gate(a) });
  let r = await engine.run();
  assert.equal(r.blocked, true);
  assert.equal(upserts.length, 0, 'nothing pushed while the server would refuse it');
  assert.equal(await db.outbox.count(), 2, 'rows wait in the outbox');
  assert.equal(lic.state.status, 'expired', 'device used its trial before');
  // MakeFlow فعّل المحل من لوحة Supabase
  answer = { ...answer, plan: 'yearly', expires_at: new Date(t0 + 365 * DAY).toISOString() };
  r = await engine.run();
  assert.equal(r.blocked, false);
  assert.equal(await db.outbox.count(), 0);
  assert.equal(lic.state.status, 'active');
  // أُوقف المحل
  answer = { ...answer, is_active: false };
  await engine.run();
  assert.equal(lic.state.status, 'blocked');
  // خادم قديم بلا دالة الترخيص: المزامنة تعمل كما كانت
  answer = null;
  await store.patch('shops', ctx.shopId, { name: 'x' });
  r = await engine.run();
  assert.equal(r.blocked, false);
  assert.ok(calls.includes('cashier_license_checkin'));
  void time;
});

test('restore keeps the license and the install date (no fresh trial from a backup)', async () => {
  const t0 = Date.UTC(2026, 0, 1);
  const { db, ctx, store, mk, time } = await setup({ at: t0 });
  await store.put('shops', { id: ctx.shopId, name: 'محل' });
  await db.meta.put({ key: 'shopId', value: ctx.shopId });
  const backup = JSON.parse(JSON.stringify(await exportBackup(db)));
  time.now = t0 + 45 * DAY;
  await restoreBackup(db, backup);
  for (const k of ['installedAt', 'lastSeen']) assert.ok(await db.meta.get(k), `${k} kept`);
  assert.ok(LICENSE_META.includes('license:code'));
  const after = mk();
  await after.init();
  assert.equal(after.state.status, 'expired');
});
