import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { inflateRaw, unzip, readXlsx, parseCsv, readTable } from '../src/domain/files.js';
import { guessMapping, hasHeaderRow, rowsToProducts, bulkPrice, eanModules, labelPages, makeBackup, validateBackup } from '../src/domain/tools.js';
import { pdfFromJpegs } from '../src/domain/invoice.js';

// يبني zip مضغوطًا (كما يحفظه Excel) من ملفات نصية
function zipDeflated(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text), data = deflateRawSync(raw), nm = enc.encode(name);
    const common = [...u16(20), ...u16(0x0800), ...u16(8), ...u16(0), ...u16(0x21), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nm.length), ...u16(0)];
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, ...common]);
    parts.push(local, nm, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nm);
    offset += local.length + nm.length + data.length;
  }
  const cd = central.reduce((n, p) => n + p.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(Object.keys(files).length), ...u16(Object.keys(files).length), ...u32(cd), ...u32(offset), ...u16(0)]);
  return Buffer.concat([...parts, ...central, end]);
}

test('inflate matches zlib on text, repeats and random data', () => {
  const samples = [Buffer.from('حليب نيدو 400 غرام,25.5,6291003000017\n'.repeat(400)), Buffer.from('a'), Buffer.alloc(70000, 7),
    Buffer.from(Array.from({ length: 30000 }, (_, i) => (i * 7919 + (i >> 3)) & 255))];
  for (const s of samples) for (const level of [1, 6, 9]) {
    assert.deepEqual(Buffer.from(inflateRaw(new Uint8Array(deflateRawSync(s, { level })))), s);
  }
  assert.throws(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff])));
});

test('xlsx: compressed (Excel-style) and our own stored files, shared and inline strings', () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>ملاحظة</t></is></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>25.5</v></c></row><row r="3"></row></sheetData></worksheet>';
  const strings = '<sst><si><t>الاسم</t></si><si><t>السعر</t></si><si><r><t>حليب </t></r><r><t>&amp; عسل</t></r></si></sst>';
  const buf = new Uint8Array(zipDeflated({ 'xl/sharedStrings.xml': strings, 'xl/worksheets/sheet1.xml': sheet, 'xl/workbook.xml': '<x/>' }));
  assert.deepEqual(readXlsx(buf), [['الاسم', 'السعر', '', 'ملاحظة'], ['حليب & عسل', '25.5']]);
  assert.ok(unzip(buf).has('xl/workbook.xml'));
  // ملف يبنيه vendor/xlsx.js (غير مضغوط) يُقرأ أيضًا
  const ctx = { TextEncoder, Uint8Array, Uint32Array };
  ctx.self = ctx; ctx.window = ctx;
  vm.runInNewContext(readFileSync('vendor/xlsx.js', 'utf8'), ctx);
  const ours = ctx.Xlsx.build([{ name: 'أصناف', cols: [20, 10], rows: [['الاسم', 'السعر'], ['سكر', 5]] }]);
  assert.deepEqual(readTable(new Uint8Array(ours), 'a.xlsx'), [['الاسم', 'السعر'], ['سكر', '5']]);
});

test('csv: quotes, delimiters, BOM', () => {
  assert.deepEqual(parseCsv('﻿name;price\n"سكر; ناعم";5,5\r\n\r\n"قال ""نعم""";3'), [['name', 'price'], ['سكر; ناعم', '5,5'], ['قال "نعم"', '3']]);
  assert.deepEqual(readTable(new TextEncoder().encode('a,b\n1,2'), 'x.csv'), [['a', 'b'], ['1', '2']]);
  assert.throws(() => readTable(new Uint8Array([0xd0, 0xcf, 1, 2, 3]), 'old.xls'), /xlsx/);
});

