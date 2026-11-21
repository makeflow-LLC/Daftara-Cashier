import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import {
  accountPhone, displayPhone, passwordProblem, resetRequestMessage, parseResetRequest, resetMessage, extractResetCode, loginProblem, accountStage,
} from '../src/domain/account.js';

test('account phone: local, international, Arabic digits → one form', () => {
  assert.equal(accountPhone('0599 123 456'), '970599123456');
  assert.equal(accountPhone('+970599123456'), '970599123456');
  assert.equal(accountPhone('٠٥٩٩١٢٣٤٥٦'), '970599123456');
  assert.equal(accountPhone('12'), null);
  assert.equal(displayPhone('970599123456'), '0599123456');
});

test('password rules and login messages', () => {
  assert.ok(passwordProblem('12345'));
  assert.equal(passwordProblem('123456'), null);
  assert.equal(passwordProblem('123456', '123457'), 'كلمتا السر غير متطابقتين');
  assert.equal(loginProblem({ ok: false, reason: 'bad' }), 'الرقم أو كلمة السر غير صحيحة');
  assert.match(loginProblem({ ok: false, reason: 'locked', wait: 125 }), /3 دقائق/);
});

test('forgot password: request message → MakeFlow signs → code extracted from the reply', () => {
  const msg = resetRequestMessage({ phone: '970599123456', request: '07E4-6405', shopName: 'بقالة' });
  assert.deepEqual(parseResetRequest(msg), { phone: '970599123456', request: '07E4-6405' });
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
  const sig = nacl.sign.detached(new TextEncoder().encode(resetMessage('970599123456', '07E4-6405')), kp.secretKey);
  const code = `DCR-${Buffer.from(sig).toString('base64url')}`;
  assert.equal(extractResetCode(`تفضل:\n${code}\nشكرًا`), code);
  assert.equal(extractResetCode('لا شيء'), null);
});

test('account stage: explore freely, nudge after 3 sales, required after 20 sales or 3 days of real use', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const ago = (d) => new Date(now - d * 86400000).toISOString();
  assert.equal(accountStage({ sales: 0, createdAt: ago(0), now }), 'explore');
  assert.equal(accountStage({ sales: 2, createdAt: ago(2.9), now }), 'explore');
  assert.equal(accountStage({ sales: 3, createdAt: ago(1), now }), 'nudge');
  assert.equal(accountStage({ sales: 19, createdAt: ago(1), now }), 'nudge');
  assert.equal(accountStage({ sales: 20, createdAt: ago(0), now }), 'required');
  assert.equal(accountStage({ sales: 3, createdAt: ago(3), now }), 'required');
  // الوقت وحده لا يُلزم: ثبّت التطبيق ورجع بعد أسبوع (أو شهر) ولم يبع — ما زال يستكشف
  assert.equal(accountStage({ sales: 0, createdAt: ago(3), now }), 'explore');
  assert.equal(accountStage({ sales: 2, createdAt: ago(30), now }), 'explore');
  assert.equal(accountStage({ sales: 0, createdAt: null, now }), 'explore');
  assert.equal(accountStage({ sales: 0, createdAt: 'bad', now }), 'explore');
});
