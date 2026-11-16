import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/domain/reports.js';
import { dailyDigest, pctChange, hourly, hourLabel, weekdayName } from '../src/domain/daily.js';

const at = (day, h) => new Date(`${day}T${String(h).padStart(2, '0')}:30:00`).toISOString();
const I = (id, day, h, total, cost = 0, type = 'sale', by = null) => ({ id, type, status: 'final', total, cost_total: cost, fee_total: 0, created_at: at(day, h), created_by: by });
const range = (day, n = 1) => { const a = new Date(`${day}T00:00:00`); const b = new Date(a); b.setDate(b.getDate() + n); return { from: a.toISOString(), to: b.toISOString() }; };
const rep = (invoices, lines, day, n = 1) => buildReport({ invoices, lines, payments: [], ...range(day, n) });

test('helpers', () => {
  assert.equal(pctChange(120, 100), 20);
  assert.equal(pctChange(80, 100), -20);
  assert.equal(pctChange(5, 0), null);
  assert.equal(hourLabel(18), '6–7 مساءً');
  assert.equal(hourLabel(9), '9–10 صباحًا');
  assert.equal(hourLabel(12), '12–1 ظهرًا');
  assert.equal(weekdayName('2026-11-16'), 'الاثنين');
  const h = hourly([I('a', '2026-11-16', 18, 500), I('b', '2026-11-16', 18, 300), I('r', '2026-11-16', 18, 100, 0, 'sale_return'), I('p', '2026-11-16', 9, 999, 0, 'purchase')]);
  assert.equal(h[18], 700);
  assert.equal(h[9], 0, 'purchases are not sales');
});

test('digest compares with yesterday and last week and explains it', () => {
  const day = '2026-11-16';
  const inv = [
    I('t1', day, 18, 6000, 4000), I('t2', day, 18, 3000, 2000, 'sale', 'm1'), I('t3', day, 10, 3000, 2000),
    I('y1', '2026-11-15', 12, 10000, 7000),
    I('w1', '2026-11-09', 12, 8000, 6000),
    I('d2', '2026-11-12', 12, 9000, 6000), I('d3', '2026-11-13', 12, 9000, 6000), I('d4', '2026-11-14', 12, 9000, 6000),
  ];
  const lines = [{ invoice_id: 't1', product_id: 'p1', name: 'سكر', qty: 3000, unit_factor: 1000, total: 6000, unit_cost: 1300 }];
  const products = [{ id: 'p1', name: 'سكر', unit: 'piece' }];
  const today = buildReport({ invoices: inv, lines, payments: [], products, ...range(day) });
  const g = dailyDigest({
    day, today, yesterday: rep(inv, [], '2026-11-15'), lastWeek: rep(inv, [], '2026-11-09'), week: rep(inv, [], '2026-11-10', 7),
    invoices: inv.filter((i) => i.created_at >= range(day).from && i.created_at < range(day).to),
    extra: { newDebt: 1500, collected: 2000, soon: [{ name: 'أرز' }], dues: [{ name: 'أبو خالد', amount: 50000, days: 2 }], staffName: (id) => (id ? 'سامي' : 'صاحب المحل') },
  });
  const net = g.kpis.find((k) => k.label === 'صافي المبيعات');
  assert.equal(net.raw, 12000);
  assert.equal(net.vsYesterday, 20);
  assert.equal(net.vsLastWeek, 50);
  assert.equal(g.kpis.find((k) => k.label === 'الربح').raw, 4000);
  assert.equal(g.bestHour, 18);
  assert.deepEqual(g.days.map((d) => d.sales), [0, 9000, 9000, 9000, 10000, 0, 12000].slice(0, 7).map((x, i) => g.days[i].sales));
  assert.equal(g.days.length, 7);
  assert.equal(g.days[6].today, true);
  assert.equal(g.days[6].sales, 12000);
  assert.equal(g.top[0].name, 'سكر');
  assert.deepEqual(g.staff.map((s) => s.name).sort(), ['سامي', 'صاحب المحل']);
  const text = g.notes.map((n) => n.text).join('\n');
  assert.match(text, /أعلى من أمس بـ 20%/);
  assert.match(text, /الاثنين الماضي/);
  assert.match(text, /أقوى ساعة: 6–7 مساءً/);
  assert.match(text, /الأكثر مبيعًا: «سكر»/);
  assert.match(text, /بالآجل/);
  assert.match(text, /يخلص خلال أسبوع: أرز/);
  assert.match(text, /أبو خالد/);
});

test('owner-only numbers hidden for staff; empty day still renders', () => {
  const day = '2026-11-16';
  const empty = rep([], [], day);
  const g = dailyDigest({ day, today: empty, yesterday: empty, lastWeek: empty, week: rep([], [], '2026-11-10', 7) }, { showProfit: false });
  assert.equal(g.kpis.some((k) => k.label === 'الربح'), false);
  assert.equal(g.notes[0].text, 'لا مبيعات مسجّلة في هذا اليوم.');
  assert.equal(g.kpis[0].vsYesterday, null);
});
