import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, dueStatus, dueText, supplierDues } from '../src/domain/dues.js';

test('dates and wording', () => {
  assert.equal(addDays('2026-11-16', 14), '2026-11-30');
  assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30', 'no DST drift');
  assert.equal(daysBetween('2026-11-16', '2026-11-13'), -3);
  assert.deepEqual(dueStatus('2026-11-16', '2026-11-16'), { days: 0, state: 'today' });
  assert.equal(dueStatus('2026-11-19', '2026-11-16').state, 'soon');
  assert.equal(dueStatus('2026-11-20', '2026-11-16').state, 'later');
  assert.equal(dueStatus('2026-11-10', '2026-11-16').state, 'overdue');
  assert.equal(dueText(-6), 'متأخر 6 أيام');
  assert.equal(dueText(-2), 'متأخر يومين');
  assert.equal(dueText(1), 'غدًا');
  assert.equal(dueText(5), 'بعد 5 أيام');
});

test('supplier dues: only who you still owe, overdue first', () => {
  const sups = [{ id: 'a', name: 'أبو خالد', balance: 50000 }, { id: 'b', name: 'شركة الألبان', balance: 12000 },
    { id: 'c', name: 'مسدد', balance: 0 }, { id: 'd', name: 'بعيد', balance: 100 }, { id: 'e', name: 'بلا موعد', balance: 900 }];
  const dues = { a: { date: '2026-11-18' }, b: { date: '2026-11-10', note: 'شيك' }, c: { date: '2026-11-15' }, d: { date: '2026-12-30' } };
  const r = supplierDues(sups, dues, '2026-11-16');
  assert.deepEqual(r.map((x) => [x.supplier.id, x.days, x.state]), [['b', -6, 'overdue'], ['a', 2, 'soon']]);
  assert.equal(r[0].note, 'شيك');
  assert.equal(supplierDues(sups, dues, '2026-11-16', { all: true }).length, 3);
  assert.deepEqual(supplierDues(sups, null, '2026-11-16'), []);
});
