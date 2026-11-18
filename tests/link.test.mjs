import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkPlan } from '../src/domain/link.js';
import { foldProduct } from '../src/domain/stock.js';

const id = (() => { let n = 0; return () => `u${++n}`; })();
// بسكوت ديمة: أدخله التاجر كرتونة بـ 12.00 تكلفتها 9.60 وعنده 1 (الصورة)، ثم سُجّلت الحبة صنفًا بـ 0.50
const carton = { id: 'c', name: 'بسكوت ديمة', barcode: '6251111000001', unit: 'piece', sell_price: 1200, cost_price: 960 };
const piece = { id: 'p', name: 'بسكوت ديمة', barcode: '6251111000099', unit: 'piece', sell_price: 50, cost_price: 0 };

test('carton entered as a product + scanned piece barcode -> one product sold by piece, carton is its pack', () => {
  const r = linkPlan({ carton, cartonStock: { qty: 1000, avgCost: 960 }, pieceBarcode: '6251111000099', count: 24000, piecePrice: 50, makeId: id });
  assert.equal(r.product.barcode, '6251111000099', 'piece barcode on the product');
  assert.equal(r.product.sell_price, 50);
  assert.equal(r.product.cost_price, 40, '9.60 / 24');
  assert.deepEqual([r.pack.name, r.pack.factor, r.pack.barcode, r.pack.sell_price], ['كرتونة', 24000, '6251111000001', 1200], 'carton barcode and price move to the pack');
  // المخزون: 1 كرتونة ← 24 حبة بتكلفة الحبة
  const s = foldProduct(r.movements.map((m, i) => ({ ...m, id: String(i), created_at: `2026-11-16T10:00:0${i}Z` })), { qty: 1000, avgCost: 960 });
  assert.deepEqual(s, { qty: 24000, avgCost: 40 });
  assert.equal(r.preview.qty, 24000);
  assert.equal(r.removeId, null);
});

test('merge the duplicate piece product: its stock moves over (even negative) and it is removed', () => {
  // باع 3 حبات من الصنف المكرر بلا مخزون (−3)
  const r = linkPlan({ carton, cartonStock: { qty: 1000, avgCost: 960 }, piece, pieceStock: { qty: -3000, avgCost: 0 }, count: 24000, piecePrice: null, makeId: id });
  assert.equal(r.product.barcode, piece.barcode);
  assert.equal(r.product.sell_price, 50, 'default piece price = 12.00 / 24');
  assert.equal(r.removeId, 'p');
  const forC = r.movements.filter((m) => m.product_id === 'c').map((m, i) => ({ ...m, id: String(i), created_at: `2026-11-16T10:00:0${i}Z` }));
  assert.deepEqual(foldProduct(forC, { qty: 1000, avgCost: 960 }), { qty: 21000, avgCost: 40 });
  const forP = r.movements.filter((m) => m.product_id === 'p');
  assert.deepEqual(forP.map((m) => m.qty), [3000], 'duplicate zeroed');
  assert.equal(r.preview.qty, 21000);
});

test('product already entered by carton (stock in pieces): only the barcodes move', () => {
  const nes = { id: 'n', name: 'نسكافيه', barcode: '7613036000001', unit: 'piece', sell_price: 333, cost_price: 250 };
  const pack = { id: 'k', product_id: 'n', name: 'كرتونة', factor: 24000, barcode: null, sell_price: 8000 };
  const r = linkPlan({ carton: nes, cartonPack: pack, cartonStock: { qty: 22000, avgCost: 250 }, pieceBarcode: '7613036000099', count: 24000, makeId: id });
  assert.equal(r.product.barcode, '7613036000099');
  assert.equal(r.pack.barcode, '7613036000001', 'the scanned-at-purchase barcode was the carton');
  assert.equal(r.pack.id, 'k');
  assert.deepEqual(r.movements, [], 'stock untouched');
  assert.equal(r.product.sell_price, 333);
});

test('refuses nonsense', () => {
  assert.throws(() => linkPlan({ carton, count: 1000, makeId: id }), /2 أو أكثر/);
  assert.throws(() => linkPlan({ carton, count: 1500, makeId: id }), /2 أو أكثر/);
  assert.throws(() => linkPlan({ carton, piece: carton, count: 24000, makeId: id }), /مختلفين/);
  assert.throws(() => linkPlan({ carton: { ...carton, unit: 'kg' }, count: 24000, makeId: id }), /بالقطعة/);
  assert.throws(() => linkPlan({ carton, count: 24000, piecePrice: -1, makeId: id }), /سعر الحبة/);
  const neg = linkPlan({ carton, cartonStock: { qty: -2000, avgCost: 0 }, count: 12000, makeId: id });
  const s = foldProduct(neg.movements.map((m, i) => ({ ...m, id: String(i), created_at: `2026-11-16T10:00:0${i}Z` })), { qty: -2000, avgCost: 0 });
  assert.equal(s.qty, -24000, 'sold 2 cartons without stock -> -24 pieces');
});

// ===== على قاعدة الجهاز: الربط في معاملة واحدة كما في الصورة
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { makeClock } from '../src/domain/merge.js';
import { createProductRepo } from '../src/features/products/repo.js';

async function setup() {
  const db = createDb(Dexie, `link-${Date.now()}-${Math.random()}`);
  await db.open();
  const ctx = { shopId: 's1', deviceId: 'd1', prefix: 'A', userId: null };
  const store = createStore({ db, clock: makeClock(), getContext: () => ctx });
  return { db, repo: createProductRepo({ db, store, getContext: () => ctx }) };
}

test('the biscuit case on the device: two products become one, sales by piece and by carton both work', async () => {
  const { db, repo } = await setup();
  const c = (await repo.save({ name: 'بسكوت ديمة', barcode: '6251111000001', sell_price: 1200, cost_price: 960 }, { qty: 1000 })).product;
  const p = (await repo.save({ name: 'بسكوت ديمة', barcode: '6251111000099', sell_price: 50, cost_price: 0 }, { qty: 0 })).product;
  await repo.linkPiece({ cartonId: c.id, pieceId: p.id, count: 24000, piecePrice: 50 });
  const list = await repo.list();
  assert.equal(list.length, 1, 'one product left');
  assert.equal(list[0].qty, 24000);
  assert.equal(list[0].sell_price, 50);
  assert.equal(list[0].pack.factor, 24000);
  const piece = await repo.findByCode('6251111000099');
  assert.equal(piece.product.id, c.id);
  assert.equal(piece.pack, null, 'piece barcode sells one piece');
  const box = await repo.findByCode('6251111000001');
  assert.equal(box.product.id, c.id);
  assert.equal(box.pack.factor, 24000, 'carton barcode sells a carton');
  assert.equal((await db.stock.get(c.id)).avgCost, 40);
  assert.equal((await db.products.get(p.id)).deleted, true);
});

test('carton for an existing piece product (scanned at purchase)', async () => {
  const { repo } = await setup();
  const p = (await repo.save({ name: 'شيبس', barcode: '6290000000017', sell_price: 100, cost_price: 70 }, { qty: 5000 })).product;
  await repo.addPack(p.id, { barcode: '6290000000024', count: 12000, sellPrice: 1100 });
  const hit = await repo.findByCode('6290000000024');
  assert.equal(hit.product.id, p.id);
  assert.equal(hit.pack.factor, 12000);
  assert.equal((await repo.list())[0].qty, 5000, 'stock unchanged');
  await assert.rejects(repo.addPack(p.id, { barcode: '6290000000017', count: 12000 }), /الحبة نفسها/);
});
