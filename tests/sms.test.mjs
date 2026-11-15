import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smsSettings, renderSms, smsParts, smsLink, DEFAULT_TEMPLATES } from '../src/domain/sms.js';

test('SMS: off by default, templates filled in, parts counted like the operator does', () => {
  const s = smsSettings(null);
  assert.equal(s.enabled, false);
  assert.deepEqual(s.events, { debt: false, sale_credit: false, payment: false });
  assert.equal(smsSettings({ templates: { debt: 'x' } }).templates.payment, DEFAULT_TEMPLATES.payment);
  const msg = renderSms(DEFAULT_TEMPLATES.payment, { name: 'أبو أحمد', amount: 5000, balance: 195000, shop: 'بقالة الأمل' });
  assert.equal(msg, 'أبو أحمد، شكرًا لك! استلمنا 50.00 ₪. الباقي عليك 1,950.00 ₪. — بقالة الأمل');
  assert.match(renderSms('{الرصيد}', { balance: 0 }), /لا شيء/);
  assert.match(renderSms('{الرصيد}', { balance: -1000 }), /10.00 ₪ لك عندنا/);
  assert.equal(smsParts('a'.repeat(160)), 1);
  assert.equal(smsParts('ب'.repeat(70)), 1);
  assert.equal(smsParts('ب'.repeat(71)), 2);
  assert.equal(smsParts(msg), 2);
  assert.equal(smsLink('970599123456', 'مرحبا'), 'sms:+970599123456?body=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7');
});
