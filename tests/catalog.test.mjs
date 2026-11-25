// كتالوج المحل للزبائن: كل صنف يُطلب بوحدته (قطعة، كيلو، أوقية…)، ورسالة الطلب، وعنوان الصورة.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextQty, validQty, qtyText, unitBadge, priceUnit, chosenItems, itemText, orderText, imageUrl, MAX_ORDER_QTY } from '../src/domain/catalog.js';
import { unit, UNITS } from '../src/domain/units.js';
import { scaleQuantity } from '../src/domain/scale.js';
import { formatMoney } from '../src/domain/currency.js';

const money = (v) => formatMoney(v, 'ILS');

test('the ounce is a weighed unit of 250 grams', () => {
  assert.equal(unit('ounce').name, 'أوقية');
  assert.equal(unit('ounce').measured, true);
  assert.equal(UNITS.ounce.grams, 250);
  assert.equal(unit('whatever').id, 'piece'); // نسخة أقدم تستلم وحدة لا تعرفها
});

test('scale label weight becomes ounces for a product priced by the ounce', () => {
  assert.deepEqual(scaleQuantity({ unit: 'ounce', sell_price: 500 }, { mode: 'weight', value: 250 }), { qty: 1000, discount: 0 });
  assert.deepEqual(scaleQuantity({ unit: 'ounce', sell_price: 500 }, { mode: 'weight', value: 375 }), { qty: 1500, discount: 0 });
  assert.deepEqual(scaleQuantity({ unit: 'kg', sell_price: 2000 }, { mode: 'weight', value: 375 }), { qty: 375, discount: 0 });
});

test('pieces count 1, 2, 3; kilos go by quarters; ounces by halves; grams by fifties', () => {
  assert.equal(nextQty('piece', 0, 1), 1000);
  assert.equal(nextQty('piece', 1000, 1), 2000);
  assert.equal(nextQty('piece', 1000, -1), 0);
  assert.equal(nextQty('kg', 0, 1), 1000);
  assert.equal(nextQty('kg', 1000, -1), 750);
  assert.equal(nextQty('kg', 250, -1), 0);
  assert.equal(nextQty('kg', 1000, 1), 1250);
  assert.equal(nextQty('ounce', 0, 1), 1000);
  assert.equal(nextQty('ounce', 1000, -1), 500);
  assert.equal(nextQty('ounce', 500, -1), 0);
  assert.equal(nextQty('gram', 0, 1), 100000);
  assert.equal(nextQty('gram', 100000, -1), 50000);
  assert.equal(nextQty('piece', MAX_ORDER_QTY, 1), MAX_ORDER_QTY);
});

test('quantities read the way people say them', () => {
  assert.equal(qtyText('piece', 3000), '3');
  assert.equal(qtyText('kg', 1500), '1.5 كيلو');
  assert.equal(qtyText('kg', 250), 'ربع كيلو');
  assert.equal(qtyText('ounce', 500), 'نصف أوقية');
  assert.equal(qtyText('ounce', 2000), '2 أوقية');
  assert.equal(qtyText('gram', 150000), '150 غرام');
  assert.equal(unitBadge('ounce'), 'بالأوقية');
  assert.equal(unitBadge('kg'), 'بالكيلو');
  assert.equal(unitBadge('piece'), null);
  assert.equal(priceUnit('ounce'), 'أوقية');
  assert.equal(priceUnit('piece'), null);
});

const products = [
  { id: 'a', name: 'زيت', price: 1800, unit: 'piece', available: true },
  { id: 'b', name: 'زعتر', price: 500, unit: 'ounce', available: true },
  { id: 'c', name: 'بندورة', price: 400, unit: 'kg', available: true },
  { id: 'd', name: 'نافد', price: 100, unit: 'piece', available: false },
];

test('the order: each line in its own unit, totals from price × quantity', () => {
  // سلة قديمة (عدد صحيح صغير) أو كمية لا تناسب الوحدة تُهمل
  const items = chosenItems(products, { a: 2000, b: 1500, c: 750, d: 1000, x: 1000, e: 2 });
  assert.deepEqual(items.map((x) => [x.p.id, x.qty, x.total]), [['a', 2000, 3600], ['b', 1500, 750], ['c', 750, 300]]);
  assert.equal(validQty('piece', 2), false);
  assert.equal(validQty('piece', 1500), false);
  assert.equal(itemText(products[0], 2000), 'زيت × 2');
  assert.equal(itemText(products[1], 500), 'زعتر — نصف أوقية');
  const text = orderText({ shopName: 'بقالة أبو أحمد', items, name: 'سامي', note: 'توصيل', money });
  assert.deepEqual(text.split('\n'), [
    'مرحبًا بقالة أبو أحمد، أريد أن أطلب:',
    `1. زيت × 2 = ${money(3600)}`,
    `2. زعتر — 1.5 أوقية = ${money(750)}`,
    `3. بندورة — 0.75 كيلو = ${money(300)}`,
    `المجموع: ${money(4650)}`,
    'الاسم: سامي',
    'ملاحظة: توصيل',
    '(من كتالوج المحل)',
  ]);
});

test('product image: thumbnail in the grid, full on tap, nothing for odd paths', () => {
  const path = '11111111-1111-1111-1111-111111111111/products/22222222-2222-2222-2222-222222222222.webp';
  const base = 'https://db.example';
  assert.equal(imageUrl(base, path), `${base}/storage/v1/object/authenticated/cashier-media/${path.replace('.webp', '_t.webp')}`);
  assert.equal(imageUrl(base, path, { full: true }), `${base}/storage/v1/object/authenticated/cashier-media/${path}`);
  assert.equal(imageUrl(base, null), null);
  assert.equal(imageUrl(base, '../secret/logo.webp'), null);
  assert.equal(imageUrl('', path), null);
});
