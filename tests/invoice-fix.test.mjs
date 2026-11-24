// تصحيح الفواتير بعد حفظها: المرتجع ينزل من دين الزبون، إلغاء الفاتورة، تعديلها برقمها، والاسم على فاتورة زبون عابر.
// (ملاحظات محل «مكتبة ومطبعة المبدع»: مرتجع من فاتورة آجلة لم ينزل من الحساب، ولا تعديل ولا حذف للفاتورة.)
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createProductRepo } from '../src/features/products/repo.js';
import { createSaleRepo } from '../src/features/sale/repo.js';
import { createCustomerRepo } from '../src/features/customers/repo.js';
import { createCashRepo } from '../src/features/cash/repo.js';
import { makeLine, makeCustomLine, refundSplit, creditLeft, cartFromInvoice, cartTotals, voidProblem } from '../src/domain/cart.js';
import { receiptModel, filterInvoices, invoiceName, replacedIds } from '../src/domain/invoice.js';
import { buildReport } from '../src/domain/reports.js';
import { applyOffers } from '../src/domain/offers.js';
import { makeClock } from '../src/domain/merge.js';
import { uuid } from '../src/core/ids.js';

let n = 0;
async function setup() {
  const db = createDb(Dexie, `fix-${++n}-${Date.now()}`);
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'C', userId: null };
  const clock = makeClock();
  const store = createStore({ db, clock, getContext: () => ctx });
  const deps = { db, store, getContext: () => ctx, clock };
  const products = createProductRepo(deps);
  const sales = createSaleRepo(deps);
  const customers = createCustomerRepo(deps);
  const cash = createCashRepo(deps);
  const cashM = await store.put('payment_methods', { name: 'نقدًا', kind: 'cash', sort: 0 });
  const bank = await store.put('payment_methods', { name: 'تحويل بنكي', kind: 'transfer', sort: 1 });
  const creditM = await store.put('payment_methods', { name: 'آجل', kind: 'credit', sort: 2 });
  const mk = async (name, sell, cost) => products.get((await products.save({ name, sell_price: sell, cost_price: cost }, { qty: 50000 })).product.id);
  const book = await mk('كراسة خط', 1100, 700);
  const pen = await mk('قلم', 400, 250);
  const qty = async (p) => (await db.stock.get(p.id)).qty;
  const report = async () => buildReport({
    invoices: await db.invoices.toArray(), lines: await db.invoice_lines.toArray(), payments: await db.payments.toArray(),
    products: await db.products.toArray(), methods: await db.payment_methods.toArray(), from: '2000-01-01', to: '2999-01-01',
  });
  return { db, ctx, sales, customers, cash, book, pen, qty, report, cashM, bank, creditM };
}
const credit = (amount) => [{ kind: 'credit', amount }];
const paid = (m, amount) => [{ method_id: m.id, kind: m.kind, amount }];

test('refund split: a credit invoice gives the money back the way it was paid — off the debt first', () => {
  assert.deepEqual(refundSplit(2200, 'auto', 4000), { credit: 2200, cash: 0 });
  assert.deepEqual(refundSplit(2200, 'auto', 1000), { credit: 1000, cash: 1200 });
  assert.deepEqual(refundSplit(2200, 'auto', 0), { credit: 0, cash: 2200 });
  assert.deepEqual(refundSplit(2200, 'cash', 4000), { credit: 0, cash: 2200 });
  assert.deepEqual(refundSplit(2200, 'credit', 0), { credit: 2200, cash: 0 });
  assert.equal(creditLeft({ total: 4000, paid: 1000 }, [{ total: 1500, paid: 500 }]), 2000);
  assert.equal(creditLeft({ total: 4000, paid: 4000 }, []), 0);
});

