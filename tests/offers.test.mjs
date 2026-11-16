import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOffers, offerActive, offerState, offerProblem, offerTitle, offerBadge } from '../src/domain/offers.js';
import { makeLine, cartTotals, buildSale } from '../src/domain/cart.js';

const P = (id, price, extra = {}) => ({ id, name: id, sell_price: price, cost_price: 0, unit: 'piece', ...extra });
const today = '2026-11-16';
const cat = new Map([['soap', 'clean'], ['bleach', 'clean'], ['milk', 'dairy']]);
const opt = { today, categoryOf: (id) => cat.get(id) || null };
const line = (p, n) => ({ ...makeLine(p), qty: n * 1000 });

test('dates and states', () => {
  const o = { type: 'percent', percent: 1000, target: { kind: 'all' }, from: '2026-11-10', to: '2026-11-20' };
  assert.equal(offerActive(o, today), true);
  assert.equal(offerActive(o, '2026-11-09'), false);
  assert.equal(offerActive(o, '2026-11-21'), false);
  assert.equal(offerActive({ ...o, active: false }, today), false);
  assert.equal(offerState(o, '2026-11-01'), 'scheduled');
  assert.equal(offerState(o, '2026-12-01'), 'ended');
  assert.equal(offerState({ ...o, active: false }, today), 'off');
  assert.equal(offerActive({ ...o, from: null, to: null }, '2030-01-01'), true, 'open-ended');
});

test('validation and titles', () => {
  assert.match(offerProblem({ type: 'x' }), /نوع/);
  assert.match(offerProblem({ type: 'percent', target: { kind: 'product' }, percent: 1000 }), /الصنف/);
  assert.match(offerProblem({ type: 'percent', target: { kind: 'all' }, percent: 0 }), /النسبة/);
  assert.match(offerProblem({ type: 'bxgy', target: { kind: 'category', id: 'c' }, buy: 2, get: 1 }), /لصنف واحد/);
  assert.match(offerProblem({ type: 'bundle', target: { kind: 'product', id: 'p' }, qty: 1, price: 100 }), /العدد/);
  assert.match(offerProblem({ type: 'percent', target: { kind: 'all' }, percent: 500, from: '2026-11-20', to: '2026-11-10' }), /قبل/);
  assert.equal(offerProblem({ type: 'bxgy', target: { kind: 'product', id: 'p' }, buy: 2, get: 1 }), null);
  assert.equal(offerTitle({ type: 'bxgy', buy: 2, get: 1, target: { kind: 'product' } }, { product: 'صابون' }), 'صابون: اشترِ 2 واحصل على 1 مجانًا');
  assert.equal(offerTitle({ type: 'percent', percent: 1250, target: { kind: 'category' } }, { category: 'منظفات' }), 'خصم 12.5% على منظفات');
  assert.equal(offerTitle({ type: 'bundle', qty: 3, price: 1000, target: { kind: 'product' } }, { product: 'بيبسي' }), 'بيبسي: 3 بـ 10.00 ₪');
  assert.equal(offerBadge({ type: 'bxgy', buy: 2, get: 1 }), '2+1');
});

test('buy 2 get 1: free units across split lines, only full groups', () => {
  const soap = P('soap', 500);
  const offers = [{ id: 'o1', type: 'bxgy', buy: 2, get: 1, target: { kind: 'product', id: 'soap' } }];
  let r = applyOffers([line(soap, 2)], offers, opt);
  assert.equal(r.saved, 0, '2 pieces: no free one yet');
  r = applyOffers([line(soap, 3)], offers, opt);
  assert.equal(r.saved, 500);
  assert.equal(r.lines[0].discount, 500);
  assert.equal(r.lines[0].offer, '2+1');
  r = applyOffers([line(soap, 4), line(soap, 3)], offers, opt);
  assert.equal(r.saved, 1000, '7 pieces = 2 free');
  assert.equal(r.lines[0].discount + r.lines[1].discount, 1000);
  assert.ok(r.lines.every((l) => l.discount <= l.qty / 1000 * l.unit_price));
});

test('bundle price, percent on category and on all, best offer wins, no stacking', () => {
  const pepsi = P('pepsi', 400); const soap = P('soap', 1000); const milk = P('milk', 600);
  const offers = [
    { id: 'b', type: 'bundle', qty: 3, price: 1000, target: { kind: 'product', id: 'pepsi' } },
    { id: 'c', type: 'percent', percent: 1000, target: { kind: 'category', id: 'clean' } },
    { id: 'a', type: 'percent', percent: 500, target: { kind: 'all' } },
  ];
  const r = applyOffers([line(pepsi, 7), line(soap, 2), line(milk, 1)], offers, opt);
  // ببسي: 7 = مجموعتان (24 − 20) × 2 = 400، أفضل من 5% (140)
  assert.equal(r.lines[0].offer_discount, 400);
  assert.equal(r.lines[0].offer_id, 'b');
  // صابون: 10% (التصنيف) أفضل من 5% (الكل)
  assert.equal(r.lines[1].offer_discount, 200);
  assert.equal(r.lines[2].offer_discount, 30, 'milk gets the 5% for everything');
  assert.equal(r.saved, 630);
  assert.deepEqual(new Set(r.applied), new Set(['b', 'c', 'a']));
});

test('manual price or discount keeps the cashier decision; inactive offers do nothing; measured lines skip unit offers', () => {
  const soap = P('soap', 500);
  const offers = [{ id: 'o', type: 'percent', percent: 2000, target: { kind: 'product', id: 'soap' } },
    { id: 'off', type: 'percent', percent: 5000, target: { kind: 'all' }, active: false }];
  const manual = { ...line(soap, 2), discount: 50 };
  const custom = { ...line(soap, 2), key: 'soap::custom', unit_price: 400 };
  const r = applyOffers([manual, custom, line(soap, 1)], offers, opt);
  assert.equal(r.lines[0].discount, 50);
  assert.equal(r.lines[1].discount, 0);
  assert.equal(r.lines[2].discount, 100);
  const cheese = P('cheese', 4000, { unit: 'kg' });
  const kg = { ...makeLine(cheese), qty: 1500 };
  const r2 = applyOffers([kg], [{ id: 'x', type: 'bxgy', buy: 1, get: 1, target: { kind: 'product', id: 'cheese' } }], opt);
  assert.equal(r2.saved, 0);
  assert.equal(applyOffers([line(soap, 3)], [], opt).saved, 0);
});

test('the offer discount flows into totals and the saved invoice lines', () => {
  const soap = P('soap', 500);
  const r = applyOffers([line(soap, 3)], [{ id: 'o1', type: 'bxgy', buy: 2, get: 1, target: { kind: 'product', id: 'soap' } }], opt);
  const t = cartTotals(r.lines);
  assert.equal(t.total, 1000);
  let n = 0;
  const sale = buildSale({ lines: r.lines, payments: [{ kind: 'cash', amount: 1000 }] }, { newId: () => `id${n++}`, now: '2026-11-16T10:00:00.000Z', prefix: 'A', seq: 1 });
  assert.equal(sale.invoice.total, 1000);
  assert.equal(sale.lines[0].discount, 500);
  assert.equal(sale.lines[0].total, 1000);
});
