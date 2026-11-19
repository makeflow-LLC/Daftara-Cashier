import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createCustomerRepo } from '../src/features/customers/repo.js';
import { createCashRepo } from '../src/features/cash/repo.js';
import { createWalletRepo, WALLET_NOTE } from '../src/features/wallet/repo.js';
import { makeClock } from '../src/domain/merge.js';
import { uuid } from '../src/core/ids.js';
import { normalizeWalletNumber, walletAmount, ussdCode, telUri, shopWallets } from '../src/domain/wallet.js';

test('wallet number: any written form becomes 05XXXXXXXX', () => {
  for (const raw of ['0594989710', '+970594989710', '00970594989710', '970594989710', '594989710', '٠٥٩٤٩٨٩٧١٠', '+970 59-498 9710', ' 059 498 9710 ', '+9700594989710']) {
    assert.equal(normalizeWalletNumber(raw), '0594989710', raw);
  }
  for (const raw of ['', null, '059498971', '05949897100', '0694989710', '1234567890', 'abc', '972594989710x1']) {
    assert.equal(normalizeWalletNumber(raw), null, String(raw));
  }
});

test('amount: latin digits, at most two decimals, no trailing zeros, never zero', () => {
  assert.equal(walletAmount('10').text, '10');
  assert.equal(walletAmount('10.00').text, '10');
  assert.equal(walletAmount('10.5').text, '10.5');
  assert.equal(walletAmount('10.50').text, '10.5');
  assert.equal(walletAmount('١٠٫٢٥'.replace('٫', '.')).text, '10.25');
  assert.equal(walletAmount('0.05').text, '0.05');
  assert.equal(walletAmount('1250').text, '1250', 'no thousands separator');
  assert.equal(walletAmount('3.456').text, '3.46');
  for (const bad of ['', '0', '0.00', '-5', 'abc', null, undefined]) assert.equal(walletAmount(bad), null, String(bad));
});

test('USSD code and tel: link — # is written %23, * stays', () => {
  const jawwal = ussdCode('jawwal', '0594989710', '10');
  assert.equal(jawwal, '*268*1*0594989710*10#');
  assert.equal(telUri(jawwal), 'tel:*268*1*0594989710*10%23');
  const palpay = ussdCode('palpay', '+970594989710', '10');
  assert.equal(palpay, '*370*1*1*0594989710*10#');
  assert.equal(telUri(palpay), 'tel:*370*1*1*0594989710*10%23');
  assert.equal(telUri(ussdCode('jawwal', '594989710', '10.50')), 'tel:*268*1*0594989710*10.5%23');
  assert.equal(ussdCode('jawwal', '0594989710', '0'), null);
  assert.equal(ussdCode('jawwal', '123', '10'), null);
  assert.equal(ussdCode('other', '0594989710', '10'), null);
  assert.equal(telUri(null), null);
});

test('shop wallets: only the configured ones, in order', () => {
  assert.deepEqual(shopWallets({}), []);
  assert.deepEqual(shopWallets(null), []);
  assert.deepEqual(shopWallets({ wallets: { palpay: '0599111222', jawwal: null } }), [{ id: 'palpay', name: 'بال باي', number: '0599111222' }]);
  assert.deepEqual(shopWallets({ wallets: { palpay: '0599111222', jawwal: '0594989710' } }).map((w) => w.id), ['jawwal', 'palpay']);
});

// يرسم الرمز بالمكتبة المضمَّنة (vendor/qrcode.js) ثم يقرؤه بقارئ حقيقي (ZXing): النص المقروء يجب أن يطابق حرفيًا
async function roundTrip(text) {
  const { readBarcodes, prepareZXingModule } = await import('zxing-wasm/reader');
  const wasm = readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');
  prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) } });
  const qrcode = new Function(`${readFileSync('vendor/qrcode.js', 'utf8')}; return qrcode;`)();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount(), quiet = 4, scale = 4, size = (count + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.floor(y / scale) - quiet, c = Math.floor(x / scale) - quiet;
    if (r >= 0 && c >= 0 && r < count && c < count && qr.isDark(r, c)) { const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  }
  return (await readBarcodes({ data, width: size, height: size, colorSpace: 'srgb' }, { formats: ['QRCode'] }))[0];
}

test('QR: a real reader gets back exactly the tel: link, error correction M', async () => {
  for (const uri of ['tel:*268*1*0594989710*10%23', 'tel:*370*1*1*0594989710*10%23', 'tel:*268*1*0594989710*1250.75%23']) {
    const read = await roundTrip(uri);
    assert.equal(read.text, uri);
    assert.equal(read.ecLevel, 'M');
  }
  assert.equal(telUri(ussdCode('jawwal', '0594989710', '10')), 'tel:*268*1*0594989710*10%23');
});

let n = 0;
function setup() {
  const db = createDb(Dexie, `wallet-${++n}-${Date.now()}`);
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'A' };
  const store = createStore({ db, clock: makeClock(), getContext: () => ctx });
  const deps = { db, store, getContext: () => ctx };
  const customers = createCustomerRepo(deps);
  return { db, store, customers, cash: createCashRepo({ ...deps, clock: () => new Date().toISOString() }), wallet: createWalletRepo({ ...deps, customers }) };
}

test('receive: free receipt is a transfer under the wallet name, not drawer cash', async () => {
  const { db, wallet, cash } = setup();
  const p = await wallet.receive({ walletId: 'jawwal', amount: 1000 });
  assert.equal(p.method_kind, 'transfer');
  assert.equal(p.customer_id ?? null, null);
  assert.equal(p.note, WALLET_NOTE);
  await wallet.receive({ walletId: 'jawwal', amount: 550 });
  const methods = (await db.payment_methods.toArray()).filter((m) => m.name === 'جوال باي');
  assert.equal(methods.length, 1, 'the wallet payment method is created once');
  const s = await cash.summary();
  assert.equal(s.expectedCash, 0);
  assert.deepEqual(s.methods.map((m) => [m.name, m.total]), [['جوال باي', 1550]]);
  await assert.rejects(wallet.receive({ walletId: 'jawwal', amount: 0 }), (e) => !!e.errors.amount);
});

test('receive: with a customer the payment lowers their debt', async () => {
  const { customers, wallet, cash } = setup();
  const c = await customers.create({ name: 'أبو أحمد' });
  await customers.addDebt(c.id, 5000);
  await wallet.receive({ walletId: 'palpay', amount: 2000, customerId: c.id });
  assert.equal(await customers.balance(c.id), 3000);
  const s = await cash.summary();
  assert.equal(s.expectedCash, 0, 'wallet money never enters the drawer');
  assert.deepEqual(s.methods.map((m) => [m.name, m.total]), [['محفظة بال باي', 2000]]);
});

test('receive: reuses the shop\'s ready-made wallet method instead of adding a duplicate', async () => {
  const { KNOWN_WALLETS } = await import('../src/domain/features.js');
  const { db, store, wallet } = setup();
  for (const name of KNOWN_WALLETS) await store.put('payment_methods', { name, kind: 'transfer', fee_bp: 0, active: true, sort: 5 });
  const before = await db.payment_methods.count();
  const a = await wallet.receive({ walletId: 'palpay', amount: 500 });
  const b = await wallet.receive({ walletId: 'jawwal', amount: 700 });
  assert.equal(await db.payment_methods.count(), before, 'no new payment method');
  const names = new Map((await db.payment_methods.toArray()).map((m) => [m.id, m.name]));
  assert.equal(names.get(a.method_id), 'محفظة بال باي');
  assert.equal(names.get(b.method_id), 'جوال باي');
});