test('the reported case: return from a credit invoice comes off the customer account, not out of the drawer', async () => {
  const { db, sales, customers, cash, book, pen, qty } = await setup();
  const school = await customers.create({ name: 'مدرسة اوتاد الخاصة' });
  // C-0001: 40 شيكل آجل (كراستان + 4.5 قلم… هنا: كراستان 22 + قلم ونصف… نبسّطها: 2×11 + 4.5×4)
  const sale = await sales.checkout({ lines: [makeLine(book, { qty: 2000 }), makeLine(pen, { qty: 4500 })], customerId: school.id, payments: credit(4000) });
  assert.equal(await customers.balance(school.id), 4000);
  const ret = await sales.returnable(sale.invoice.id);
  assert.equal(ret.creditLeft, 4000, 'the whole invoice is still owed');
  // الافتراضي في الشاشة لفاتورة آجلة: auto
  const back = await sales.processReturn(sale.invoice.id, [{ line: ret.lines[0], qty: 2000 }], 'auto');
  assert.deepEqual([back.total, back.credit, back.cash], [2200, 2200, 0]);
  assert.equal(await customers.balance(school.id), 1800, 'debt went down by the returned goods');
  assert.equal((await cash.summary()).cashOut, 0, 'no cash left the drawer');
  assert.equal(await qty(book), 50000);
  assert.equal(back.invoice.paid, 0);
  const st = await customers.get(school.id);
  assert.deepEqual(st.entries.map((e) => [e.type, e.amount, e.balance]), [['return_credit', -2200, 1800], ['sale_credit', 4000, 4000]]);
  assert.equal((await sales.returnable(sale.invoice.id)).creditLeft, 1800);
  assert.equal((await db.payments.toArray()).filter((p) => p.direction === 'out').length, 0);
});

test('return from a part-paid invoice: the unpaid part off the debt, the rest back in cash', async () => {
  const { sales, customers, cash, book, cashM, creditM } = await setup();
  const c = await customers.create({ name: 'أبو خالد' });
  const sale = await sales.checkout({
    lines: [makeLine(book, { qty: 4000 })], customerId: c.id,
    payments: [{ method_id: cashM.id, kind: 'cash', amount: 3400 }, { method_id: creditM.id, kind: 'credit', amount: 1000 }],
  });
  assert.equal(await customers.balance(c.id), 1000);
  const ret = await sales.returnable(sale.invoice.id);
  assert.equal(ret.creditLeft, 1000);
  const back = await sales.processReturn(sale.invoice.id, [{ line: ret.lines[0], qty: 2000 }], 'auto');
  assert.deepEqual([back.credit, back.cash], [1000, 1200]);
  assert.equal(await customers.balance(c.id), 0);
  assert.equal((await cash.summary()).cashOut, 1200);
  // مرتجع ثانٍ: لم يبق دين من هذه الفاتورة ← نقدًا كله، ولا يصير للزبون رصيد دائن بالخطأ
  const again = await sales.returnable(sale.invoice.id);
  assert.equal(again.creditLeft, 0);
  const back2 = await sales.processReturn(sale.invoice.id, [{ line: again.lines[0], qty: 1000 }], 'auto');
  assert.deepEqual([back2.credit, back2.cash], [0, 1100]);
  assert.equal(await customers.balance(c.id), 0);
  // فاتورة بلا زبون: auto = نقدًا
  const walk = await sales.checkout({ lines: [makeLine(book)], payments: paid(cashM, 1100) });
  const r3 = await sales.processReturn(walk.invoice.id, [{ line: (await sales.returnable(walk.invoice.id)).lines[0], qty: 1000 }], 'auto');
  assert.deepEqual([r3.credit, r3.cash], [0, 1100]);
});

test('cancel a credit invoice: stock back, debt gone, out of the reports, kept as void', async () => {
  const { db, ctx, sales, customers, book, pen, qty, report } = await setup();
  const c = await customers.create({ name: 'مدرسة اوتاد الخاصة' });
  const sale = await sales.checkout({ lines: [makeLine(book, { qty: 2000 }), makeLine(pen, { qty: 3000 })], customerId: c.id, payments: credit(3400) });
  const pv = await sales.voidPreview(sale.invoice.id);
  assert.deepEqual([pv.problem, pv.refund, pv.credit], [null, 0, 3400]);
  ctx.userId = uuid(); // موظف يلغي: يُسجَّل اسمه
  const r = await sales.voidInvoice(sale.invoice.id);
  assert.deepEqual([r.refund, r.credit, r.invoice.status], [0, 3400, 'void']);
  assert.equal(await customers.balance(c.id), 0);
  assert.equal(await qty(book), 50000);
  assert.equal(await qty(pen), 50000);
  // كشف الزبون: القيد الأصلي يظهر «ملغى» ولا يدخل في الرصيد، والقيد العكسي مخفي
  const st = await customers.get(c.id);
  assert.deepEqual(st.entries.map((e) => [e.type, e.amount, e.cancelled, e.balance]), [['sale_credit', 3400, true, 0]]);
  assert.equal(st.raw.length, 0);
  // التقارير كأنها لم تكن
  const rep = await report();
  assert.equal(rep.salesTotal, 0);
  assert.equal(rep.profit, 0);
  // تبقى محفوظة ويُعرف من ألغاها
  const info = await sales.voidInfo(sale.invoice.id);
  assert.deepEqual([info.action, info.user_id, info.data.number], ['invoice_void', ctx.userId, 'C-0001']);
  assert.equal((await sales.recentSales()).length, 0, 'not offered for returns any more');
  await assert.rejects(sales.voidInvoice(sale.invoice.id), /ملغاة من قبل/);
  await assert.rejects(sales.processReturn(sale.invoice.id, [{ line: (await sales.invoice(sale.invoice.id)).lines[0], qty: 1000 }], 'auto'), /ملغاة/);
  // الرقم لا يُعاد استعماله
  const next = await sales.checkout({ lines: [makeLine(pen)], payments: [{ kind: 'cash', amount: 400 }] });
  assert.equal(next.invoice.number, 'C-0002');
});

