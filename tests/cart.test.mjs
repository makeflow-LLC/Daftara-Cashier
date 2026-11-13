import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeLine, lineTotal, addLine, cartTotals, paymentSummary, validatePayment, buildSale,
  returnableLines, netLineTotals, buildReturn,
} from '../src/domain/cart.js';

const milk = { id: 'p1', name: 'حليب', unit: 'piece', sell_price: 500, cost_price: 400 };
const cloth = { id: 'p2', name: 'قماش', unit: 'meter', sell_price: 1200, cost_price: 800 };
const carton = { id: 'u1', name: 'كرتونة', factor: 12000, sell_price: 5500 };
let n = 0;
const env = (extra = {}) => ({ newId: () => `id${++n}`, now: '2026-11-13T10:00:00.000Z', prefix: 'A', seq: 7, currency: 'ILS', ...extra });

test('lines: pieces, packs, fractional meters, merging', () => {
  const l = makeLine(milk, { avgCost: 380 });
  assert.equal(l.unit_cost, 380);
  assert.equal(lineTotal(l), 500);
  const pk = makeLine(milk, { pack: carton, avgCost: 380 });
  assert.equal(pk.unit_price, 5500);
  assert.equal(pk.unit_cost, 4560); // 12 × 3.80
  assert.equal(makeLine(milk, { pack: { ...carton, sell_price: null } }).unit_price, 6000);
  const m = makeLine(cloth, { qty: 2500 }); // 2.5 متر
  assert.equal(lineTotal(m), 3000);
  let lines = addLine([], l);
  lines = addLine(lines, makeLine(milk));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].qty, 2000);
  lines = addLine(lines, pk);
  assert.equal(lines.length, 2, 'carton is its own line');
  assert.equal(lineTotal({ ...l, discount: 9999 }), 0, 'never negative');
});

test('totals with line and invoice discounts, profit after fees', () => {
  const lines = [{ ...makeLine(milk, { qty: 3000, avgCost: 400 }), discount: 100 }, makeLine(cloth, { qty: 1500 })];
  // 3×5 − 1 = 14 ؛ 1.5×12 = 18 → 32
  let t = cartTotals(lines);
  assert.deepEqual(t, { subtotal: 3200, discount: 0, total: 3200, cost: 2400, profit: 800, count: 2 });
  t = cartTotals(lines, { type: 'percent', value: 1000 }, 50);
  assert.equal(t.discount, 320);
  assert.equal(t.total, 2880);
  assert.equal(t.profit, 2880 - 2400 - 50);
  assert.equal(cartTotals(lines, { type: 'amount', value: 99999 }).total, 0, 'discount capped');
});

test('payments: change from cash, fees on transfers, credit, validation', () => {
  let s = paymentSummary(3200, [{ kind: 'cash', amount: 5000 }]);
  assert.equal(s.change, 1800);
  assert.equal(s.remaining, 0);
  s = paymentSummary(3200, [{ kind: 'transfer', amount: 2000, fee_bp: 150 }, { kind: 'cash', amount: 2000 }]);
  assert.equal(s.fees, 30);
  assert.equal(s.change, 800);
  assert.equal(validatePayment(3200, [{ kind: 'cash', amount: 3000 }]), 'المبلغ المدفوع أقل من الإجمالي');
  assert.equal(validatePayment(3200, [{ kind: 'transfer', amount: 4000 }]), 'المدفوع بالتحويل أو الآجل أكثر من المطلوب');
  assert.equal(validatePayment(3200, [{ kind: 'credit', amount: 3200 }]), 'اختر الزبون للبيع بالآجل');
  assert.equal(validatePayment(3200, [{ kind: 'credit', amount: 3200 }], 'c1'), null);
  assert.equal(validatePayment(3200, []), 'اختر طريقة الدفع');
});

