import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceOf, statement, oldestUnpaidAt, normalizePhone, whatsappLink, reminderText, statementText, parseDaftaraBackup } from '../src/domain/ledger.js';

const E = (type, amount, day, note = null) => ({ type, amount, note, created_at: `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z` });

test('balance and running statement', () => {
  const entries = [E('payment', -2000, 5), E('sale_credit', 5000, 1, 'A-0001'), E('return_credit', -500, 6), E('adjustment', 1000, 7)];
  assert.equal(balanceOf(entries), 3500);
  assert.deepEqual(statement(entries).map((e) => e.balance), [5000, 3000, 2500, 3500]);
  assert.equal(oldestUnpaidAt(entries), '2026-11-01T10:00:00.000Z');
  assert.equal(oldestUnpaidAt([E('sale_credit', 1000, 1), E('payment', -1000, 2), E('sale_credit', 700, 9)]), '2026-11-09T10:00:00.000Z');
  assert.equal(oldestUnpaidAt([E('sale_credit', 1000, 1), E('payment', -1000, 2)]), null);
});

test('phone numbers become WhatsApp numbers', () => {
  assert.equal(normalizePhone('0599123456'), '970599123456');
  assert.equal(normalizePhone('٠٥٩٩١٢٣٤٥٦'), '970599123456');
  assert.equal(normalizePhone('+972 59-912-3456'), '972599123456');
  assert.equal(normalizePhone('00970599123456'), '970599123456');
  assert.equal(normalizePhone('970599123456'), '970599123456');
  assert.equal(normalizePhone('123'), '');
  assert.equal(normalizePhone(''), '');
  assert.ok(whatsappLink('0599123456', 'مرحبا').startsWith('https://wa.me/970599123456?text='));
});

test('reminder and statement texts use western digits', () => {
  const r = reminderText({ shopName: 'بقالة النور', customerName: 'أبو خالد', balance: 12550 });
  assert.ok(r.includes('125.50 ₪') && r.includes('أبو خالد'));
  const s = statementText({ shopName: 'بقالة النور', customerName: 'أبو خالد', entries: [E('sale_credit', 5000, 1, 'A-0001'), E('payment', -2000, 5)] });
  assert.ok(s.includes('+50.00') && s.includes('−20.00') && s.endsWith('الرصيد المستحق: 30.00 ₪'));
  assert.ok(!/[٠-٩]/.test(s + r));
  const long = statementText({ shopName: 's', customerName: 'c', entries: Array.from({ length: 20 }, (_, i) => E('adjustment', 100, i + 1)), limit: 5 });
  assert.ok(long.includes('رصيد سابق: 15.00 ₪'));
});

test('Daftara backup: customers with balances, decimals to agorot', () => {
  const list = parseDaftaraBackup({
    app: 'daftara', version: 3,
    customers: [{ id: 1, uid: 'u1', name: 'أبو أحمد', phone: '0599111222' }, { id: 2, uid: 'u2', name: 'أم علي', note: 'جارة' }, { id: 3, uid: 'u3', name: 'محذوف', deleted: 1 }],
    transactions: [
      { customerUid: 'u1', customerId: 1, type: 'debt', amount: 50.5 }, { customerUid: 'u1', customerId: 1, type: 'payment', amount: 20 },
      { customerId: 2, type: 'debt', amount: 0.1 }, { customerId: 2, type: 'debt', amount: 0.2 }, { customerUid: 'u1', type: 'debt', amount: 99, deleted: 1 },
    ],
  });
  assert.deepEqual(list.map((c) => [c.name, c.balance, c.ref]), [['أبو أحمد', 3050, 'u1'], ['أم علي', 30, 'u2']]);
  assert.throws(() => parseDaftaraBackup({ app: 'other' }), /ليس ملف نسخة من دفترة/);
  assert.throws(() => parseDaftaraBackup(null), /ليس ملف/);
});
