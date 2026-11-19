import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, isDateKey, addDays, daysUntil, dueStatus, dueText, daysText, dueList, dueAlerts, pruneDues, ALERT_DAYS } from '../src/domain/dues.js';
import { createDues } from '../src/core/dues.js';

const NOW = new Date(2026, 10, 19, 15, 30).getTime(); // 19/11/2026 بعد الظهر (محلي)

test('dates: local day keys, validation, calendar-day differences', () => {
  assert.equal(dateKey(NOW), '2026-11-19');
  assert.ok(isDateKey('2026-11-30'));
  for (const bad of ['2026-11-31', '2026-13-01', '26-11-19', '', null, '2026/11/19']) assert.ok(!isDateKey(bad), String(bad));
  assert.equal(addDays(7, NOW), '2026-11-26');
  assert.equal(addDays(30, NOW), '2026-12-19');
  assert.equal(daysUntil('2026-11-19', NOW), 0);
  assert.equal(daysUntil('2026-11-20', NOW), 1, 'tomorrow is one day away even late in the afternoon');
  assert.equal(daysUntil('2026-11-17', new Date(2026, 10, 19, 0, 5).getTime()), -2);
  assert.equal(daysUntil('2027-01-01', NOW), 43);
});

test('status and wording', () => {
  assert.deepEqual(dueStatus('2026-11-19', NOW), { days: 0, state: 'today', alert: true });
  assert.equal(dueStatus('2026-11-20', NOW).state, 'soon');
  assert.equal(dueStatus(addDays(ALERT_DAYS, NOW), NOW).state, 'soon');
  assert.deepEqual(dueStatus(addDays(ALERT_DAYS + 1, NOW), NOW), { days: ALERT_DAYS + 1, state: 'later', alert: false });
  assert.equal(dueStatus('2026-11-10', NOW).state, 'overdue');
  assert.equal(dueText(dueStatus('2026-11-19', NOW)), 'اليوم');
  assert.equal(dueText(dueStatus('2026-11-20', NOW)), 'غدًا');
  assert.equal(dueText(dueStatus('2026-11-21', NOW)), 'بعد يومين');
  assert.equal(dueText(dueStatus('2026-11-22', NOW)), 'بعد 3 أيام');
  assert.equal(dueText(dueStatus('2026-11-18', NOW)), 'متأخر يوم');
  assert.equal(dueText(dueStatus('2026-11-17', NOW)), 'متأخر يومين');
  assert.equal(dueText(dueStatus('2026-11-04', NOW)), 'متأخر 15 يومًا');
  assert.equal(daysText(10), '10 أيام');
  assert.equal(daysText(11), '11 يومًا');
});

const suppliers = [
  { id: 'a', name: 'أبو خالد', balance: 160000 },
  { id: 'b', name: 'شركة الألبان', balance: 45050 },
  { id: 'c', name: 'مخبز السلام', balance: -6000 },
  { id: 'd', name: 'مصنع العصير', balance: 9000 },
  { id: 'e', name: 'مسدَّد', balance: 0 },
];

test('due list and alerts: only traders you still owe, nearest first', () => {
  const map = { a: '2026-11-21', b: '2026-11-17', c: '2026-11-19', d: '2026-12-25', e: '2026-11-19', gone: '2026-11-19', x: 'bad' };
  assert.deepEqual(dueList(suppliers, map, NOW).map((s) => [s.id, s.status.state]), [['b', 'overdue'], ['a', 'soon'], ['d', 'later']]);
  const a = dueAlerts(suppliers, map, NOW);
  assert.deepEqual(a.items.map((s) => s.id), ['b', 'a']);
  assert.equal(a.total, 205050);
  assert.equal(a.overdue, 1);
  assert.equal(dueAlerts(suppliers, { d: '2026-12-25' }, NOW), null, 'a far date does not alert yet');
  assert.equal(dueAlerts(suppliers, {}, NOW), null);
  assert.equal(dueAlerts(suppliers, null, NOW), null);
  assert.deepEqual(pruneDues(map, suppliers), { a: '2026-11-21', b: '2026-11-17', d: '2026-12-25' }, 'settled, deleted and invalid entries are dropped');
});

function fakeApp(list, settings = {}) {
  const app = {
    shop: { base_currency: 'ILS', settings },
    inventory: { suppliers: async () => list },
    async updateShopSettings(patch) { app.shop.settings = { ...app.shop.settings, ...patch }; },
  };
  return app;
}
function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

test('dues service: set, clear, one reminder a day, summary text', async () => {
  const app = fakeApp(suppliers);
  const toasts = [], emitted = [];
  const d = createDues(app, { toast: (m) => toasts.push(m), emit: (a) => emitted.push(a), storage: fakeStorage() });
  await d.check(NOW);
  assert.equal(toasts.length, 0, 'nothing due → silent');
  await assert.rejects(d.set('a', '2026-02-30'), /التاريخ/);
  await d.set('a', dateKey(NOW));
  assert.equal(d.get('a'), '2026-11-19');
  assert.deepEqual(app.shop.settings.supplierDue, { a: '2026-11-19' });
  await d.refresh(NOW);
  assert.match(d.summary().title, /اليوم موعد سداد أبو خالد/);
  assert.match(d.summary().sub, /1,600\.00/);
  assert.equal(d.summary().supplierId, 'a');
  await d.check(NOW);
  await d.check(NOW);
  assert.equal(toasts.length, 1, 'reminded once per day, not on every return to the app');
  await d.check(NOW + 86400000);
  assert.equal(toasts.length, 2, 'and again the next day while still unpaid');
  assert.match(toasts[1], /متأخر يوم/);
  await d.set('b', '2026-11-17');
  await d.refresh(NOW);
  assert.match(d.summary().title, /دفعتان للتجار حان موعدهما/);
  assert.equal(d.summary().supplierId, null);
  await d.set('a', null);
  await d.set('b', null);
  assert.deepEqual(app.shop.settings.supplierDue, {});
  assert.equal((await d.refresh(NOW)), null);
  assert.ok(emitted.length >= 3, 'screens are told when alerts change');
});
