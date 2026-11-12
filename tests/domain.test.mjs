import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divRound, parseDecimal, formatDecimal, normalizeDigits, allocate, percentOf, sum } from '../src/domain/money.js';
import { parseMoney, formatMoney, convertToBase, convertFromBase, parseRate } from '../src/domain/currency.js';
import { parseQty, formatQty, lineAmount, packToBase, baseToPack, perBaseUnitPrice } from '../src/domain/units.js';
import { signedQty, stockByProduct, foldProduct, stockLevel, stockValue } from '../src/domain/stock.js';
import { deviceLetter, formatInvoiceNumber, matchesInvoiceNumber } from '../src/domain/numbering.js';
import { presetFor, resolveFeatures, SHOP_TYPES, FEATURES } from '../src/domain/features.js';
import { remoteWins, appendWins, makeClock } from '../src/domain/merge.js';

test('divRound rounds half away from zero', () => {
  assert.equal(divRound(5, 2), 3);
  assert.equal(divRound(-5, 2), -3);
  assert.equal(divRound(4, 3), 1);
  assert.equal(divRound(5, 3), 2);
  assert.equal(divRound(0, 7), 0);
  assert.equal(divRound(-1, 3), 0);
  assert.equal(divRound(25n, 10n), 3n);
  assert.throws(() => divRound(1, 0));
  assert.throws(() => divRound(1.5, 1));
});

test('digits: Arabic-Indic input becomes western', () => {
  assert.equal(normalizeDigits('١٢٫٥'), '12.5');
  assert.equal(normalizeDigits('۱۲۳'), '123');
  assert.equal(normalizeDigits('1,5'), '1.5');
});

test('parseDecimal / formatDecimal never use floats', () => {
  assert.equal(parseDecimal('12.5', 2), 1250);
  assert.equal(parseDecimal('0.1', 2), 10);
  assert.equal(parseDecimal('.5', 2), 50);
  assert.equal(parseDecimal('12.345', 2), 1235);
  assert.equal(parseDecimal('12.344', 2), 1234);
  assert.equal(parseDecimal('-3', 2), -300);
  assert.equal(parseDecimal('', 2), null);
  assert.equal(parseDecimal('abc', 2), null);
  assert.equal(parseDecimal('1.2.3', 2), null);
  assert.equal(parseDecimal('٥', 2), 500);
  assert.equal(formatDecimal(123456, 2), '1,234.56');
  assert.equal(formatDecimal(-5, 2), '-0.05');
  assert.equal(formatDecimal(1500, 3, { trim: true }), '1.5');
  assert.equal(formatDecimal(2000, 3, { trim: true }), '2');
  // 0.1 + 0.2 كلاسيكي: بالأعداد الصحيحة لا مشكلة
  assert.equal(parseDecimal('0.1', 2) + parseDecimal('0.2', 2), parseDecimal('0.3', 2));
});

test('money formatting uses western digits and symbol', () => {
  assert.equal(formatMoney(1250), '12.50 ₪');
  assert.equal(formatMoney(1250, 'USD'), '12.50 $');
  assert.equal(formatMoney(1500, 'JOD'), '1.500 د.أ');
  assert.equal(parseMoney('1.5', 'JOD'), 1500);
  assert.ok(!/[٠-٩]/.test(formatMoney(987654321)));
});

test('currency conversion with integer rates', () => {
  const usd = parseRate('3.65');
  assert.equal(usd, 3650000);
  assert.equal(convertToBase(1000, 'USD', usd), 3650); // 10$ = 36.50₪
  assert.equal(convertToBase(1000, 'JOD', parseRate('5.15')), 515); // 1 دينار = 5.15₪
  assert.equal(convertFromBase(3650, 'USD', usd), 1000);
  assert.equal(convertToBase(777, 'ILS', 1), 777);
  assert.equal(parseRate('0'), null);
});

test('allocate splits without losing a single agora', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(allocate(1000, [3, 1]), [750, 250]);
  assert.deepEqual(allocate(5, [0, 0]), [5, 0]);
  assert.equal(sum(allocate(9999, [7, 13, 2, 5])), 9999);
  assert.equal(percentOf(10000, 150), 150); // 1.5% من 100₪
});

test('quantities: fractional, packs and line amounts', () => {
  assert.equal(parseQty('1.5'), 1500);
  assert.equal(parseQty('0.250'), 250);
  assert.equal(formatQty(1500), '1.5');
  assert.equal(lineAmount(1200, 1500), 1800); // 1.5 متر × 12₪ = 18₪
  assert.equal(lineAmount(333, 1000), 333);
  assert.equal(lineAmount(1999, 333), 666); // 0.333 كغ × 19.99 = 6.65667 → 6.66
  assert.equal(packToBase(2000, 24000), 48000); // 2 كرتونة × 24 = 48 قطعة
  assert.equal(baseToPack(36000, 24000), 1500); // 36 قطعة = 1.5 كرتونة
  assert.equal(perBaseUnitPrice(4800, 24000), 200); // كرتونة بـ 48₪ → 2₪ للقطعة
});

