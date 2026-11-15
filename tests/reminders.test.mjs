import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSettings, periodKey, slotIn, isDue, nextRun, whenText, pickRecipients, LAST_DAY } from '../src/domain/reminders.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();

test('monthly reminder: on the chosen day and hour, once per month, catches up if the app was closed', () => {
  const s = scheduleSettings({ enabled: true, freq: 'monthly', day: 25, hour: 10 });
  assert.equal(isDue(s, at(2026, 11, 24)), false);
  assert.equal(isDue(s, at(2026, 11, 25, 9)), false, 'before the hour');
  assert.equal(isDue(s, at(2026, 11, 25, 10)), true);
  assert.equal(isDue(s, at(2026, 11, 28)), true, 'app opened later in the month');
  const sent = { ...s, lastRun: periodKey(at(2026, 11, 25), 'monthly') };
  assert.equal(isDue(sent, at(2026, 11, 30)), false, 'only once a month');
  assert.equal(isDue(sent, at(2026, 12, 25, 11)), true, 'next month again');
  assert.equal(whenText(nextRun(sent, at(2026, 11, 26))), 'الجمعة 25/12 الساعة 10:00');
  // آخر يوم في الشهر، ويوم 31 في شهر من 30
  assert.equal(slotIn(at(2026, 2, 3), { ...s, day: LAST_DAY }).getDate(), 28);
  assert.equal(slotIn(at(2026, 4, 3), { ...s, day: 31 }).getDate(), 30);
  assert.equal(isDue(scheduleSettings({ enabled: false }), at(2026, 11, 28)), false);
});

test('weekly reminder: the chosen weekday, week starts on Saturday', () => {
  const s = scheduleSettings({ enabled: true, freq: 'weekly', day: 4, hour: 10 }); // الخميس
  assert.equal(new Date(slotIn(at(2026, 11, 15), s)).getDay(), 4);
  assert.equal(isDue(s, at(2026, 11, 18)), false); // الأربعاء
  assert.equal(isDue(s, at(2026, 11, 19, 10)), true); // الخميس
  assert.equal(periodKey(at(2026, 11, 14), 'weekly'), periodKey(at(2026, 11, 20), 'weekly'), 'Sat..Fri is one week');
  assert.notEqual(periodKey(at(2026, 11, 20), 'weekly'), periodKey(at(2026, 11, 21), 'weekly'));
});

test('who gets reminded: owes at least the minimum, old enough, has a phone, not excluded', () => {
  const now = at(2026, 11, 25);
  const c = (id, balance, days, phone = '0599', extra = {}) => ({ id, name: id, balance, phone, oldestUnpaidAt: new Date(now - days * 86400000).toISOString(), ...extra });
  const list = [c('a', 50000, 40), c('b', 500, 40), c('c', 20000, 3), c('d', 90000, 60, null), c('e', 30000, 45), c('f', 0, 0)];
  const s = scheduleSettings({ minBalance: 1000, minDays: 30, excluded: ['e'] });
  assert.deepEqual(pickRecipients(list, s, now).map((x) => x.id), ['a']);
  assert.deepEqual(pickRecipients(list, { ...s, minDays: 0, excluded: [] }, now).map((x) => x.id), ['a', 'e', 'c']);
});

test('Arabic count of customers', async () => {
  const { customersText } = await import('../src/domain/reminders.js');
  assert.deepEqual([1, 2, 3, 10, 11, 25].map(customersText), ['زبون واحد', 'زبونان', '3 زبائن', '10 زبائن', '11 زبونًا', '25 زبونًا']);
});
