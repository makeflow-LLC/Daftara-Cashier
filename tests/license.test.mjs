import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { licenseState, trustedNow, deviceCode, makeCode, verifyCode, extractCode, subscribeMessage, LOCKED_TABLES, TRIAL_DAYS } from '../src/domain/license.js';
import { TABLE } from '../src/sync/tables.js';

const DAY = 86400000;
const t0 = Date.parse('2026-11-14T08:00:00Z');
const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const sign = (m) => nacl.sign.detached(m, kp.secretKey);
const ctx = (x = {}) => ({ device: 'ABCDE-FGHJK', publicKey: kp.publicKey, verify: nacl.sign.detached.verify, now: t0, ...x });

test('trial: 30 days from install, then read-only', () => {
  assert.equal(TRIAL_DAYS, 30);
  let s = licenseState({ now: t0, installedAt: t0 });
  assert.deepEqual([s.status, s.readOnly, s.daysLeft], ['trial', false, 30]);
  s = licenseState({ now: t0 + 29.5 * DAY, installedAt: t0 });
  assert.deepEqual([s.status, s.daysLeft], ['trial', 1]);
  s = licenseState({ now: t0 + 30 * DAY, installedAt: t0 });
  assert.deepEqual([s.status, s.readOnly], ['expired', true]);
  // الخادم يعرف أن هذا الجهاز جرّب من قبل: التجربة لا تتجدد بإعادة التثبيت
  s = licenseState({ now: t0, installedAt: t0, server: { is_active: true, trial_ends_at: new Date(t0 - DAY).toISOString() } });
  assert.equal(s.status, 'expired');
});

test('paid: active, 3 days grace, expiry; admin block wins', () => {
  const until = new Date(t0 + 10 * DAY).toISOString();
  let s = licenseState({ now: t0, installedAt: t0 - 90 * DAY, server: { is_active: true, plan: 'yearly', expires_at: until } });
  assert.deepEqual([s.status, s.daysLeft, s.plan], ['active', 10, 'yearly']);
  s = licenseState({ now: t0 + 12 * DAY, installedAt: t0 - 90 * DAY, server: { is_active: true, expires_at: until } });
  assert.deepEqual([s.status, s.readOnly, s.daysLeft], ['grace', false, 1]);
  s = licenseState({ now: t0 + 14 * DAY, installedAt: t0 - 90 * DAY, server: { is_active: true, expires_at: until } });
  assert.deepEqual([s.status, s.readOnly], ['expired', true]);
  s = licenseState({ now: t0, installedAt: t0, server: { is_active: false, expires_at: until } });
  assert.deepEqual([s.status, s.readOnly], ['blocked', true]);
  // كود تفعيل بلا إنترنت يكفي وحده، والأبعد تاريخًا يفوز
  s = licenseState({ now: t0, installedAt: t0 - 90 * DAY, code: { expiresAt: new Date(t0 + 40 * DAY).toISOString(), plan: 'monthly' }, server: { is_active: true, expires_at: until, plan: 'x' } });
  assert.deepEqual([s.status, s.daysLeft, s.plan], ['active', 40, 'monthly']);
  assert.equal(licenseState({ now: t0, installedAt: t0 - 90 * DAY, play: { active: true, plan: 'monthly' } }).status, 'active');
});

test('clock cannot be turned back', () => {
  assert.equal(trustedNow(1000, 5000), 5000);
  assert.equal(trustedNow(9000, 5000), 9000);
  assert.equal(trustedNow(9000, null), 9000);
});

