import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseLine, purchaseTotal, buildPurchase, stockAlerts, suggestedOrderQty, reorderText, countSummary } from '../src/domain/inventory.js';

let n = 0;
const env = (x = {}) => ({ newId: () => `i${++n}`, now: '2026-11-13T10:00:00.000Z', prefix: 'A', seq: 3, ...x });
const milk = { id: 'p1', name: 'حليب', unit: 'piece', cost_price: 400 };
const carton = { id: 'u1', name: 'كرتونة', factor: 12000 };

test('purchase: packs become base units with per-piece cost', () => {
  const l = purchaseLine(milk, { pack: carton, qty: 2000, unitCost: 4560 });
  assert.equal(purchaseLine(milk, { pack: carton }).unit_cost, 4800);
  const r = buildPurchase({ lines: [l, purchaseLine(milk, { qty: 5000 })], supplierId: 's1', paid: 'credit' }, env());
  assert.equal(r.invoice.number, 'A-P0003');
  assert.equal(r.total, 9120 + 2000);
  assert.equal(purchaseTotal([l]), 9120);
  assert.deepEqual(r.movements.map((m) => [m.qty, m.unit_cost]), [[24000, 380], [5000, 400]]);
  assert.deepEqual(r.supplierEntries.map((e) => [e.type, e.amount]), [['purchase', 11120]]);
  assert.equal(r.payments.length, 0);
  assert.equal(r.invoice.paid, 0);
});

test('purchase paid in cash: drawer out, supplier balance stays zero', () => {
  const r = buildPurchase({ lines: [purchaseLine(milk, { qty: 10000 })], supplierId: 's1', paid: 'cash' }, env());
  assert.deepEqual(r.payments.map((p) => [p.direction, p.amount]), [['out', 4000]]);
  assert.equal(r.supplierEntries.reduce((a, e) => a + e.amount, 0), 0);
  const noSup = buildPurchase({ lines: [purchaseLine(milk)], paid: 'cash' }, env());
  assert.equal(noSup.supplierEntries.length, 0);
  assert.throws(() => buildPurchase({ lines: [purchaseLine(milk)], paid: 'credit' }, env()), /اختر المورّد/);
  assert.throws(() => buildPurchase({ lines: [] }, env()), /أضف صنفًا/);
});

test('alerts: out, low, expiring within 30 days, dead stock after 60 days', () => {
  const now = Date.parse('2026-11-13T00:00:00Z');
  const old = '2026-08-01T00:00:00.000Z';
  const P = (name, qty, x = {}) => ({ id: name, name, qty, low_stock: null, created_at: old, last_sale_at: '2026-11-10T00:00:00.000Z', ...x });
  const a = stockAlerts([
    P('نفد', 0), P('منخفض', 3000), P('سليم', 9000), P('ينتهي', 9000, { expiry_date: '2026-12-01' }),
    P('بعيد', 9000, { expiry_date: '2027-06-01' }), P('راكد', 9000, { last_sale_at: null }), P('جديد', 9000, { last_sale_at: null, created_at: '2026-11-01T00:00:00.000Z' }),
    P('حد خاص', 8000, { low_stock: 10000 }),
  ], { now });
  assert.deepEqual(a.out.map((p) => p.name), ['نفد']);
  assert.deepEqual(a.low.map((p) => p.name), ['منخفض', 'حد خاص']);
  assert.deepEqual(a.expiring.map((p) => p.name), ['ينتهي']);
  assert.deepEqual(a.dead.map((p) => p.name), ['راكد']);
  assert.equal(suggestedOrderQty(P('x', 3000)), 7000);
  assert.equal(suggestedOrderQty(P('x', 0)), 10000);
});

test('reorder message and stock count differences', () => {
  const t = reorderText({ shopName: 'بقالة النور', supplierName: 'أبو سامي', items: [{ name: 'حليب', unit: 'piece', qty: 24000 }, { name: 'جبنة', unit: 'kg', qty: 5500 }] });
  assert.ok(t.includes('1. حليب — 24 قطعة') && t.includes('2. جبنة — 5.5 كغ') && t.includes('أبو سامي'));
  const s = countSummary([
    { product_id: 'a', recorded: 10000, actual: 8000, unit_cost: 400 },
    { product_id: 'b', recorded: 5000, actual: 5000, unit_cost: 100 },
    { product_id: 'c', recorded: 1000, actual: 2500, unit_cost: 200 },
  ]);
  assert.deepEqual(s.rows.map((r) => [r.diff, r.value]), [[-2000, -800], [0, 0], [1500, 300]]);
  assert.equal(s.changed.length, 2);
  assert.equal(s.diffValue, -500);
});