test('buildSale: invoice, lines, stock out in base units, cash net of change', () => {
  const lines = [makeLine(milk, { pack: carton, qty: 2000, avgCost: 400 }), makeLine(milk, { qty: 3000, avgCost: 400 })];
  const r = buildSale({ lines, payments: [{ kind: 'cash', amount: 20000, method_id: 'm-cash' }] }, env());
  assert.equal(r.invoice.number, 'A-0007');
  assert.deepEqual(r.lines.map((l) => l.position), [0, 1], 'cart order kept');
  assert.equal(r.invoice.total, 11000 + 1500);
  assert.equal(r.invoice.cost_total, 9600 + 1200);
  assert.equal(r.change, 20000 - 12500);
  assert.equal(r.payments[0].amount, 12500, 'drawer gets total, not the 200 note');
  assert.deepEqual(r.movements.map((m) => m.qty), [-24000, -3000]);
  assert.equal(r.movements[0].unit_cost, 400, 'cost per base unit');
  assert.equal(r.customerEntries.length, 0);
  assert.equal(r.profit, 12500 - 10800);
});

test('buildSale: split cash + transfer + credit to a customer', () => {
  const lines = [makeLine(milk, { qty: 10000 })];
  const r = buildSale({
    lines, customerId: 'c1',
    payments: [{ kind: 'cash', amount: 2000 }, { kind: 'transfer', amount: 2000, fee_bp: 100, method_id: 'bank' }, { kind: 'credit', amount: 1000 }],
  }, env());
  assert.equal(r.invoice.total, 5000);
  assert.equal(r.invoice.paid, 4000);
  assert.equal(r.invoice.fee_total, 20);
  assert.equal(r.payments.length, 3);
  assert.deepEqual(r.customerEntries.map((e) => [e.type, e.amount, e.customer_id]), [['sale_credit', 1000, 'c1']]);
  assert.throws(() => buildSale({ lines: [], payments: [] }, env()), /السلة فارغة/);
  assert.throws(() => buildSale({ lines, payments: [{ kind: 'credit', amount: 5000 }] }, env()), /اختر الزبون/);
});

test('returns: proportional refund incl. invoice discount, no over-return', () => {
  const inv = { id: 'inv1', number: 'A-0001', customer_id: 'c1', discount: 300, currency: 'ILS' };
  const lines = [
    { product_id: 'p1', unit_id: null, name: 'حليب', unit: 'piece', unit_factor: 1000, qty: 4000, unit_price: 500, total: 2000, unit_cost: 400 },
    { product_id: 'p2', unit_id: null, name: 'قماش', unit: 'meter', unit_factor: 1000, qty: 1000, unit_price: 1000, total: 1000, unit_cost: 800 },
  ];
  assert.deepEqual(netLineTotals(inv, lines), [1800, 900]);
  const r = buildReturn(inv, lines, [{ line: lines[0], qty: 1000 }], 'cash', env({ seq: 2 }));
  assert.equal(r.invoice.number, 'A-R0002');
  assert.equal(r.total, 450);
  assert.equal(r.movements[0].qty, 1000);
  assert.equal(r.payments[0].direction, 'out');
  assert.equal(r.payments[0].amount, 450);
  const c = buildReturn(inv, lines, [{ line: lines[1], qty: 1000 }], 'credit', env({ seq: 3 }));
  assert.deepEqual(c.customerEntries.map((e) => [e.type, e.amount]), [['return_credit', -900]]);
  assert.equal(c.payments.length, 0);
  const left = returnableLines(lines, r.lines);
  assert.equal(left[0].returnable, 3000);
  assert.equal(left[1].returnable, 1000);
  assert.throws(() => buildReturn(inv, lines, [{ line: lines[0], qty: 5000 }], 'cash', env()), /أكبر من المباع/);
  assert.throws(() => buildReturn({ ...inv, customer_id: null }, lines, [{ line: lines[0], qty: 1000 }], 'credit', env()), /نقدًا فقط/);
});