test('cancel a paid invoice: the money leaves by the way it came in; mixed cash + transfer', async () => {
  const { db, sales, cash, book, qty, cashM, bank, report } = await setup();
  await cash.open(10000);
  const sale = await sales.checkout({
    lines: [makeLine(book, { qty: 3000 })],
    payments: [{ method_id: cashM.id, kind: 'cash', amount: 2000 }, { method_id: bank.id, kind: 'transfer', amount: 1300 }],
  });
  assert.equal((await cash.summary()).expectedCash, 12000);
  const pv = await sales.voidPreview(sale.invoice.id);
  assert.deepEqual([pv.refund, pv.credit], [3300, 0]);
  await sales.voidInvoice(sale.invoice.id);
  const s = await cash.summary();
  assert.equal(s.expectedCash, 10000, 'drawer back to where it was');
  assert.equal(s.methods.find((m) => m.key === bank.id).total, 0, 'transfer reversed by transfer');
  assert.equal(await qty(book), 50000);
  const outs = (await db.payments.toArray()).filter((p) => p.direction === 'out');
  assert.deepEqual(outs.map((p) => [p.method_kind, p.amount]).sort(), [['cash', 2000], ['transfer', 1300]]);
  assert.equal((await report()).salesTotal, 0);
});

test('an invoice with a return is not cancelled or edited — the rest goes through returns', async () => {
  const { sales, book, cashM } = await setup();
  const sale = await sales.checkout({ lines: [makeLine(book, { qty: 2000 })], payments: paid(cashM, 2200) });
  const ret = await sales.returnable(sale.invoice.id);
  const back = await sales.processReturn(sale.invoice.id, [{ line: ret.lines[0], qty: 1000 }], 'cash');
  assert.match((await sales.voidPreview(sale.invoice.id)).problem, /رُجعت بضاعة/);
  await assert.rejects(sales.voidInvoice(sale.invoice.id), /رُجعت بضاعة/);
  await assert.rejects(sales.checkout({ lines: [makeLine(book)], payments: paid(cashM, 1100), replaces: sale.invoice.id }), /رُجعت بضاعة/);
  // فاتورة المرتجع نفسها لا تُلغى من هنا
  assert.match((await sales.voidPreview(back.invoice.id)).problem, /لفواتير البيع فقط/);
  assert.equal(voidProblem(null), 'الفاتورة غير موجودة');
});

