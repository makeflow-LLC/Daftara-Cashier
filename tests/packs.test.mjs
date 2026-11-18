import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainPack, splitByPack, packQtyText } from '../src/domain/units.js';

const carton = { id: 'c', name: 'كرتونة', factor: 24000, sell_price: 8000 };
const box = { id: 'b', name: 'علبة', factor: 6000, sell_price: null };

test('main pack: the one priced by the merchant, else the biggest', () => {
  assert.equal(mainPack([box, carton]).id, 'c');
  assert.equal(mainPack([box, { ...carton, sell_price: null }]).id, 'c', 'biggest');
  assert.equal(mainPack([{ ...carton, deleted: true }]), null);
  assert.equal(mainPack([]), null);
});

test('nescafe: 1 carton of 24, sold 2 pieces -> 22 pieces, not "0.9 carton"', () => {
  assert.deepEqual(splitByPack(22000, 24000), { packs: 0, rest: 22000 });
  assert.deepEqual(splitByPack(46000, 24000), { packs: 1, rest: 22000 });
  assert.deepEqual(splitByPack(48000, 24000), { packs: 2, rest: 0 });
  assert.equal(packQtyText(22000, carton), '22 قطعة');
  assert.equal(packQtyText(46000, carton), '1 كرتونة و22 قطعة');
  assert.equal(packQtyText(72000, carton), '3 كرتونة');
  assert.equal(packQtyText(0, carton), '0 قطعة');
  assert.equal(packQtyText(-2000, carton), '-2 قطعة');
  assert.equal(packQtyText(5000, null), '5 قطعة');
});