test('stock is the sum of movements, never a stored number', () => {
  const mv = [
    { id: '1', product_id: 'p', type: 'opening', qty: signedQty('opening', 10000), created_at: '2026-01-01T00:00:00Z' },
    { id: '2', product_id: 'p', type: 'sale', qty: signedQty('sale', 3000), created_at: '2026-01-02T00:00:00Z' },
    { id: '3', product_id: 'q', type: 'purchase', qty: signedQty('purchase', 5000), created_at: '2026-01-02T00:00:00Z' },
    { id: '4', product_id: 'p', type: 'adjustment', qty: signedQty('adjustment', -500), created_at: '2026-01-03T00:00:00Z' },
  ];
  const s = stockByProduct(mv);
  assert.equal(s.get('p'), 6500);
  assert.equal(s.get('q'), 5000);
  assert.equal(signedQty('sale', -3000), -3000);
  assert.equal(signedQty('purchase', -3000), 3000);
  assert.throws(() => signedQty('gift', 1));
});

test('weighted average cost', () => {
  const p = (id, type, qty, cost, day) => ({ id, product_id: 'p', type, qty: signedQty(type, qty), unit_cost: cost, created_at: `2026-01-0${day}T00:00:00Z` });
  // 10 قطع بـ 2₪ ثم 10 قطع بـ 3₪ → متوسط 2.50₪
  let r = foldProduct([p('a', 'purchase', 10000, 200, 1), p('b', 'purchase', 10000, 300, 2)]);
  assert.deepEqual(r, { qty: 20000, avgCost: 250 });
  // البيع لا يغيّر المتوسط
  r = foldProduct([p('a', 'purchase', 10000, 200, 1), p('c', 'sale', 5000, null, 2), p('b', 'purchase', 5000, 300, 3)]);
  assert.deepEqual(r, { qty: 10000, avgCost: 250 });
  // بيع قبل تسجيل الشراء (مخزون سالب) → التكلفة تكلفة الدفعة الجديدة
  r = foldProduct([p('c', 'sale', 2000, null, 1), p('b', 'purchase', 5000, 300, 2)]);
  assert.deepEqual(r, { qty: 3000, avgCost: 300 });
  // الترتيب ثابت مهما وصلت الحركات
  const a = foldProduct([p('b', 'purchase', 10000, 300, 2), p('a', 'purchase', 10000, 200, 1)]);
  assert.deepEqual(a, { qty: 20000, avgCost: 250 });
});

test('stock levels and value', () => {
  assert.equal(stockLevel(0, 5000), 'out');
  assert.equal(stockLevel(-1000, 5000), 'out');
  assert.equal(stockLevel(5000, 5000), 'low');
  assert.equal(stockLevel(6000, 5000), null);
  assert.equal(stockValue(2500, 400), 1000);
  assert.equal(stockValue(-2500, 400), 0);
});

test('invoice numbers are per device and offline-safe', () => {
  assert.equal(deviceLetter(0), 'A');
  assert.equal(deviceLetter(25), 'Z');
  assert.equal(deviceLetter(26), 'AA');
  assert.equal(formatInvoiceNumber('A', 'sale', 42), 'A-0042');
  assert.equal(formatInvoiceNumber('B', 'sale_return', 3), 'B-R0003');
  assert.equal(formatInvoiceNumber('A', 'purchase', 12345), 'A-P12345');
  assert.throws(() => formatInvoiceNumber('a', 'sale', 1));
  assert.throws(() => formatInvoiceNumber('A', 'sale', 0));
  assert.ok(matchesInvoiceNumber('A-0042', '42'));
  assert.ok(matchesInvoiceNumber('A-0042', 'a-42'));
  assert.ok(matchesInvoiceNumber('A-R0003', 'A-R3'));
  assert.ok(!matchesInvoiceNumber('A-R0003', 'A-3'));
  assert.ok(!matchesInvoiceNumber('A-0042', '4'));
});

test('shop type presets enable only relevant features', () => {
  const ph = presetFor('pharmacy');
  assert.equal(ph.expiry, true);
  assert.equal(ph.images, false);
  assert.equal(presetFor('clothing').units, false);
  assert.equal(presetFor('fabrics').units, true);
  assert.equal(presetFor('nonsense').units, presetFor('other').units);
  const r = resolveFeatures('pharmacy', { images: true, expiry: false, bogus: true });
  assert.equal(r.images, true);
  assert.equal(r.expiry, false);
  assert.equal('bogus' in r, false);
  for (const t of Object.values(SHOP_TYPES)) for (const f of t.on) assert.ok(FEATURES[f], f);
});

test('conflict rules: last write wins, appends never conflict', () => {
  const old = { id: 'x', name: 'a', updated_at: '2026-01-01T00:00:00.000Z' };
  const neu = { id: 'x', name: 'b', updated_at: '2026-01-02T00:00:00.000Z' };
  assert.equal(remoteWins(old, neu), true);
  assert.equal(remoteWins(neu, old), false);
  assert.equal(remoteWins(null, neu), true);
  // تعادل: النتيجة متطابقة من الجهتين (واحد فقط يفوز)
  const t1 = { ...old, name: 'c' };
  assert.notEqual(remoteWins(old, t1), remoteWins(t1, old));
  assert.equal(remoteWins(old, { ...old }), false);
  assert.equal(appendWins(null), true);
  assert.equal(appendWins({ id: 1 }), false);
});

test('clock never goes backwards', () => {
  let t = 1000;
  const clock = makeClock(() => t);
  const a = clock();
  t = 500; // المستخدم أرجع ساعة الجوال
  const b = clock();
  assert.ok(b > a);
});
