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

// ---------- إضافات 1.3.0: التحقق من التاريخ، التنظيف، سطر التذكير، وخدمة المواعيد ----------
test('isDay, pruneDues and the reminder line', async () => {
  const { isDay, pruneDues, dueSummary, supplierDues } = await import('../src/domain/dues.js');
  assert.ok(isDay('2026-11-30'));
  for (const bad of ['2026-11-31', '2026-13-01', '26-11-19', '', null, '2026/11/19']) assert.ok(!isDay(bad), String(bad));
  const list = [{ id: 'a', name: 'أبو خالد', balance: 160000 }, { id: 'b', name: 'الألبان', balance: 45050 }, { id: 'c', name: 'مسدَّد', balance: 0 }];
  const map = { a: { date: '2026-11-19', note: 'شيك' }, b: { date: '2026-11-17', note: null }, c: { date: '2026-11-19' }, gone: { date: '2026-11-19' }, x: { date: 'bad' } };
  assert.deepEqual(Object.keys(pruneDues(map, list)), ['a', 'b'], 'settled, deleted and invalid entries are dropped');
  assert.deepEqual(Object.keys(pruneDues(map, list, 'c')), ['a', 'b', 'c'], 'the one being set is kept');
  const due = supplierDues(list, map, '2026-11-19');
  const s = dueSummary(due);
  assert.equal(s.title, 'دفعتان للتجار حان موعدهما');
  assert.equal(s.total, 205050);
  assert.equal(s.overdue, 1);
  assert.equal(s.supplierId, null);
  const one = dueSummary(supplierDues(list, { a: map.a }, '2026-11-19'));
  assert.match(one.title, /اليوم موعد الدفع لـ أبو خالد/);
  assert.equal(one.supplierId, 'a');
  assert.equal(dueSummary([]), null);
});

test('dues service: released storage shape, set/clear with note, one reminder a day', async () => {
  const { createDues } = await import('../src/core/dues.js');
  const list = [{ id: 'a', name: 'أبو خالد', balance: 160000 }, { id: 'b', name: 'الألبان', balance: 45050 }];
  // محل حدّد موعدًا في إصدار سابق: يبقى مقروءًا كما هو
  const app = {
    shop: { base_currency: 'ILS', settings: { supplierDues: { b: { date: '2026-11-17', note: 'شيك' } } } },
    inventory: { suppliers: async () => list },
    async updateShopSettings(patch) { app.shop.settings = { ...app.shop.settings, ...patch }; },
  };
  const mem = new Map();
  const toasts = [];
  let day = '2026-11-19';
  const d = createDues(app, { toast: (m) => toasts.push(m), storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }, today: () => day });
  assert.deepEqual(d.get('b'), { date: '2026-11-17', note: 'شيك' });
  await assert.rejects(d.set('a', '2026-02-30'), /التاريخ/);
  await d.set('a', '2026-11-19', ' دفعة أولى ');
  assert.deepEqual(app.shop.settings.supplierDues, { b: { date: '2026-11-17', note: 'شيك' }, a: { date: '2026-11-19', note: 'دفعة أولى' } });
  await d.check();
  await d.check();
  assert.equal(toasts.length, 1, 'reminded once per day, not on every return to the app');
  assert.match(toasts[0], /دفعتان للتجار/);
  day = '2026-11-20';
  await d.check();
  assert.equal(toasts.length, 2, 'and again the next day while still unpaid');
  await d.set('a', null);
  await d.set('b', null);
  assert.deepEqual(app.shop.settings.supplierDues, {});
  day = '2026-11-21';
  await d.check();
  assert.equal(toasts.length, 2, 'nothing due → silent');
});
