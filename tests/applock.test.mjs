import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppLock, shouldRelock, RELOCK_AFTER_MS } from '../src/core/applock.js';

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
