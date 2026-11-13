import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createProductRepo } from '../src/features/products/repo.js';
import { createMediaSync, thumbPathOf } from '../src/sync/media.js';
import { fitWithin, imagePath } from '../src/core/media.js';
import { makeClock } from '../src/domain/merge.js';
import { uuid } from '../src/core/ids.js';
import {
  normalizeBarcode, checkDigit, isValidEan, internalBarcode, isInternalBarcode, isShareableBarcode,
  normalizeArabic, matchScore, searchProducts, validateProduct, marginBp, validatePack,
} from '../src/domain/product.js';

let n = 0;
function setup() {
  const db = createDb(Dexie, `prod-${++n}-${Date.now()}`);
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'A' };
  const store = createStore({ db, clock: makeClock(), getContext: () => ctx });
  return { db, ctx, store, repo: createProductRepo({ db, store, getContext: () => ctx }) };
}

test('barcodes: normalize, EAN check digit, internal codes', () => {
  assert.equal(normalizeBarcode(' ٦٢٢ 1234 '), '6221234');
  assert.equal(checkDigit('400638133393'), 1);
  assert.ok(isValidEan('4006381333931'));
  assert.ok(!isValidEan('4006381333932'));
  assert.ok(isValidEan('96385074'));
  const a = internalBarcode('A', 1);
  const b = internalBarcode('B', 1);
  assert.equal(a.length, 13);
  assert.ok(isValidEan(a) && isInternalBarcode(a));
  assert.notEqual(a, b, 'two devices never collide');
  assert.notEqual(internalBarcode('A', 1), internalBarcode('A', 2));
  assert.ok(!isShareableBarcode(a), 'internal codes are never shared');
  assert.ok(isShareableBarcode('4006381333931'));
  assert.ok(!isShareableBarcode('ABC-12'));
});

test('arabic search ignores hamza, taa marbuta, diacritics and word order', () => {
  assert.equal(normalizeArabic('أَرُزّ مِصريّة'), 'ارز مصريه');
  const items = [
    { name: 'أرز مصري 1 كغ', barcode: '6221000000001' },
    { name: 'زيت ذرة', barcode: null },
    { name: 'معكرونة', barcode: '7290000000017' },
  ];
  assert.equal(searchProducts(items, 'ارز')[0].name, 'أرز مصري 1 كغ');
  assert.equal(searchProducts(items, 'مصري ارز').length, 1);
  assert.equal(searchProducts(items, 'معكرونه').length, 1);
  assert.equal(searchProducts(items, '72900')[0].name, 'معكرونة');
  assert.equal(searchProducts(items, 'شاي').length, 0);
  assert.equal(searchProducts(items, '').length, 3);
  assert.ok(matchScore('زيت', items[1]) > matchScore('ذرة', items[1]), 'prefix ranks higher');
});

test('product validation and margin', () => {
  assert.equal(validateProduct({ name: '', sell_price: 100, cost_price: 0 }).errors.name, 'اكتب اسم الصنف');
  assert.ok(validateProduct({ name: 'x', sell_price: -1, cost_price: 0 }).errors.sell_price);
  const w = validateProduct({ name: 'x', sell_price: 90, cost_price: 100 });
  assert.ok(w.ok);
  assert.equal(w.warnings.length, 1);
  assert.equal(marginBp(750, 1000), 2500);
  assert.equal(marginBp(0, 1000), null);
  assert.equal(validatePack({ name: 'كرتونة', factor: 1000 }), 'عدد القطع في العبوة يجب أن يكون أكثر من 1');
  assert.equal(validatePack({ name: 'كرتونة', factor: 24000 }), null);
});

test('save: new product with opening stock, packs and catalog queue', async () => {
  const { db, repo } = setup();
  const { product } = await repo.save(
    { name: 'حليب نيدو', barcode: '6291003000017', sell_price: 2500, cost_price: 2000 },
    { qty: 12000, packs: [{ name: 'كرتونة', factor: 12000, barcode: '16291003000014', sell_price: 28000 }] },
  );
  const got = await repo.get(product.id);
  assert.equal(got.qty, 12000);
  assert.equal(got.units.length, 1);
  assert.equal((await db.movements.toArray())[0].type, 'opening');
  assert.equal((await repo.findByCode('16291003000014')).pack.name, 'كرتونة');
  assert.equal((await repo.findByCode('6291003000017')).product.name, 'حليب نيدو');
  assert.equal(await repo.findByCode('000'), null);
  const q = (await db.meta.get('catalogQueue')).value;
  assert.deepEqual(q, [{ barcode: '6291003000017', name: 'حليب نيدو' }]);
});

