// باركود الميزان: القراءة، الكمية من الوزن أو السعر، والبحث برقم الصنف في الميزان.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createProductRepo } from '../src/features/products/repo.js';
import { makeClock } from '../src/domain/merge.js';
import { uuid } from '../src/core/ids.js';
import { checkDigit, internalBarcode } from '../src/domain/product.js';
import { lineAmount } from '../src/domain/units.js';
import {
  parsePrefixes, parseScaleBarcode, scaleQuantity, scaleSettings, normalizeScaleCode, sampleScaleBarcode,
} from '../src/domain/scale.js';

const ean = (body12) => body12 + checkDigit(body12);
const ON = { enabled: true };

test('prefixes: lists, ranges, Arabic digits, bad input', () => {
  assert.deepEqual(parsePrefixes('20-23'), ['20', '21', '22', '23']);
  assert.deepEqual(parsePrefixes('21, 2'), ['21', '2']);
  assert.deepEqual(parsePrefixes('٢١،٢٢'), ['21', '22']);
  assert.equal(parsePrefixes('2a'), null);
  assert.equal(parsePrefixes('29-20'), null);
  assert.equal(parsePrefixes(''), null);
});

test('settings: defaults and clamping', () => {
  const s = scaleSettings(null);
  assert.equal(s.enabled, false);
  assert.equal(s.codeLength, 5);
  assert.equal(s.mode, 'weight');
  assert.equal(scaleSettings({ codeLength: 9, mode: 'x' }).codeLength, 5);
  assert.equal(scaleSettings({ mode: 'price' }).mode, 'price');
});

test('parse: 2X CCCCC VVVVV K weight label', () => {
  const b = ean('210012300750'); // الصنف 123، 750 غرام
  assert.deepEqual(parseScaleBarcode(b, ON), { code: '123', value: 750, mode: 'weight' });
  assert.equal(parseScaleBarcode(b, { enabled: false }), null, 'off by default');
  assert.equal(parseScaleBarcode(b.slice(0, 12) + ((Number(b[12]) + 1) % 10), ON), null, 'bad check digit');
  assert.equal(parseScaleBarcode(ean('620012300750'), ON), null, 'not a scale prefix');
  assert.equal(parseScaleBarcode(ean('210012300000'), ON), null, 'zero weight');
  assert.equal(parseScaleBarcode('21001230075', ON), null, 'too short');
});

test('parse: other layouts (4- and 6-digit codes, one-digit prefix, price)', () => {
  assert.deepEqual(parseScaleBarcode(ean('220012301250'), { enabled: true, codeLength: 4, prefixes: '220' }),
    { code: '123', value: 1250, mode: 'weight' });
  assert.deepEqual(parseScaleBarcode(ean('200012301250'), { enabled: true, codeLength: 6, prefixes: '2', mode: 'price' }),
    { code: '123', value: 1250, mode: 'price' });
  assert.equal(normalizeScaleCode('000123'), '123');
  assert.equal(normalizeScaleCode('1234567'), null);
});

test('quantity: weight in kg and grams, price rounds to the printed total', () => {
  const kg = { unit: 'kg', sell_price: 2000 }; // 20 ₪ للكيلو
  assert.deepEqual(scaleQuantity(kg, { mode: 'weight', value: 750 }), { qty: 750, discount: 0 });
  assert.deepEqual(scaleQuantity({ unit: 'gram', sell_price: 3 }, { mode: 'weight', value: 250 }), { qty: 250000, discount: 0 });
  for (const value of [1250, 1, 999, 3333, 77]) {
    const q = scaleQuantity({ unit: 'kg', sell_price: 1799 }, { mode: 'price', value });
    assert.equal(lineAmount(1799, q.qty) - q.discount, value, `total equals label for ${value}`);
    assert.ok(q.discount >= 0 && q.discount <= 2);
  }
  assert.equal(scaleQuantity({ unit: 'kg', sell_price: 0 }, { mode: 'price', value: 500 }), null);
});

test('sample barcode parses back', () => {
  for (const cfg of [{ enabled: true }, { enabled: true, mode: 'price' }, { enabled: true, codeLength: 4, prefixes: '220' }, { enabled: true, codeLength: 6, prefixes: '2' }]) {
    const b = sampleScaleBarcode(cfg);
    const p = parseScaleBarcode(b, cfg);
    assert.equal(p.code, '123');
    assert.equal(p.value, cfg.mode === 'price' ? 1250 : 750);
  }
});

function setup() {
  const db = createDb(Dexie, `scale-${Date.now()}-${Math.random()}`);
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'A' };
  const store = createStore({ db, clock: makeClock(), getContext: () => ctx });
  return { db, repo: createProductRepo({ db, store, getContext: () => ctx }) };
}

test('repo: scale code saved normalized, unique, and resolved from a label', async () => {
  const { repo } = setup();
  const { product } = await repo.save({ name: 'بندورة', unit: 'kg', sell_price: 400, cost_price: 0, scale_code: '00123' });
  assert.equal(product.scale_code, '123');
  await assert.rejects(repo.save({ name: 'خيار', unit: 'kg', sell_price: 300, cost_price: 0, scale_code: '123' }), (e) => !!e.errors.scale_code);
  await assert.rejects(repo.save({ name: 'خيار', unit: 'kg', sell_price: 300, cost_price: 0, scale_code: '12a' }), (e) => !!e.errors.scale_code);

  const hit = await repo.resolveScan(ean('210012301500'), ON); // 1.5 كيلو
  assert.equal(hit.product.id, product.id);
  assert.equal(hit.qty, 1500);
  assert.equal(hit.discount, 0);

  const unknown = await repo.resolveScan(ean('210099901500'), ON);
  assert.equal(unknown.product, null);
  assert.equal(unknown.scale.code, '999');

  assert.equal(await repo.resolveScan(ean('210012301500'), { enabled: false }), null, 'off: an unknown barcode');
});

test('repo: an exact product barcode wins over the scale reading', async () => {
  const { repo } = setup();
  const code = internalBarcode('A', 5); // يبدأ بـ 2 مثل ملصقات الميزان
  const { product } = await repo.save({ name: 'كيس', sell_price: 50, cost_price: 0, barcode: code });
  const hit = await repo.resolveScan(code, { enabled: true, prefixes: '20-29' });
  assert.equal(hit.product.id, product.id);
  assert.equal(hit.scale, undefined);
});
