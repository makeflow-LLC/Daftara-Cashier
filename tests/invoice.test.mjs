import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptModel, invoiceText, filterInvoices, pdfFromJpeg, dateTimeText } from '../src/domain/invoice.js';

const inv = { id: 'i1', number: 'A-0007', type: 'sale', currency: 'ILS', subtotal: 3100, discount: 310, total: 2790, paid: 1790, created_at: '2026-11-13T07:12:00.000Z', customer_id: 'c1' };
const lines = [{ name: 'حليب نيدو', qty: 1000, unit_price: 2500, discount: 0, total: 2500 }, { name: 'خبز', qty: 2000, unit_price: 300, discount: 0, total: 600 }];
const data = { invoice: inv, lines, payments: [{ method_kind: 'cash', method_id: 'm1', amount: 1790 }, { method_kind: 'credit', amount: 1000 }], methodNames: new Map([['m1', 'نقدًا']]), customer: { name: 'أبو خالد' }, shop: { name: 'بقالة النور', phone: '0599123456' } };

test('receipt model has no cost or profit and uses western digits', () => {
  const m = receiptModel(data);
  assert.equal(m.title, 'فاتورة بيع');
  assert.equal(m.party, 'الزبون: أبو خالد');
  assert.deepEqual(m.rows[1], { name: 'خبز', calc: '2 × 3.00', total: '6.00 ₪' });
  assert.deepEqual(m.totals.map((t) => [t.label, t.value]), [['المجموع', '31.00 ₪'], ['الخصم', '-3.10 ₪'], ['الإجمالي', '27.90 ₪'], ['نقدًا', '17.90 ₪'], ['آجل (على الحساب)', '10.00 ₪']]);
  const text = JSON.stringify(m);
  assert.ok(!/cost|profit|ربح|تكلفة/.test(text));
  assert.ok(!/[٠-٩]/.test(text));
  assert.match(dateTimeText('2026-11-13T07:12:00.000Z'), /^\d{2}\/\d{2}\/2026 \d{2}:\d{2}$/);
  const p = receiptModel({ invoice: { ...inv, type: 'purchase', discount: 0, paid: 0, customer_id: null }, lines, supplier: { name: 'أبو سامي' } });
  assert.equal(p.party, 'المورّد: أبو سامي');
  assert.equal(p.foot, '');
  assert.deepEqual(p.totals.map((t) => t.label), ['الإجمالي', 'على الحساب']);
});

test('invoice text for WhatsApp', () => {
  const t = invoiceText(receiptModel(data));
  assert.ok(t.startsWith('*بقالة النور*'));
  assert.ok(t.includes('فاتورة بيع A-0007') && t.includes('حليب نيدو') && t.includes('*الإجمالي: 27.90 ₪*') && t.endsWith('شكرًا لتعاملكم معنا'));
});

test('invoice history search: number, customer, product, type and date', () => {
  const list = [
    inv,
    { id: 'i2', number: 'A-R0001', type: 'sale_return', created_at: '2026-11-12T10:00:00.000Z' },
    { id: 'i3', number: 'A-P0001', type: 'purchase', supplier_id: 's1', created_at: '2026-11-01T10:00:00.000Z' },
    { id: 'i4', number: 'A-0008', type: 'sale', created_at: '2026-11-13T09:00:00.000Z', deleted: true },
  ];
  const extra = { customerNames: new Map([['c1', 'أبو خالد']]), supplierNames: new Map([['s1', 'أبو سامي']]), productHits: new Set(['i3']) };
  assert.deepEqual(filterInvoices(list).map((i) => i.id), ['i1', 'i2', 'i3']);
  assert.deepEqual(filterInvoices(list, { query: '7' }).map((i) => i.id), ['i1']);
  assert.deepEqual(filterInvoices(list, { query: 'ابو خالد' }, { ...extra, productHits: new Set() }).map((i) => i.id), ['i1']);
  assert.deepEqual(filterInvoices(list, { query: 'سكر' }, extra).map((i) => i.id), ['i3']);
  assert.deepEqual(filterInvoices(list, { type: 'sale_return' }).map((i) => i.id), ['i2']);
  assert.deepEqual(filterInvoices(list, { from: '2026-11-12T00:00:00.000Z' }).map((i) => i.id), ['i1', 'i2']);
});

test('PDF wraps a JPEG with valid structure and offsets', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = pdfFromJpeg(jpeg, 720, 1000);
  const s = Buffer.from(pdf).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.ok(s.includes('/MediaBox [0 0 360 500]') && s.includes('/Filter /DCTDecode /Length 7'));
  const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const off4 = Number(s.slice(xref).split('\n')[6].slice(0, 10));
  assert.equal(s.slice(off4, off4 + 7), '4 0 obj');
});
