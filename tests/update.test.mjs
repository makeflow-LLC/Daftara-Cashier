import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, isNewer, releaseVersion, updateTarget, CHECK_EVERY_MS } from '../src/domain/update.js';
import { createUpdater } from '../src/core/update.js';
import { createAppLock, shouldRelock, RELOCK_AFTER_MS } from '../src/core/applock.js';

test('versions: parse and compare', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.10'), [1, 10, 0]);
  assert.equal(parseVersion('dev'), null);
  assert.equal(parseVersion('preview'), null);
  assert.ok(isNewer('v1.0.7', '1.0.6'));
  assert.ok(isNewer('1.10.0', '1.9.9'), 'numeric, not text, comparison');
  assert.ok(isNewer('2.0.0', '1.99.99'));
  assert.ok(!isNewer('1.0.6', '1.0.6'));
  assert.ok(!isNewer('1.0.5', '1.0.6'));
  assert.ok(!isNewer('1.0.7', 'dev'), 'unknown current version never nags');
  assert.equal(releaseVersion({ tag_name: 'v1.0.7' }), '1.0.7');
  assert.equal(releaseVersion({ tag_name: 'preview', prerelease: true }), null);
  assert.equal(releaseVersion({ tag_name: 'v1.0.8', draft: true }), null);
  assert.equal(releaseVersion(null), null);
  assert.match(updateTarget('direct').url, /daftara-cashier\.apk$/);
  assert.match(updateTarget('desktop').url, /setup\.exe$/);
  assert.match(updateTarget('play').url, /play\.google\.com/);
  assert.equal(updateTarget('web'), null);
});

function fakeMeta() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } };
}

test('updater: finds a newer release, remembers it, checks at most once a day unless forced', async () => {
  let calls = 0, tag = 'v1.0.7', t = 1000;
  const emitted = [];
  const meta = fakeMeta();
  const make = (info) => createUpdater({
    meta, getInfo: () => info, now: () => t, emit: (v) => emitted.push(v),
    fetchFn: async () => { calls++; return { ok: true, json: async () => ({ tag_name: tag }) }; },
  });
  const u = make({ flavor: 'direct', version: '1.0.6', release: true });
  await u.load();
  assert.equal(u.available, null);
  assert.deepEqual(await u.check(), { status: 'available', version: '1.0.7' });
  assert.equal(u.available, '1.0.7');
  assert.deepEqual(emitted, ['1.0.7']);
  assert.equal((await u.check()).status, 'skipped', 'background check runs once a day');
  assert.equal(calls, 1);
  t += CHECK_EVERY_MS + 1;
  tag = 'v1.0.8';
  assert.equal((await u.check()).version, '1.0.8');
  assert.equal((await u.check({ force: true })).status, 'available', 'the button always checks');
  assert.equal(calls, 3);
  // بعد التثبيت: النسخة الجديدة تقرأ المحفوظ ولا تدعو لتحديث نفسها
  const after = make({ flavor: 'direct', version: '1.0.8', release: true });
  await after.load();
  assert.equal(after.available, null);
  assert.equal((await after.check({ force: true })).status, 'latest');
  // نسخة تجريبية، Google Play: لا لافتة تحديث
  const preview = make({ flavor: 'direct', version: '0.1.50', release: false });
  await preview.load();
  assert.equal(preview.available, null);
  const play = make({ flavor: 'play', version: '1.0.1', release: true });
  await play.load();
  assert.equal(play.available, null);
  assert.equal((await play.check({ force: true })).status, 'store');
});

test('updater: no internet or a server error is quiet, never throws', async () => {
  const base = { meta: fakeMeta(), getInfo: () => ({ flavor: 'direct', version: '1.0.6', release: true }) };
  assert.equal((await createUpdater({ ...base, fetchFn: async () => { throw new Error('offline'); } }).check({ force: true })).status, 'offline');
  assert.equal((await createUpdater({ ...base, fetchFn: async () => ({ ok: false }) }).check({ force: true })).status, 'offline');
  assert.equal((await createUpdater({ ...base, fetchFn: async () => ({ ok: true, json: async () => ({ tag_name: 'preview' }) }) }).check({ force: true })).status, 'offline');
});

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test('app lock: on/off only after a successful check; locks until verified', async () => {
  let pass = true, secure = true;
  const events = [];
  const plugin = { available: async () => ({ available: secure, biometric: secure }), authenticate: async () => { if (!pass) throw new Error('cancel'); return { ok: true }; } };
  const lock = createAppLock({ plugin: () => plugin, storage: fakeStorage(), onLock: () => events.push('lock'), onUnlock: () => events.push('unlock') });
  assert.equal(lock.enabled, false);
  await lock.lockNow();
  assert.deepEqual(events, [], 'off by default: never locks');
  pass = false;
  assert.equal(await lock.setEnabled(true), false);
  assert.equal(lock.enabled, false);
  pass = true;
  assert.equal(await lock.setEnabled(true), true);
  assert.equal(lock.enabled, true);
  pass = false;
  await lock.lockNow();
  assert.equal(lock.locked, true);
  assert.deepEqual(events, ['lock']);
  await lock.lockNow();
  assert.deepEqual(events, ['lock'], 'a failed retry keeps the same lock screen');
  assert.equal(await lock.setEnabled(false), false, 'cannot be switched off without verifying');
  pass = true;
  await lock.lockNow();
  assert.equal(lock.locked, false);
  assert.deepEqual(events, ['lock', 'unlock']);
  // أُزيل قفل الجوال: لا يُحبس صاحب المحل خارج تطبيقه
  secure = false;
  await lock.lockNow();
  assert.equal(lock.locked, false);
  assert.equal(lock.enabled, false);
  // بلا إضافة البصمة (ويب، حاسوب): غير متاح
  const none = createAppLock({ plugin: () => null, storage: fakeStorage() });
  assert.deepEqual(await none.support(), { available: false, biometric: false });
  assert.equal(await none.setEnabled(true), false);
});

test('app lock: relocks only after a real absence', () => {
  const base = { enabled: true, locked: false, busy: false, hiddenAt: 1000 };
  assert.ok(shouldRelock({ ...base, now: 1000 + RELOCK_AFTER_MS }));
  assert.ok(!shouldRelock({ ...base, now: 1000 + RELOCK_AFTER_MS - 1 }), 'a quick WhatsApp share does not lock');
  assert.ok(!shouldRelock({ ...base, enabled: false, now: 1e9 }));
  assert.ok(!shouldRelock({ ...base, busy: true, now: 1e9 }), 'the system prompt itself hides the page');
  assert.ok(!shouldRelock({ ...base, locked: true, now: 1e9 }));
  assert.ok(!shouldRelock({ ...base, hiddenAt: 0, now: 1e9 }));
});