test('device code is short, stable and unambiguous', () => {
  const c = deviceCode('a3f09b12cc45de78ff');
  assert.match(c, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
  assert.equal(c, deviceCode('a3f09b12cc45de78'));
  assert.notEqual(c, deviceCode('a3f09b12cc45de79'));
});

test('activation codes: signed for one device and one date; forgeries fail', () => {
  const code = makeCode({ device: 'ABCDE-FGHJK', expires: '20261231', plan: 'y' }, sign);
  assert.ok(code.startsWith('DCS-'));
  const ok = verifyCode(`تفضل كود التفعيل:\n${code}\nشكرًا`, ctx());
  assert.equal(ok.ok, true);
  assert.equal(ok.plan, 'yearly');
  assert.equal(new Date(ok.expiresAt).getFullYear(), 2026);
  assert.equal(extractCode(`x ${code} y`), code);
  assert.equal(verifyCode(code, ctx({ device: 'ZZZZZ-ZZZZZ' })).reason, 'هذا الكود لجهاز آخر');
  assert.equal(verifyCode(code, ctx({ now: Date.parse('2027-02-01') })).reason, 'انتهت مدة هذا الكود');
  // تغيير التاريخ داخل الكود يُبطل التوقيع
  const forged = makeCode({ device: 'ABCDE-FGHJK', expires: '20991231', plan: 'y' }, () => sign(new TextEncoder().encode('x')));
  assert.equal(verifyCode(forged, ctx()).reason, 'الكود غير صحيح');
  const other = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
  assert.equal(verifyCode(makeCode({ device: 'ABCDE-FGHJK', expires: '20991231', plan: 'y' }, (m) => nacl.sign.detached(m, other.secretKey)), ctx()).ok, false);
  assert.equal(verifyCode('مرحبا', ctx()).ok, false);
  assert.equal(verifyCode('DCS-abc.def', ctx()).ok, false);
});

test('read-only locks selling and stock tables but not payments', () => {
  for (const t of LOCKED_TABLES) assert.ok(TABLE[t], t);
  for (const t of ['payments', 'customer_entries', 'supplier_entries', 'cash_sessions', 'shops']) assert.ok(!LOCKED_TABLES.includes(t));
  const m = subscribeMessage({ shopName: 'بقالة النور', device: 'ABCDE-FGHJK', plan: 'yearly', shopId: 's1' });
  assert.ok(m.includes('300 شيكل') && m.includes('ABCDE-FGHJK') && m.includes('بقالة النور'));
});

test('owner generator page: up to date, and its codes are accepted by the app', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildGenerator } = await import('../scripts/build-generator.mjs');
  const nacl = (await import('tweetnacl')).default;
  const { verifyCode, subscribeMessage, unb64 } = await import('../src/domain/license.js');
  const html = readFileSync('tools/license-generator.html', 'utf8');
  assert.equal(html, buildGenerator(), 'run: node scripts/build-generator.mjs');
  const logic = /<script id="logic">([\s\S]*?)<\/script>/.exec(html)[1];
  const api = new Function(`${logic}; return { makeCashierCode, findCashierDevice, CASHIER_PUBLIC_KEY };`)();
  const { LICENSE_PUBLIC_KEY } = await import('../src/core/license.js');
  assert.equal(api.CASHIER_PUBLIC_KEY, LICENSE_PUBLIC_KEY);
  assert.ok(readFileSync('supabase/migrations/0003_licensing.sql', 'utf8').includes(LICENSE_PUBLIC_KEY), 'server uses the same public key');
  const keys = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(3));
  const msg = subscribeMessage({ shopName: 'بقالة', device: 'ABCDE-FGHJK', plan: 'yearly', until: Date.UTC(2027, 0, 15, 12) });
  assert.match(msg, /الاشتراك الحالي حتى: 2027-01-15/);
  const device = api.findCashierDevice(msg);
  assert.equal(device, 'ABCDE-FGHJK');
  const code = api.makeCashierCode(nacl, keys.secretKey, device, '20991231', 'y');
  const r = verifyCode(code, { device, publicKey: keys.publicKey, verify: nacl.sign.detached.verify, now: Date.UTC(2026, 0, 1) });
  assert.ok(r.ok);
  assert.equal(r.plan, 'yearly');
  void unb64;
});