test('import: column guessing and row conversion', () => {
  const rows = [['الباركود', 'اسم الصنف', 'سعر الشراء', 'سعر البيع', 'الكمية', 'القسم'],
    ['6291003000017', 'حليب نيدو', '20', '25.5', '12', 'ألبان'], ['', 'خبز', '', '٣', '', ''], ['x', '', '1', '2', '', ''], ['6291003000017', 'مكرر', '1', '2', '', ''], ['', 'بلا سعر', '', 'abc', '', '']];
  assert.ok(hasHeaderRow(rows));
  assert.ok(!hasHeaderRow(rows.slice(1)));
  const map = guessMapping(rows[0]);
  assert.deepEqual(map, { barcode: 0, cost_price: 2, qty: 4, category: 5, name: 1, sell_price: 3 });
  const { items, skipped } = rowsToProducts(rows.slice(1), map);
  assert.deepEqual(items, [
    { name: 'حليب نيدو', barcode: '6291003000017', sell_price: 2550, cost_price: 2000, qty: 12000, category: 'ألبان' },
    { name: 'خبز', barcode: null, sell_price: 300, cost_price: 0, qty: 0, category: null }]);
  assert.equal(skipped.length, 3);
  assert.deepEqual(guessMapping(['Item', 'Price']), { barcode: -1, cost_price: -1, qty: -1, category: -1, name: 0, sell_price: 1 });
});

test('bulk price: percent, amount, rounding, only changed rows', () => {
  const ps = [{ id: 'a', name: 'a', sell_price: 1000 }, { id: 'b', name: 'b', sell_price: 335 }, { id: 'c', name: 'c', sell_price: 0 }];
  assert.deepEqual(bulkPrice(ps, { mode: 'percent', value: 1000 }).map((x) => x.next), [1100, 369]);
  assert.deepEqual(bulkPrice(ps, { mode: 'percent', value: 1000, roundTo: 50 }).map((x) => x.next), [1100, 350]);
  assert.deepEqual(bulkPrice(ps, { mode: 'amount', value: -500 }).map((x) => [x.id, x.next]), [['a', 500], ['b', 0]]);
  assert.deepEqual(bulkPrice(ps, { mode: 'amount', value: 0 }), []);
});

test('EAN barcodes decode back to their digits', () => {
  const m = eanModules('4006381333931');
  assert.equal(m.length, 95);
  assert.ok(m.startsWith('101') && m.endsWith('101') && m.slice(45, 50) === '01010');
  // فك الجزء الأيمن (R) والتحقق من الأرقام
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const inv = (s) => s.replace(/[01]/g, (b) => (b === '0' ? '1' : '0'));
  const right = m.slice(50, 92).match(/.{7}/g).map((s) => L.indexOf(inv(s))).join('');
  assert.equal(right, '333931');
  // أول رقم 4 → نمط LGLLGG: الخانة الأولى L والثانية G
  assert.equal(L.indexOf(m.slice(3, 10)), 0);
  assert.equal(L.indexOf(inv(m.slice(10, 17).split('').reverse().join(''))), 0);
  assert.equal(eanModules('96385074').length, 67);
  assert.equal(eanModules('4006381333932'), null);
  assert.equal(eanModules('ABC-123'), null);
  assert.deepEqual(labelPages([{ n: 1, copies: 30 }, { n: 2, copies: 2 }]).map((p) => p.length), [24, 8]);
});

test('multi-page PDF and backup validation', () => {
  const j = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const s = Buffer.from(pdfFromJpegs([{ jpeg: j, width: 1240, height: 1754 }, { jpeg: j, width: 1240, height: 1754 }])).toString('latin1');
  assert.ok(s.includes('/Count 2') && s.includes('/Kids [3 0 R 6 0 R]') && s.includes('0 9\n'));
  const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
  const offs = s.slice(xref).split('\n').slice(3, 11).map((l) => Number(l.slice(0, 10)));
  offs.forEach((o, i) => assert.equal(s.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));

  const b = makeBackup({ tables: { shops: [{ id: 's1', name: 'بقالة' }], products: [{ id: 'p1' }] }, meta: { shopId: 's1' }, exportedAt: 'now' });
  assert.deepEqual(validateBackup(b, ['shops', 'products', 'customers']), { shopName: 'بقالة', counts: { shops: 1, products: 1, customers: 0 }, exportedAt: 'now' });
  assert.throws(() => validateBackup({ app: 'daftara' }, []), /ليس ملف نسخة/);
  assert.throws(() => validateBackup({ ...b, version: 99 }, ['shops']), /أحدث/);
  assert.throws(() => validateBackup({ ...b, tables: { shops: [{ name: 'x' }] } }, ['shops']), /تالف/);
});