test('save: edit adjusts stock by movement, logs price history, removes packs', async () => {
  const { db, repo } = setup();
  const { product } = await repo.save({ name: 'سكر', sell_price: 500, cost_price: 400 }, { qty: 10000, packs: [{ name: 'شوال', factor: 50000 }] });
  await repo.save({ ...product, sell_price: 550 }, { qty: 7000, packs: [] });
  const got = await repo.get(product.id);
  assert.equal(got.qty, 7000);
  assert.equal(got.sell_price, 550);
  assert.equal(got.units.length, 0);
  const mv = await db.movements.toArray();
  assert.deepEqual(mv.map((m) => [m.type, m.qty]).sort(), [['adjustment', -3000], ['opening', 10000]]);
  const ph = await db.price_history.toArray();
  assert.equal(ph.length, 1);
  assert.equal(ph[0].old_sell, 500);
  assert.equal(ph[0].new_sell, 550);
  // نفس الكمية: لا حركة جديدة
  await repo.save({ ...(await db.products.get(product.id)), name: 'سكر أبيض' }, { qty: 7000 });
  assert.equal(await db.movements.count(), 2);
  // internal barcodes are not shared to the catalog
  assert.equal(await db.meta.get('catalogQueue'), undefined);
});

test('save: rejects duplicate barcode and invalid data with Arabic messages', async () => {
  const { repo } = setup();
  await repo.save({ name: 'شاي', barcode: '4006381333931', sell_price: 100, cost_price: 0 });
  await assert.rejects(repo.save({ name: 'قهوة', barcode: '4006381333931', sell_price: 100, cost_price: 0 }),
    (e) => /مسجّل لـ «شاي»/.test(e.errors.barcode));
  await assert.rejects(repo.save({ name: '', sell_price: 100, cost_price: 0 }), (e) => !!e.errors.name);
});

test('delete is undoable, internal barcodes are unique, categories', async () => {
  const { repo } = setup();
  const { product } = await repo.save({ name: 'خبز', sell_price: 300, cost_price: 0 });
  await repo.remove(product.id);
  assert.equal((await repo.list()).length, 0);
  await repo.restore(product.id);
  assert.equal((await repo.list()).length, 1);
  const c1 = await repo.nextInternalBarcode();
  const c2 = await repo.nextInternalBarcode();
  assert.notEqual(c1, c2);
  assert.ok(isInternalBarcode(c1));
  const cat = await repo.addCategory('ألبان');
  assert.equal((await repo.addCategory('ألبان')).id, cat.id, 'no duplicate category');
  await repo.addCategory('معلبات');
  assert.deepEqual((await repo.categories()).map((c) => c.name), ['ألبان', 'معلبات']);
  await repo.removeCategory(cat.id);
  assert.equal((await repo.categories()).length, 1);
});

test('images: sizes, paths, upload queue and catalog flush', async () => {
  assert.deepEqual(fitWithin(4000, 3000, 800), { w: 800, h: 600 });
  assert.deepEqual(fitWithin(600, 1200, 800), { w: 400, h: 800 });
  assert.deepEqual(fitWithin(300, 200, 800), { w: 300, h: 200 });
  assert.equal(imagePath('s', 'i'), 's/products/i.webp');
  assert.equal(thumbPathOf('s/products/i.webp'), 's/products/i_t.webp');

  const { db } = setup();
  const uploads = [];
  const rpcs = [];
  let offline = true;
  const { HttpError } = await import('../src/sync/supabase.js');
  const api = {
    storage: {
      async upload(bucket, path, blob) { if (offline) throw new HttpError(0, 'offline', path); uploads.push([bucket, path, blob.size]); },
      async download(bucket, path) { if (path.includes('missing')) throw new HttpError(404, 'nf', path); return new Blob(['thumb']); },
    },
    rest: { async rpc(fn, args) { rpcs.push([fn, args]); return [{ barcode: '1', name: 'سكر السلطان' }]; } },
  };
  const ms = createMediaSync({ db, api });
  await db.files.put({ id: 'img1', kind: 'product', path: 's/products/img1.webp', blob: new Blob(['x'.repeat(50)]), thumb: new Blob(['t']), state: 'pending' });
  await db.meta.put({ key: 'catalogQueue', value: [{ barcode: '6291003000017', name: 'حليب' }] });
  let r = await ms.run();
  assert.ok(r.error, 'offline: nothing lost');
  assert.equal((await db.files.get('img1')).state, 'pending');
  offline = false;
  r = await ms.run();
  assert.equal(r.uploaded, 1);
  assert.deepEqual(uploads.map((u) => u[1]), ['s/products/img1.webp', 's/products/img1_t.webp']);
  assert.equal(r.catalog, 1);
  assert.equal(rpcs[0][0], 'cashier_catalog_contribute');
  assert.deepEqual((await db.meta.get('catalogQueue')).value, []);
  // تنزيل المصغّرة لصورة من جهاز آخر
  assert.equal(await ms.fetch({ id: 'img2', path: 's/products/img2.webp' }), true);
  assert.ok((await db.files.get('img2')).thumb);
  assert.equal(await ms.fetch({ id: 'img3', path: 's/products/missing.webp' }), false);
  assert.equal(await ms.lookup('1'), 'سكر السلطان');
});
