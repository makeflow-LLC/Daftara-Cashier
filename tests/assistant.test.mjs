import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderPlan, deadStock, daysLeftText } from '../src/domain/inventory.js';

const DAY = 86400000;
const now = Date.parse('2026-11-16T12:00:00Z');
const ago = (d) => new Date(now - d * DAY).toISOString();
const P = (id, qty, extra = {}) => ({ id, name: id, unit: 'piece', qty, created_at: ago(200), cost_price: 100, avg_cost: 100, ...extra });

test('reorder plan: days left from 30-day sales speed, order covers two weeks', () => {
  const products = [P('sugar', 6000), P('rice', 100000), P('salt', 0), P('new', 4000, { created_at: ago(2) }), P('nosales', 1000)];
  const sold = new Map([['sugar', 60000], ['rice', 30000], ['salt', 15000], ['new', 14000]]);
  const plan = reorderPlan(products, sold, { now });
  const by = Object.fromEntries(plan.map((x) => [x.p.id, x]));
  // سكر: 2 يوميًا، عنده 6 ← 3 أيام، اطلب 2×14−6 = 22
  assert.equal(by.sugar.daysLeft, 3);
  assert.equal(by.sugar.perDay, 2000);
  assert.equal(by.sugar.qty, 22000);
  assert.equal(by.rice, undefined, 'rice lasts 100 days');
  assert.equal(by.salt.daysLeft, 0, 'out of stock comes first');
  assert.equal(by.salt.qty, 7000);
  assert.equal(by.nosales, undefined, 'no sales, no guess');
  // صنف عمره يومان: السرعة على 7 أيام لا على يومين (14/7 = 2 يوميًا، عنده 4 ← يومان)
  assert.equal(by.new.daysLeft, 2);
  assert.deepEqual(plan.map((x) => x.p.id), ['salt', 'new', 'sugar']);
  // المرتجع يطرح من المباع
  assert.equal(reorderPlan([P('x', 10000)], new Map([['x', -5000]]), { now }).length, 0);
});

test('dead stock: by money tied up, ignores new items and recent sellers', () => {
  const products = [
    P('old', 10000, { avg_cost: 500, last_sale_at: ago(90) }),
    P('never', 3000, { avg_cost: 4000, last_sale_at: null }),
    P('recent', 10000, { last_sale_at: ago(5) }),
    P('fresh', 10000, { created_at: ago(10), last_sale_at: null }),
    P('empty', 0, { last_sale_at: ago(90) }),
  ];
  const d = deadStock(products, { now });
  assert.deepEqual(d.map((x) => x.p.id), ['never', 'old']);
  assert.equal(d[0].value, 12000);
  assert.equal(d[1].days, 90);
  assert.equal(daysLeftText(0), 'نفد أو يخلص اليوم');
  assert.equal(daysLeftText(5), 'يخلص خلال 5 أيام');
});