test('edit a credit invoice: same number and date, the customer owes the new total, one live invoice', async () => {
  const { db, sales, customers, book, pen, qty, report, creditM } = await setup();
  const c = await customers.create({ name: 'مدرسة اوتاد الخاصة' });
  const sale = await sales.checkout({ lines: [makeLine(book, { qty: 2000 }), makeLine(pen, { qty: 4500 })], customerId: c.id, payments: credit(4000) });
  assert.equal(sale.invoice.number, 'C-0001');
  // التعديل: تبديل الكراستين (22) بثلاثة أقلام (12) ← 30 بدل 40
  const { invoice, lines } = await sales.invoice(sale.invoice.id);
  const cart = cartFromInvoice(invoice, lines);
  assert.equal(cartTotals(cart.lines, cart.discount).total, 4000, 'the cart opens exactly as it was sold');
  const edited = [cart.lines[1], makeLine(pen, { qty: 3000 })];
  const r = await sales.checkout({ lines: edited, discount: cart.discount, customerId: c.id, payments: [{ method_id: creditM.id, kind: 'credit', amount: 3000 }], replaces: sale.invoice.id });
  assert.equal(r.invoice.number, 'C-0001', 'keeps its number');
  assert.equal(r.invoice.created_at, sale.invoice.created_at, 'keeps its date');
  assert.equal(r.invoice.original_invoice_id, sale.invoice.id);
  assert.equal(r.invoice.total, 3000);
  assert.equal((await db.invoices.get(sale.invoice.id)).status, 'void');
  assert.equal(await customers.balance(c.id), 3000, 'the customer owes the edited total');
  assert.equal(await qty(book), 50000, 'the swapped goods are back');
  assert.equal(await qty(pen), 50000 - 7500);
  // كشف الزبون: الأصلية ملغاة والمعدَّلة فوقها، بلا «مرتجع» ولا فاتورة ثانية
  const st = await customers.get(c.id);
  assert.deepEqual(st.entries.map((e) => [e.type, e.note, e.amount, e.cancelled]), [['sale_credit', 'C-0001', 3000, false], ['sale_credit', 'C-0001', 4000, true]]);
  // السجل: فاتورة واحدة قائمة، والأصلية في «الملغاة» بوسم «عُدّلت»
  const all = await db.invoices.toArray();
  assert.deepEqual(filterInvoices(all, {}).map((i) => i.id), [r.invoice.id]);
  assert.deepEqual(filterInvoices(all, { type: 'void' }).map((i) => i.id), [sale.invoice.id]);
  assert.ok(replacedIds(all).has(sale.invoice.id));
  assert.equal((await sales.voidInfo(sale.invoice.id)).action, 'invoice_edit');
  // التقارير: المعدَّلة فقط
  const rep = await report();
  assert.equal(rep.salesTotal, 3000);
  assert.equal(rep.best.find((x) => x.name === 'قلم').qty, 7500);
  assert.equal(rep.best.find((x) => x.name === 'كراسة خط'), undefined);
  // الرقم التالي لم يُستهلك بالتعديل
  assert.equal((await sales.checkout({ lines: [makeLine(pen)], payments: [{ kind: 'cash', amount: 400 }] })).invoice.number, 'C-0002');
  // المعدَّلة نفسها تُعدَّل وتُرجَع كأي فاتورة
  assert.equal((await sales.voidPreview(r.invoice.id)).problem, null);
  assert.equal((await sales.returnable(r.invoice.id)).creditLeft, 3000);
});

test('edit a cash invoice: the drawer moves by the difference only', async () => {
  const { ctx, sales, cash, book, pen, cashM, report } = await setup();
  await cash.open(0);
  const seller = uuid();
  ctx.userId = seller;
  const sale = await sales.checkout({ lines: [makeLine(book, { qty: 2000 })], payments: paid(cashM, 2200) });
  ctx.userId = uuid(); // المحاسب يعدّلها: تبقى باسم من باعها، واسمه هو في سجل العمليات
  assert.equal((await cash.summary()).expectedCash, 2200);
  // صارت كراسة واحدة + قلم = 15: ما دُفع سابقًا يُعاد تسجيله بقدر الإجمالي الجديد، والفرق (7) يخرج من الدرج
  const r = await sales.checkout({ lines: [makeLine(book, { qty: 1000 }), makeLine(pen)], payments: paid(cashM, 1500), replaces: sale.invoice.id });
  assert.equal(r.invoice.total, 1500);
  assert.equal(r.invoice.created_by, seller);
  assert.equal((await sales.voidInfo(sale.invoice.id)).user_id, ctx.userId);
  assert.equal((await cash.summary()).expectedCash, 1500);
  assert.equal((await report()).byMethod.find((m) => m.name === 'نقدًا').total, 1500);
  // ثم زادت إلى 26: يدفع الفرق
  const r2 = await sales.checkout({ lines: [makeLine(book, { qty: 2000 }), makeLine(pen)], payments: paid(cashM, 2600), replaces: r.invoice.id });
  assert.equal((await cash.summary()).expectedCash, 2600);
  assert.equal(r2.invoice.number, sale.invoice.number);
  await assert.rejects(sales.checkout({ lines: [makeLine(pen)], payments: paid(cashM, 400), replaces: sale.invoice.id }), /ملغاة من قبل/);
});

test('a failed edit changes nothing: the original stays as it was', async () => {
  const { db, sales, customers, book, qty } = await setup();
  const c = await customers.create({ name: 'أم علي' });
  const sale = await sales.checkout({ lines: [makeLine(book, { qty: 2000 })], customerId: c.id, payments: credit(2200) });
  await assert.rejects(sales.checkout({ lines: [makeLine(book)], customerId: c.id, payments: credit(100), replaces: sale.invoice.id }), /أقل من الإجمالي/);
  assert.equal((await db.invoices.get(sale.invoice.id)).status, 'final');
  assert.equal(await customers.balance(c.id), 2200);
  assert.equal(await qty(book), 48000);
  assert.equal(await db.audit_log.count(), 0);
});

test('edited lines keep the price they were sold at: offers and custom amounts are not re-priced', async () => {
  const { sales, book } = await setup();
  const sale = await sales.checkout({
    lines: [{ ...makeLine(book, { qty: 2000 }), unit_price: 1000 }, makeCustomLine({ name: 'طباعة ورق', amount: 500, key: 'k' })],
    discount: { type: 'amount', value: 300 }, payments: [{ kind: 'cash', amount: 2200 }],
  });
  const { invoice, lines } = await sales.invoice(sale.invoice.id);
  const cart = cartFromInvoice(invoice, lines);
  assert.deepEqual(cart.lines.map((l) => [l.name, l.qty, l.unit_price, l.product_id ? 'p' : null]), [['كراسة خط', 2000, 1000, 'p'], ['طباعة ورق', 1000, 500, null]]);
  assert.deepEqual(cart.discount, { type: 'amount', value: 300 });
  assert.equal(cartTotals(cart.lines, cart.discount).total, invoice.total);
  const offers = [{ id: 'o', type: 'percent', target: { kind: 'all' }, percent: 5000, active: true }];
  assert.equal(applyOffers(cart.lines, offers, { today: '2026-11-24' }).saved, 0);
});

test('a name on the invoice of a walk-in customer: shown, searchable, and gone when a customer is chosen', async () => {
  const { db, sales, customers, pen } = await setup();
  const r = await sales.checkout({ lines: [makeLine(pen)], payments: [{ kind: 'cash', amount: 400 }], note: '  أبو   يوسف  ' });
  assert.equal(r.invoice.note, 'أبو يوسف');
  assert.equal(invoiceName(r.invoice), 'أبو يوسف');
  const { invoice, lines } = await sales.invoice(r.invoice.id);
  assert.equal(receiptModel({ invoice, lines }).party, 'الاسم: أبو يوسف');
  const c = await customers.create({ name: 'سعيد' });
  const r2 = await sales.checkout({ lines: [makeLine(pen)], customerId: c.id, payments: [{ kind: 'cash', amount: 400 }] });
  await sales.checkout({ lines: [makeLine(pen)], payments: [{ kind: 'cash', amount: 400 }] });
  const all = await db.invoices.toArray();
  assert.deepEqual(filterInvoices(all, { query: 'ابو يوسف' }).map((i) => i.id), [r.invoice.id]);
  assert.deepEqual(filterInvoices(all, { query: 'سعيد' }, { customerNames: new Map([[c.id, 'سعيد']]) }).map((i) => i.id), [r2.invoice.id]);
  assert.equal(receiptModel({ invoice: r2.invoice, lines: [], customer: c }).party, 'الزبون: سعيد');
  // الملغاة تقول ذلك في عنوانها أينما طُبعت أو أُرسلت
  await sales.voidInvoice(r.invoice.id);
  const v = receiptModel({ invoice: await db.invoices.get(r.invoice.id), lines });
  assert.deepEqual([v.title, v.voided, v.foot], ['فاتورة بيع ملغاة', true, '']);
});

test('the receipt of a cancelled sale lists how it was paid, not the reversal', async () => {
  const { db, sales, book, cashM } = await setup();
  const sale = await sales.checkout({ lines: [makeLine(book)], payments: paid(cashM, 1100) });
  await sales.voidInvoice(sale.invoice.id);
  const payments = await db.payments.where('invoice_id').equals(sale.invoice.id).toArray();
  assert.equal(payments.length, 2);
  const m = receiptModel({ invoice: await db.invoices.get(sale.invoice.id), lines: [], payments, methodNames: new Map([[cashM.id, 'نقدًا']]) });
  assert.deepEqual(m.totals.map((t) => t.label), ['الإجمالي', 'نقدًا']);
});
