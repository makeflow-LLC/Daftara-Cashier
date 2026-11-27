// المحاسبة: الدفاتر تُشتق من عمل المحل اليومي ويجب أن تتوازن دائمًا وتطابق ما تعرضه باقي الشاشات:
// حساب الزبائن = كشوفهم، حساب التجار = كشوفهم، الدرج = شاشة الصندوق، البضاعة = قيمة المخزون.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { createProductRepo } from '../src/features/products/repo.js';
import { createSaleRepo } from '../src/features/sale/repo.js';
import { createCustomerRepo } from '../src/features/customers/repo.js';
import { createInventoryRepo } from '../src/features/inventory/repo.js';
import { createCashRepo } from '../src/features/cash/repo.js';
import { createExpenseRepo } from '../src/features/expenses/repo.js';
import { createAccountingRepo } from '../src/features/accounting/repo.js';
import { makeLine } from '../src/domain/cart.js';
import { purchaseLine } from '../src/domain/inventory.js';
import { makeClock } from '../src/domain/merge.js';
import { stockValue } from '../src/domain/stock.js';
import {
  makeChart, buildJournal, trialBalance, accountLedger, incomeStatement, balanceSheet, balances, position, moneyAccounts,
  simulateDrawer, journalProblem, journalTotals, voucherProblem, voucherDoc, boxProblem, accountProblem, shopBoxes, customAccounts,
  contraChoices, DRAWER,
} from '../src/domain/accounting.js';
import {
  chequeProblem, chequeEntries, chequeActions, chequesDue, chequesSummary, chequeTotals, filterCheques, chequeLabel, chequeReminderText,
} from '../src/domain/cheques.js';
import { formatInvoiceNumber, matchesInvoiceNumber } from '../src/domain/numbering.js';
import { sessionSummary } from '../src/domain/cash.js';
import { buildReport } from '../src/domain/reports.js';
import { uuid } from '../src/core/ids.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { HttpError } from '../src/sync/supabase.js';
import { TABLE, SYNCED } from '../src/sync/tables.js';
import { createFakeServer } from './helpers/fake-server.mjs';
import { validateBackup, makeBackup } from '../src/domain/tools.js';
import { resolveFeatures, presetFor } from '../src/domain/features.js';
import { SIDE } from '../src/domain/nav.js';

let n = 0;
async function setup() {
  const db = createDb(Dexie, `acc-${++n}-${Date.now()}`);
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'A' };
  const clock = makeClock();
  const store = createStore({ db, clock, getContext: () => ctx });
  const deps = { db, store, getContext: () => ctx, clock };
  const settings = {};
  const getSettings = () => settings;
  const saveSettings = async (patch) => { Object.assign(settings, patch); };
  const cashMethod = await store.put('payment_methods', { name: 'نقدًا', kind: 'cash', sort: 0 });
  const bank = await store.put('payment_methods', { name: 'تحويل بنكي', kind: 'transfer', sort: 1 });
  const wallet = await store.put('payment_methods', { name: 'جوال باي', kind: 'transfer', fee_bp: 150, sort: 2 });
  const inventory = createInventoryRepo(deps);
  const customers = createCustomerRepo(deps);
  const t = {
    db, store, clock, cashMethod, bank, wallet, settings, inventory, customers,
    products: createProductRepo(deps), sales: createSaleRepo(deps),
    cash: createCashRepo({ ...deps, getSettings }), expenses: createExpenseRepo(deps),
    accounting: createAccountingRepo({ ...deps, getSettings, saveSettings, inventory, customers }),
  };
  return t;
}
const sellCash = async (t, product, qty = 1000) => {
  const s = await t.db.stock.get(product.id);
  const line = makeLine(product, { qty, avgCost: s ? s.avgCost : null });
  return t.sales.checkout({ lines: [line], payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: Math.round((line.unit_price * qty) / 1000) }] });
};
const bal = (b, key) => balances(b.entries).get(key) || 0;
/** كل قيد متوازن، والميزان متوازن، والميزانية متوازنة. */
function assertBalanced(b) {
  for (const e of b.entries) {
    const d = e.lines.reduce((a, l) => a + l.debit, 0), c = e.lines.reduce((a, l) => a + l.credit, 0);
    assert.equal(d, c, `entry ${e.id} (${e.memo}) is not balanced`);
    assert.ok(e.lines.every((l) => l.debit >= 0 && l.credit >= 0 && (l.debit === 0 || l.credit === 0)), e.id);
  }
  const tb = trialBalance(b.entries, b.chart);
  assert.ok(tb.balanced, 'trial balance');
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.ok(balanceSheet(b.entries, b.chart).balanced, 'balance sheet');
  return tb;
}

// ---------- دليل الحسابات ----------
test('chart: fixed accounts, one account per transfer method and box, expense categories, custom accounts', () => {
  const chart = makeChart({
    methods: [{ id: 'c', kind: 'cash', name: 'نقدًا', sort: 0 }, { id: 'b', kind: 'transfer', name: 'بنك', sort: 1 }, { id: 'w', kind: 'transfer', name: 'جوال باي', sort: 2 }, { id: 'cr', kind: 'credit', name: 'آجل', sort: 3 }],
    boxes: shopBoxes({ boxes: [{ id: 'x1', name: ' الخزنة ', kind: 'cash', opening: 500 }, { id: 'x2', name: 'بنك فلسطين', kind: 'bank' }, { id: '', name: 'بلا رقم' }] }),
    accounts: customAccounts([{ id: 'a1', name: 'قرض من أخي', type: 'liability' }, { id: 'a2', name: 'أثاث', type: 'asset' }, { id: 'a3', name: 'x', type: 'nope' }]),
    expenseCategories: ['نظافة'],
  });
  assert.equal(chart.info('drawer').code, '1101');
  assert.equal(chart.info('method:b').name, 'بنك');
  assert.equal(chart.info('method:b').type, 'asset');
  assert.equal(chart.info('box:x1').name, 'الخزنة');
  assert.equal(chart.info('exp:rent').name, 'مصاريف: إيجار');
  assert.equal(chart.info('exp:نظافة').type, 'expense');
  assert.equal(chart.info('acc:a1').type, 'liability');
  assert.ok(!chart.has('acc:a3'));
  // طريقة الدفع النقدية والدرج حساب واحد، والآجل ليس صندوقًا
  assert.equal(chart.money('c'), DRAWER);
  assert.equal(chart.money('drawer'), DRAWER);
  assert.equal(chart.money('b'), 'method:b');
  assert.equal(chart.money('x2'), 'box:x2');
  assert.equal(chart.money(null), 'bank_other');
  assert.ok(!chart.has('method:cr') && !chart.has('method:c'));
  // مفتاح غير معروف (بند قديم، طريقة محذوفة) لا يكسر الدفاتر
  assert.equal(chart.info('exp:ضيافة').name, 'مصاريف: ضيافة');
  assert.equal(chart.info('method:gone').type, 'asset');
  const codes = chart.all().map((a) => a.code);
  assert.deepEqual(codes, [...codes].sort());
  assert.equal(new Set(chart.all().map((a) => a.key)).size, chart.all().length);
});

test('boxes and custom accounts: validation', () => {
  assert.equal(boxProblem({ name: '  ' }), 'اكتب اسم الصندوق');
  assert.equal(boxProblem({ name: 'خزنة', opening: 1.5 }), 'الرصيد غير صحيح');
  assert.equal(boxProblem({ name: 'خزنة' }, [{ id: '1', name: 'خزنة', active: true }]), 'يوجد صندوق بهذا الاسم');
  assert.equal(boxProblem({ name: 'خزنة' }, [{ id: '1', name: 'خزنة', active: true }], '1'), null);
  assert.equal(accountProblem({ name: 'قرض', type: 'liability' }), null);
  assert.equal(accountProblem({ name: 'قرض', type: 'x' }), 'اختر نوع الحساب');
  assert.equal(accountProblem({ name: 'قرض', type: 'asset' }, [{ name: 'قرض' }]), 'يوجد حساب بهذا الاسم');
  assert.ok(contraChoices('payment', [{ id: 'a', name: 'أثاث', type: 'asset' }]).some((c) => c.key === 'acc:a'));
  assert.equal(contraChoices('receipt')[0].key, 'owner');
});

// ---------- الدرج ----------
test('drawer: without a session each day starts from zero; a session starts from its opening cash and closes on the count', () => {
  const at = (d, h) => new Date(2026, 10, d, h).toISOString();
  // يومان بلا وردية: نقد الأمس عند صاحب المحل
  let r = simulateDrawer({ flows: [{ at: at(1, 10), delta: 500 }, { at: at(2, 9), delta: 200 }], now: at(2, 12) });
  assert.equal(r.balance, 200);
  assert.deepEqual(r.steps.map((s) => [s.kind, s.before]), [['day', 500]]);
  // وردية: افتتاحي 100، بيع 300، إغلاق على 380 (عجز 20)، ثم بيع بعد الإغلاق
  r = simulateDrawer({
    flows: [{ at: at(3, 8), delta: 50 }, { at: at(3, 10), delta: 300 }, { at: at(3, 22), delta: 40 }],
    sessions: [{ id: 's', opened_at: at(3, 9), opening_cash: 100, closed_at: at(3, 21), counted: { cash: 380 } }],
    now: at(3, 23),
  });
  assert.equal(r.balance, 40);
  assert.deepEqual(r.steps.map((s) => s.kind), ['open', 'close']);
  assert.deepEqual([r.steps[0].before, r.steps[0].opening], [50, 100]);
  assert.deepEqual([r.steps[1].before, r.steps[1].counted], [400, 380]);
  // وردية تبقى مفتوحة بعد منتصف الليل: لا تصفير
  r = simulateDrawer({ flows: [{ at: at(4, 23), delta: 70 }, { at: at(5, 1), delta: 30 }], sessions: [{ id: 's', opened_at: at(4, 20), opening_cash: 0 }], now: at(5, 2) });
  assert.equal(r.balance, 100);
  assert.equal(r.steps.length, 0);
});

// ---------- الدفاتر من عمل المحل ----------
test('books: a full trading story balances and agrees with every other screen', async () => {
  const t = await setup();
  const { product: sugar } = await t.products.save({ name: 'سكر', sell_price: 800, cost_price: 500 });
  const { product: rice } = await t.products.save({ name: 'أرز', sell_price: 1200, cost_price: 900 });
  // بضاعة أول المدة بتعديل الكمية، وشراء نقدًا وعلى الحساب
  await t.products.save({ ...sugar }, { qty: 10000 });
  const supplier = await t.inventory.saveSupplier({ name: 'أبو خالد', opening: 30000 });
  await t.inventory.savePurchase({ lines: [purchaseLine(rice, { qty: 20000, unitCost: 900 })], supplierId: supplier.id, paid: 'credit' });
  await t.inventory.savePurchase({ lines: [purchaseLine(sugar, { qty: 5000, unitCost: 600 })], paid: 'cash' });
  // بيع نقدًا، بيع بتحويل برسوم، بيع آجل، مرتجع، وإلغاء فاتورة
  await sellCash(t, sugar, 2000);
  const riceLine = makeLine(rice, { qty: 3000, avgCost: (await t.db.stock.get(rice.id)).avgCost });
  await t.sales.checkout({ lines: [riceLine], payments: [{ kind: 'transfer', method_id: t.wallet.id, amount: 3600, fee_bp: 150 }] });
  const customer = await t.customers.create({ name: 'أم أحمد' });
  const creditSale = await t.sales.checkout({
    lines: [makeLine(rice, { qty: 2000, avgCost: 900 })], customerId: customer.id,
    payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 400 }, { kind: 'credit', amount: 2000 }],
  });
  const ret = await t.sales.returnable(creditSale.invoice.id);
  await t.sales.processReturn(creditSale.invoice.id, [{ line: ret.rows[0].line, qty: 1000 }], 'auto');
  const mistake = await sellCash(t, sugar, 1000);
  await t.sales.voidInvoice(mistake.invoice.id);
  // ديون يدوية ودفعات، مصاريف من الدرج ومن الجيب ومن البنك، وتالف
  await t.customers.addDebt(customer.id, 1500, 'خضار');
  await t.customers.recordPayment(customer.id, 700, t.cashMethod);
  await t.inventory.paySupplier(supplier.id, 10000, { method: t.bank });
  await t.expenses.save({ category: 'electricity', amount: 300, method: t.cashMethod });
  await t.expenses.save({ category: 'rent', amount: 5000, method: null });
  await t.expenses.save({ category: 'internet', amount: 120, method: t.bank });
  await t.inventory.damage(sugar.id, 1000);

  const b = await t.accounting.books();
  assertBalanced(b);
  // لا شيء بلا مقابل
  assert.equal(bal(b, 'suspense'), 0);
  // الزبائن والتجار كما في كشوفهم
  assert.equal(bal(b, 'ar'), (await t.customers.get(customer.id)).balance);
  assert.equal(-bal(b, 'ap'), (await t.inventory.supplier(supplier.id)).balance);
  // الدرج كما في شاشة الصندوق
  assert.equal(bal(b, DRAWER), (await t.cash.summary()).expectedCash);
  // البضاعة بقيمتها الحالية
  const stock = (await t.inventory.productsWithStock()).reduce((a, p) => a + stockValue(p.qty, p.avg_cost), 0);
  assert.equal(bal(b, 'inventory'), stock);
  // البنك والمحفظة: ما دخل ناقص الرسوم وما خرج
  assert.equal(bal(b, `method:${t.wallet.id}`), 3600 - 54);
  assert.equal(bal(b, 'fees'), 54);
  assert.equal(bal(b, `method:${t.bank.id}`), -10000 - 120);
  // المصروف «من خارج الصندوق» دفعه صاحب المحل من جيبه
  assert.equal(bal(b, 'exp:rent'), 5000);
  assert.ok(bal(b, 'owner') <= -5000);
  // الفاتورة الملغاة لا تترك أثرًا في المبيعات ولا في الدرج
  const voidEntry = b.entries.find((e) => e.kind === 'void');
  assert.ok(voidEntry && voidEntry.memo.includes(mistake.invoice.number));
  // قائمة الدخل = تقرير الأرباح (المبيعات − التكلفة − الرسوم − المصاريف − التالف)، والدين اليدوي مبيعات
  const inc = incomeStatement(b.entries, b.chart);
  const data = {
    invoices: await t.db.invoices.toArray(), lines: await t.db.invoice_lines.toArray(), payments: await t.db.payments.toArray(),
    products: await t.db.products.toArray(), categories: [], methods: await t.db.payment_methods.toArray(),
    expenses: await t.db.expenses.toArray(), movements: await t.db.movements.toArray(),
    from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z',
  };
  const report = buildReport(data);
  const reval = bal(b, 'stock_diff');
  assert.equal(inc.net, report.netProfit + 1500 - reval);
  assert.equal(inc.totalIncome - inc.totalExpenses, inc.net);
  // الميزانية: الأصول = الالتزامات + حقوق الملكية، وصافي ما يملكه المحل
  const bs = balanceSheet(b.entries, b.chart);
  assert.equal(bs.totals.assets, bs.totals.liabilities + bs.totals.equity);
  const pos = position(b.entries, b.chart);
  assert.equal(pos.net, bs.totals.assets - bs.totals.liabilities);
  assert.equal(pos.receivables, bal(b, 'ar'));
  assert.equal(pos.payables, (await t.inventory.supplier(supplier.id)).balance);
  // دفتر الأستاذ لحساب الزبائن: رصيده الأخير = رصيد الحساب، والرصيد الجاري متسلسل
  const led = accountLedger(b.entries, 'ar');
  assert.equal(led.closing, bal(b, 'ar'));
  assert.equal(led.rows[led.rows.length - 1].balance, led.closing);
  assert.equal(led.debit - led.credit, led.closing);
  // دفعة التاجر لها سند صرف برقم
  const pay = (await t.db.payments.toArray()).find((p) => p.supplier_id === supplier.id && !p.invoice_id);
  assert.equal(pay.number, 'A-S0001');
});

test('books: a period trial balance carries the earlier balance forward', async () => {
  const chart = makeChart({ methods: [{ id: 'c', kind: 'cash', name: 'نقدًا' }] });
  const entries = buildJournal({
    vouchers: [
      { id: 'v1', type: 'receipt', status: 'final', amount: 1000, account: 'x', contra: 'owner', voucher_at: '2026-01-10T10:00:00.000Z', created_at: '2026-01-10T10:00:00.000Z' },
      { id: 'v2', type: 'payment', status: 'final', amount: 300, account: 'x', contra: 'other_expense', voucher_at: '2026-02-05T10:00:00.000Z', created_at: '2026-02-05T10:00:00.000Z' },
      { id: 'v3', type: 'payment', status: 'void', amount: 999, account: 'x', contra: 'other_expense', voucher_at: '2026-02-06T10:00:00.000Z', created_at: '2026-02-06T10:00:00.000Z' },
    ],
    boxes: [{ id: 'x', name: 'الخزنة', kind: 'cash', opening: 0 }],
  }, makeChart({ boxes: [{ id: 'x', name: 'الخزنة', kind: 'cash' }] }));
  assert.equal(entries.length, 2); // الملغى لا يدخل
  const c2 = makeChart({ boxes: [{ id: 'x', name: 'الخزنة', kind: 'cash' }] });
  const feb = trialBalance(entries, c2, { from: '2026-02-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
  const box = feb.rows.find((r) => r.key === 'box:x');
  assert.deepEqual([box.opening, box.debit, box.credit, box.closing], [1000, 0, 300, 700]);
  assert.ok(feb.balanced);
  assert.equal(incomeStatement(entries, c2, { from: '2026-02-01T00:00:00.000Z' }).net, -300);
  assert.equal(accountLedger(entries, 'box:x', { from: '2026-02-01T00:00:00.000Z' }).opening, 1000);
  assert.ok(chart.has('drawer'));
});

// ---------- الصناديق والسندات ----------
test('boxes and vouchers: a safe, transfers from the drawer, drawings, deposits, and voiding', async () => {
  const t = await setup();
  const { product } = await t.products.save({ name: 'سكر', sell_price: 1000, cost_price: 600 });
  await t.products.save({ ...product }, { qty: 50000 });
  await sellCash(t, product, 5000); // 5000 في الدرج
  const safe = await t.accounting.saveBox({ name: 'الخزنة', kind: 'cash', opening: 20000 });
  await assert.rejects(t.accounting.saveBox({ name: 'الخزنة' }), /يوجد صندوق/);
  const choices = await t.accounting.moneyChoices();
  assert.deepEqual(choices.map((c) => c.name), ['الدرج (نقدًا)', 'تحويل بنكي', 'جوال باي', 'الخزنة']);
  const drawer = choices[0];
  // تحويل 3000 من الدرج إلى الخزنة: الدرج ينقص في شاشة الصندوق أيضًا
  const tr = await t.accounting.saveVoucher({ type: 'transfer', amount: 3000, account: drawer.id, to_account: safe.id });
  assert.equal(tr.number, 'A-T0001');
  let s = await t.cash.summary();
  assert.equal(s.expectedCash, 2000);
  assert.equal(s.extraOut, 3000);
  // مسحوبات صاحب المحل من الخزنة، وإيداع منه في الدرج، وإيراد آخر في البنك
  const draw = await t.accounting.saveVoucher({ type: 'payment', amount: 1500, account: safe.id, contra: 'owner', party_name: 'أبو أحمد', note: 'مصروف البيت' });
  assert.equal(draw.number, 'A-S0001');
  const dep = await t.accounting.saveVoucher({ type: 'receipt', amount: 400, account: drawer.id, contra: 'owner' });
  assert.equal(dep.number, 'A-V0001');
  await t.accounting.saveVoucher({ type: 'receipt', amount: 250, account: t.bank.id, contra: 'other_income', note: 'إيجار رف' });
  // دفعة لتاجر من الخزنة، ودفعة زبون تدخل الخزنة، ومصروف من الخزنة: الصندوق يُمرَّر كطريقة دفع
  const safeAsMethod = choices[3];
  const supplier = await t.inventory.saveSupplier({ name: 'أبو خالد', opening: 9000 });
  await t.inventory.paySupplier(supplier.id, 2000, { method: safeAsMethod });
  const customer = await t.customers.create({ name: 'أم أحمد' });
  await t.customers.addDebt(customer.id, 800);
  await t.customers.recordPayment(customer.id, 300, safeAsMethod);
  await t.expenses.save({ category: 'water', amount: 100, method: safeAsMethod });

  let b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(bal(b, 'suspense'), 0);
  assert.equal(bal(b, `box:${safe.id}`), 20000 + 3000 - 1500 - 2000 + 300 - 100);
  s = await t.cash.summary();
  assert.equal(s.expectedCash, 5000 - 3000 + 400);
  assert.equal(bal(b, DRAWER), s.expectedCash);
  assert.equal(bal(b, `method:${t.bank.id}`), 250);
  assert.equal(bal(b, 'other_income'), -250);
  const money = moneyAccounts(b.entries, b.chart);
  assert.equal(money[0].kind, 'drawer');
  assert.equal(money.find((m) => m.id === safe.id).balance, 19700);
  assert.equal(position(b.entries, b.chart).cash, s.expectedCash + 19700 + 250);
  // لا يُغلق صندوق فيه رصيد
  await assert.rejects(t.accounting.closeBox(safe.id), /رصيد/);
  // إلغاء سند المسحوبات يعيد المال للخزنة، والتراجع يعيده
  await t.accounting.voidVoucher(draw.id);
  b = await t.accounting.books();
  assert.equal(bal(b, `box:${safe.id}`), 21200);
  await t.accounting.restoreVoucher(draw.id);
  assert.equal(bal(await t.accounting.books(), `box:${safe.id}`), 19700);
  // قائمة السندات تجمع سندات القبض والصرف ودفعات الزبائن والتجار
  const list = await t.accounting.vouchers();
  assert.deepEqual(list.map((v) => v.number).sort(), ['A-S0001', 'A-S0002', 'A-T0001', 'A-V0001', 'A-V0002', 'A-V0003']);
  assert.equal(list.find((v) => v.source === 'supplier').party, 'أبو خالد');
  assert.equal(list.find((v) => v.source === 'customer').party, 'أم أحمد');
  assert.equal(t.accounting.contraName('payment', 'owner'), 'لصاحب المحل');
});

test('vouchers: an expense voucher is a normal expense with a numbered document', async () => {
  const t = await setup();
  const drawer = (await t.accounting.moneyChoices())[0];
  const v = await t.accounting.saveExpenseVoucher({ category: 'maintenance', amount: 450, method: drawer, party_name: 'الكهربائي', note: 'تصليح الثلاجة' });
  assert.equal(v.number, 'A-S0001');
  assert.equal(v.ref_table, 'expenses');
  const exp = await t.db.expenses.get(v.ref_id);
  assert.equal(exp.amount, 450);
  assert.equal(exp.category, 'maintenance');
  let b = await t.accounting.books();
  assertBalanced(b);
  // أثره مرة واحدة: من المصروف لا من السند
  assert.equal(bal(b, 'exp:maintenance'), 450);
  assert.equal(bal(b, DRAWER), -450);
  assert.equal((await t.cash.summary()).expectedCash, -450);
  assert.equal(t.accounting.contraName('payment', v.contra), 'مصروف: صيانة');
  // إلغاء السند يحذف المصروف
  await t.accounting.voidVoucher(v.id);
  assert.equal((await t.db.expenses.get(v.ref_id)).deleted, true);
  b = await t.accounting.books();
  assert.equal(bal(b, 'exp:maintenance'), 0);
  assert.equal((await t.accounting.vouchers())[0].cancelled, true);
  await assert.rejects(t.accounting.saveExpenseVoucher({ category: '', amount: 5, method: drawer }), /بند/);
});

test('vouchers: validation, numbering and the printable document', async () => {
  assert.equal(voucherProblem({ type: 'receipt', amount: 0, account: 'drawer', contra: 'owner' }), 'اكتب المبلغ');
  assert.equal(voucherProblem({ type: 'payment', amount: 5, account: null, contra: 'owner' }), 'اختر الصندوق');
  assert.equal(voucherProblem({ type: 'payment', amount: 5, account: 'drawer' }), 'اختر لمن صرفت');
  assert.equal(voucherProblem({ type: 'transfer', amount: 5, account: 'a', to_account: 'a' }), 'اختر صندوقين مختلفين');
  assert.equal(voucherProblem({ type: 'transfer', amount: 5, account: 'a', to_account: 'b' }), null);
  assert.equal(formatInvoiceNumber('B', 'payment', 7), 'B-S0007');
  assert.equal(formatInvoiceNumber('A', 'journal', 12), 'A-J0012');
  assert.ok(matchesInvoiceNumber('A-S0007', 's7') || matchesInvoiceNumber('A-S0007', '7'));
  const doc = voucherDoc({ type: 'payment', number: 'A-S0003', date: '2026-11-20T10:00:00.000Z', amount: 15000, party: 'أبو خالد', accountName: 'الخزنة', contraName: 'دفعة لتاجر', note: 'شهر 11' }, { name: 'بقالة الأمل', phone: '0599' });
  assert.equal(doc.title, 'سند صرف');
  assert.equal(doc.party, 'صرفنا إلى: أبو خالد');
  assert.ok(doc.totals[0].strong && doc.totals[0].value.includes('150'));
  assert.ok(doc.totals.some((x) => x.value === 'الخزنة'));
  assert.ok(doc.foot.includes('توقيع'));
  assert.equal(voucherDoc({ type: 'receipt', amount: 1, date: '2026-11-20T10:00:00.000Z', cancelled: true }).title, 'سند قبض (ملغى)');
});

test('journal vouchers: only a balanced entry is saved, and custom accounts appear in the books', async () => {
  assert.equal(journalProblem([{ account: 'a', debit: 5 }]), 'القيد يحتاج سطرين على الأقل');
  assert.match(journalProblem([{ account: 'a', debit: 5 }, { account: 'b', credit: 4 }]), /غير متوازن/);
  assert.equal(journalProblem([{ account: 'a', debit: 5, credit: 5 }, { account: 'b', credit: 5 }]), 'كل سطر إما مدين أو دائن');
  assert.equal(journalProblem([{ account: '', debit: 5 }, { account: 'b', credit: 5 }]), 'اختر الحساب في كل سطر');
  assert.equal(journalProblem([{ account: 'a', debit: 5 }, { account: 'b', credit: 5 }]), null);
  assert.deepEqual(journalTotals([{ debit: 5 }, { credit: 3 }]), { debit: 5, credit: 3, diff: 2 });
  const t = await setup();
  const loan = await t.accounting.saveAccount({ name: 'قرض من أخي', type: 'liability' });
  const tools = await t.accounting.saveAccount({ name: 'أثاث ومعدات', type: 'asset' });
  await assert.rejects(t.accounting.saveAccount({ name: 'قرض من أخي', type: 'asset' }), /يوجد حساب/);
  // اشترى ثلاجة بـ 4000 بقرض من أخيه
  const j = await t.accounting.saveVoucher({ type: 'journal', note: 'ثلاجة عرض بقرض', lines: [{ account: `acc:${tools.id}`, debit: 400000 }, { account: `acc:${loan.id}`, credit: 400000 }] });
  assert.equal(j.number, 'A-J0001');
  assert.equal(j.amount, 400000);
  await assert.rejects(t.accounting.saveVoucher({ type: 'journal', lines: [{ account: 'drawer', debit: 5 }, { account: 'owner', credit: 6 }] }), /غير متوازن/);
  // ثم سدّد 1000 من القرض بسند صرف من الدرج
  const drawer = (await t.accounting.moneyChoices())[0];
  await t.accounting.saveVoucher({ type: 'payment', amount: 100000, account: drawer.id, contra: `acc:${loan.id}`, party_name: 'أخي' });
  const b = await t.accounting.books();
  const tb = assertBalanced(b);
  assert.equal(bal(b, `acc:${tools.id}`), 400000);
  assert.equal(bal(b, `acc:${loan.id}`), -300000);
  assert.ok(tb.rows.some((r) => r.name === 'قرض من أخي' && r.type === 'liability'));
  const bs = balanceSheet(b.entries, b.chart);
  assert.ok(bs.liabilities.some((r) => r.name === 'قرض من أخي' && r.amount === 300000));
  // حساب عليه حركة لا يُحذف
  await assert.rejects(t.accounting.removeAccount(loan.id), /حركات/);
});

// ---------- الشيكات ----------
test('cheques: validation, what can be done, due list and reminders', () => {
  const base = { direction: 'in', amount: 5000, due_date: '2026-12-10', party_type: 'customer', party_id: 'c1', party_name: 'أم أحمد' };
  assert.equal(chequeProblem(base), null);
  assert.equal(chequeProblem({ ...base, amount: 0 }), 'اكتب مبلغ الشيك');
  assert.equal(chequeProblem({ ...base, due_date: '' }), 'اختر تاريخ استحقاق الشيك');
  assert.equal(chequeProblem({ ...base, party_id: null }), 'اختر الزبون');
  assert.equal(chequeProblem({ ...base, party_type: 'other', party_id: null, party_name: ' ' }), 'اكتب ممّن الشيك');
  assert.deepEqual(chequeActions({ ...base, status: 'pending' }), ['clear', 'endorse', 'bounce', 'remove']);
  assert.deepEqual(chequeActions({ ...base, direction: 'out', status: 'pending' }), ['clear', 'cancel', 'remove']);
  assert.deepEqual(chequeActions({ ...base, status: 'endorsed' }), ['bounce']);
  assert.deepEqual(chequeActions({ ...base, status: 'cleared' }), []);
  assert.equal(chequeLabel({ number: '100245', bank: 'بنك فلسطين' }), 'شيك 100245 — بنك فلسطين');
  const rec = chequeEntries('record', { ...base, id: 'q1', number: '77' });
  assert.deepEqual([rec.customer[0].amount, rec.customer[0].type, rec.customer[0].payment_id], [-5000, 'payment', 'q1']);
  assert.equal(chequeEntries('record', { ...base, party_type: 'other', party_id: null }).customer.length, 0);
  const list = [
    { ...base, id: '1', status: 'pending', due_date: '2026-11-18' },
    { ...base, id: '2', status: 'pending', due_date: '2026-11-22', direction: 'out', party_name: 'أبو خالد' },
    { ...base, id: '3', status: 'pending', due_date: '2026-12-30' },
    { ...base, id: '4', status: 'cleared', due_date: '2026-11-20' },
    { ...base, id: '5', status: 'pending', due_date: '2026-11-20', deleted: true },
  ];
  const due = chequesDue(list, '2026-11-20');
  assert.deepEqual(due.map((d) => [d.cheque.id, d.state]), [['1', 'overdue'], ['2', 'soon']]);
  assert.equal(chequesSummary(due).count, 2);
  assert.equal(chequesSummary(due).overdue, 1);
  assert.match(chequesSummary([due[1]]).title, /شيك عليك لـ أبو خالد يستحق بعد 2 أيام/);
  assert.equal(chequesSummary([]), null);
  assert.deepEqual(chequeTotals(list), { inTotal: 10000, inCount: 2, outTotal: 5000, outCount: 1 });
  assert.deepEqual(filterCheques(list, { direction: 'in' }).map((c) => c.id), ['1', '3', '4']);
  assert.deepEqual(filterCheques(list, { status: 'done' }).map((c) => c.id), ['4']);
  assert.deepEqual(filterCheques(list, { query: 'خالد' }).map((c) => c.id), ['2']);
  assert.match(chequeReminderText({ shopName: 'بقالة الأمل', cheque: { ...base, number: '77' } }), /شيك 77 بمبلغ/);
});

test('cheques: a received cheque settles the debt at once and moves money only when cashed', async () => {
  const t = await setup();
  const customer = await t.customers.create({ name: 'أم أحمد' });
  await t.customers.addDebt(customer.id, 9000);
  const ch = await t.accounting.saveCheque({ direction: 'in', number: '100245', bank: 'بنك فلسطين', amount: 6000, due_date: '2026-12-15', party_type: 'customer', party_id: customer.id, party_name: 'أم أحمد' });
  assert.equal(ch.status, 'pending');
  assert.equal((await t.customers.get(customer.id)).balance, 3000);
  let b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(bal(b, 'cheques_in'), 6000);
  assert.equal(bal(b, 'ar'), 3000);
  assert.equal(bal(b, DRAWER), 0);
  assert.equal(position(b.entries, b.chart).chequesIn, 6000);
  assert.ok((await t.accounting.chequeIds()).has(ch.id));
  // صُرف في البنك
  await t.accounting.chequeAction(ch.id, 'clear', { accountId: t.bank.id });
  b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(bal(b, 'cheques_in'), 0);
  assert.equal(bal(b, `method:${t.bank.id}`), 6000);
  await assert.rejects(t.accounting.chequeAction(ch.id, 'bounce'), /حالة الشيك/);
  // تراجع: يعود بانتظار الصرف
  await t.accounting.chequeUndo(ch.id);
  b = await t.accounting.books();
  assert.equal(bal(b, 'cheques_in'), 6000);
  assert.equal(bal(b, `method:${t.bank.id}`), 0);
  // صُرف نقدًا في الدرج: يظهر في شاشة الصندوق
  await t.accounting.chequeAction(ch.id, 'clear', { accountId: (await t.accounting.moneyChoices())[0].id });
  assert.equal((await t.cash.summary()).expectedCash, 6000);
  assert.equal(bal(await t.accounting.books(), DRAWER), 6000);
});

test('cheques: a bounced cheque returns the debt; an endorsed one pays the supplier', async () => {
  const t = await setup();
  const customer = await t.customers.create({ name: 'أم أحمد' });
  await t.customers.addDebt(customer.id, 9000);
  const supplier = await t.inventory.saveSupplier({ name: 'أبو خالد', opening: 20000 });
  const a = await t.accounting.saveCheque({ direction: 'in', number: '1', amount: 4000, due_date: '2026-12-01', party_type: 'customer', party_id: customer.id, party_name: 'أم أحمد' });
  const c2 = await t.accounting.saveCheque({ direction: 'in', number: '2', amount: 5000, due_date: '2026-12-05', party_type: 'customer', party_id: customer.id, party_name: 'أم أحمد' });
  assert.equal((await t.customers.get(customer.id)).balance, 0);
  // الأول رجع: دينه يعود
  await t.accounting.chequeAction(a.id, 'bounce');
  assert.equal((await t.customers.get(customer.id)).balance, 4000);
  // الثاني جُيّر للتاجر: ما عليك له ينقص
  await t.accounting.chequeAction(c2.id, 'endorse', { supplierId: supplier.id, supplierName: 'أبو خالد' });
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 15000);
  let b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(bal(b, 'cheques_in'), 0);
  assert.equal(bal(b, 'ar'), 4000);
  assert.equal(-bal(b, 'ap'), 15000);
  assert.equal(bal(b, 'suspense'), 0);
  // المجيَّر رجع أيضًا: يعود دينًا على الزبون وعليك للتاجر
  await t.accounting.chequeAction(c2.id, 'bounce');
  assert.equal((await t.customers.get(customer.id)).balance, 9000);
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 20000);
  b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(bal(b, 'cheques_in'), 0);
  // تراجع عن الرجوع الأخير: يعود مجيَّرًا؟ لا — يعود «بانتظار الصرف» وتُلغى قيود التجيير والرجوع
  await t.accounting.chequeUndo(c2.id);
  assert.equal((await t.accounting.cheque(c2.id)).status, 'pending');
  assert.equal((await t.customers.get(customer.id)).balance, 4000);
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 20000);
  b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(bal(b, 'cheques_in'), 5000);
  // شيك سُجّل خطأ يُحذف ويعود الدين
  await t.accounting.removeCheque(c2.id);
  assert.equal((await t.customers.get(customer.id)).balance, 9000);
  assert.equal(bal(await t.accounting.books(), 'cheques_in'), 0);
  assert.equal((await t.accounting.cheques()).length, 1);
});

test('cheques: an issued cheque lowers what you owe now and leaves the bank when cashed', async () => {
  const t = await setup();
  const supplier = await t.inventory.saveSupplier({ name: 'أبو خالد', opening: 20000 });
  const ch = await t.accounting.saveCheque({ direction: 'out', number: '900', amount: 12000, due_date: '2026-12-20', party_type: 'supplier', party_id: supplier.id, party_name: 'أبو خالد' });
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 8000);
  let b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(-bal(b, 'cheques_out'), 12000);
  assert.equal(position(b.entries, b.chart).chequesOut, 12000);
  await t.accounting.chequeAction(ch.id, 'clear', { accountId: t.bank.id });
  b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(bal(b, 'cheques_out'), 0);
  assert.equal(bal(b, `method:${t.bank.id}`), -12000);
  // شيك آخر أُلغي: يعود ما عليك
  const c2 = await t.accounting.saveCheque({ direction: 'out', amount: 3000, due_date: '2026-12-25', party_type: 'supplier', party_id: supplier.id, party_name: 'أبو خالد' });
  await t.accounting.chequeAction(c2.id, 'cancel');
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 8000);
  // شيك من غير زبون ولا تاجر: إيراد آخر حتى يُصرف
  await t.accounting.saveCheque({ direction: 'in', amount: 700, due_date: '2026-12-25', party_type: 'other', party_name: 'مستأجر الرف' });
  b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(bal(b, 'cheques_in'), 700);
  assert.equal(bal(b, 'other_income'), -700);
  assert.equal(bal(b, 'suspense'), 0);
  await assert.rejects(t.accounting.saveCheque({ direction: 'out', amount: 5, due_date: 'x', party_type: 'other', party_name: 'x' }), /تاريخ/);
});

test('drawer summary: vouchers, transfers and cashed cheques change the expected cash', () => {
  const s = sessionSummary({ opening: 100, payments: [{ method_kind: 'cash', direction: 'in', amount: 500 }], extraIn: 200, extraOut: 50, expenses: 30 });
  assert.equal(s.expectedCash, 100 + 500 - 30 + 200 - 50);
  assert.equal(sessionSummary({ opening: 0, payments: [] }).extraIn, 0);
});

test('books: a closed drawer session posts the shortage and hands the cash to the owner', async () => {
  const t = await setup();
  const { product } = await t.products.save({ name: 'سكر', sell_price: 1000, cost_price: 600 });
  await t.products.save({ ...product }, { qty: 50000 });
  await t.cash.open(2000);
  await sellCash(t, product, 3000);
  const r = await t.cash.close(4900); // المتوقع 5000: عجز 100
  assert.equal(r.difference, -100);
  await sellCash(t, product, 1000); // بعد الإغلاق: فترة جديدة تبدأ من صفر
  const b = await t.accounting.books();
  assertBalanced(b);
  assert.equal(bal(b, 'cash_diff'), 100);
  assert.equal(bal(b, DRAWER), (await t.cash.summary()).expectedCash);
  assert.equal(bal(b, DRAWER), 1000);
  // صاحب المحل وضع 2000 أول اليوم وأخذ 4900 عند الإغلاق
  assert.equal(bal(b, 'owner'), -2000 + 4900);
});

// ---------- المزامنة والنسخ الاحتياطي ----------
test('sync: a server that has not run 0010 yet keeps vouchers and cheques waiting, and takes the rest', async () => {
  assert.equal(TABLE.vouchers.mode, 'lww');
  assert.equal(TABLE.cheques.remote, 'cashier_cheques');
  const server = createFakeServer();
  const t = await setup();
  const ctx = { shopId: (await t.db.payment_methods.toArray())[0].shop_id, deviceId: uuid(), prefix: 'A', userId: null, deviceName: 'A' };
  const real = server.api({ current: null });
  const old = { ...real, rest: { ...real.rest, async upsert(name, rows, opts) {
    if (name === 'cashier_vouchers' || name === 'cashier_cheques') throw new HttpError(404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` }, name);
    return real.rest.upsert(name, rows, opts);
  } } };
  await t.store.put('shops', { id: ctx.shopId, name: 'بقالة', shop_type: 'grocery' });
  const customer = await t.customers.create({ name: 'أم أحمد' });
  await t.customers.addDebt(customer.id, 5000);
  await t.accounting.saveCheque({ direction: 'in', number: '7', amount: 5000, due_date: '2026-12-01', party_type: 'customer', party_id: customer.id, party_name: 'أم أحمد' });
  await t.accounting.saveVoucher({ type: 'payment', amount: 300, account: 'drawer', contra: 'owner' });
  const r = await createSyncEngine({ db: t.db, api: old, getContext: () => ctx, emit: () => {} }).run();
  assert.ok(!r.error, String(r.error));
  // كشف الزبون (ومعه قيد الشيك) وصل الخادم؛ السند والشيك ينتظران تحديثه بلا رفض
  assert.equal(server.tables.get('cashier_customer_entries').size, 2);
  assert.deepEqual((await t.db.outbox.toArray()).map((e) => [e.table, !!e.dead]).sort(), [['cheques', false], ['vouchers', false]]);
  // بعد تشغيل setup.sql يُرفعان وحدهما، وجهاز آخر يسحبهما
  await createSyncEngine({ db: t.db, api: real, getContext: () => ctx, emit: () => {} }).run();
  assert.equal(await t.db.outbox.count(), 0);
  assert.equal(server.tables.get('cashier_vouchers').size, 1);
  assert.equal([...server.tables.get('cashier_cheques').values()][0].due_date, '2026-12-01');
});

test('backup: old files without vouchers and cheques still restore, and new ones carry them', async () => {
  assert.ok(SYNCED.includes('vouchers') && SYNCED.includes('cheques'));
  const shopId = uuid();
  const old = makeBackup({ tables: { shops: [{ id: shopId, name: 'بقالة' }] }, meta: { shopId }, exportedAt: '2026-01-01T00:00:00.000Z' });
  const info = validateBackup(old, SYNCED);
  assert.equal(info.counts.vouchers, 0);
  assert.equal(info.counts.cheques, 0);
});

test('feature: accounting is on for every shop type, existing shops get it, and it can be switched off', () => {
  assert.equal(presetFor('grocery').accounting, true);
  assert.equal(presetFor('pharmacy').accounting, true);
  // محل قديم: إعداداته المحفوظة لا تذكر الميزة ← تأخذ قيمة نوع المحل
  assert.equal(resolveFeatures('clothing', { units: false }).accounting, true);
  assert.equal(resolveFeatures('clothing', { accounting: false }).accounting, false);
  const item = SIDE.find((i) => i.path === '/accounting');
  assert.deepEqual([item.perm, item.feature], ['cash', 'accounting']);
});

test('books: an edited invoice, a cash return and a removed cheque leave nothing in suspense', async () => {
  const t = await setup();
  const { product } = await t.products.save({ name: 'سكر', sell_price: 1000, cost_price: 600 });
  await t.products.save({ ...product }, { qty: 50000 });
  const customer = await t.customers.create({ name: 'أم أحمد' });
  // بيع بتحويل برسوم ثم تعديل الفاتورة إلى نقد وآجل: الأصلية تُلغى والجديدة برقمها
  const line = (qty) => makeLine(product, { qty, avgCost: 600 });
  const first = await t.sales.checkout({ lines: [line(3000)], payments: [{ kind: 'transfer', method_id: t.wallet.id, amount: 3000, fee_bp: 150 }] });
  const edited = await t.sales.checkout({
    replaces: first.invoice.id, lines: [line(4000)], customerId: customer.id,
    payments: [{ kind: 'cash', method_id: t.cashMethod.id, amount: 1500 }, { kind: 'credit', amount: 2500 }],
  });
  assert.equal(edited.invoice.number, first.invoice.number);
  // مرتجع نقدي من فاتورة أخرى، وشيك سُجّل خطأ ثم حُذف
  const cashSale = await sellCash(t, product, 2000);
  const ret = await t.sales.returnable(cashSale.invoice.id);
  await t.sales.processReturn(cashSale.invoice.id, [{ line: ret.rows[0].line, qty: 1000 }], 'cash');
  const ch = await t.accounting.saveCheque({ direction: 'in', amount: 900, due_date: '2026-12-01', party_type: 'customer', party_id: customer.id, party_name: 'أم أحمد' });
  await t.accounting.removeCheque(ch.id);
  const b = await t.accounting.books();
  assertBalanced(b);
  assert.ok(!b.entries.some((e) => e.lines.some((l) => l.account === 'suspense')), 'no entry touches suspense');
  assert.equal(bal(b, 'ar'), (await t.customers.get(customer.id)).balance);
  assert.equal(bal(b, 'ar'), 2500);
  assert.equal(bal(b, DRAWER), (await t.cash.summary()).expectedCash);
  assert.equal(bal(b, DRAWER), 1500 + 2000 - 1000);
  // الفاتورة الملغاة بالتعديل: المحفظة والرسوم تعودان صفرًا
  assert.equal(bal(b, `method:${t.wallet.id}`), 0);
  assert.equal(bal(b, 'fees'), 0);
  assert.equal(bal(b, 'cheques_in'), 0);
  assert.equal(-bal(b, 'sales'), 4000 + 2000);
  assert.equal(bal(b, 'sales_returns'), 1000);
  const stock = (await t.inventory.productsWithStock()).reduce((a, p) => a + stockValue(p.qty, p.avg_cost), 0);
  assert.equal(bal(b, 'inventory'), stock);
});

// ---------- مرتجع المشتريات ----------
test('purchase return: goods go back to the supplier, off the debt or for cash, never more than bought or in stock', async () => {
  const t = await setup();
  const { product: rice } = await t.products.save({ name: 'أرز', sell_price: 1200, cost_price: 900 });
  const { product: oil } = await t.products.save({ name: 'زيت', sell_price: 2500, cost_price: 2000 });
  const supplier = await t.inventory.saveSupplier({ name: 'أبو خالد' });
  const buy = await t.inventory.savePurchase({ lines: [purchaseLine(rice, { qty: 10000, unitCost: 900 }), purchaseLine(oil, { qty: 4000, unitCost: 2000 })], supplierId: supplier.id, paid: 'credit' });
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 17000);
  await sellCash(t, rice, 7000); // بقي 3 أرز
  let r = await t.inventory.purchaseReturnable(buy.invoice.id);
  assert.deepEqual(r.rows.map((x) => x.returnable), [10000, 4000]);
  assert.equal(r.stock.get(rice.id), 3000);
  // لا يُعاد ما بِيع
  await assert.rejects(t.inventory.returnPurchase(buy.invoice.id, [{ line: r.rows[0].line, qty: 5000 }], 'credit'), /الموجود أقل/);
  // إعادة 2 أرز و1 زيت على الحساب: ينزل مما عليك، والبضاعة تخرج
  const back = await t.inventory.returnPurchase(buy.invoice.id, [{ line: r.rows[0].line, qty: 2000 }, { line: r.rows[1].line, qty: 1000 }], 'credit');
  assert.equal(back.invoice.number, 'A-Q0001');
  assert.equal(back.invoice.type, 'purchase_return');
  assert.equal(back.total, 1800 + 2000);
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 17000 - 3800);
  assert.equal((await t.db.stock.get(rice.id)).qty, 1000);
  assert.equal((await t.db.stock.get(oil.id)).qty, 3000);
  // مرتجع ثانٍ نقدًا: يدخل الدرج وكشف التاجر لا يتغير؛ ولا يُعاد أكثر مما بقي من السطر
  r = await t.inventory.purchaseReturnable(buy.invoice.id);
  assert.deepEqual(r.rows.map((x) => [x.returned, x.returnable]), [[2000, 8000], [1000, 3000]]);
  await assert.rejects(t.inventory.returnPurchase(buy.invoice.id, [{ line: r.rows[1].line, qty: 4000 }], 'cash'), /أكبر/);
  const before = (await t.cash.summary()).expectedCash;
  const cashBack = await t.inventory.returnPurchase(buy.invoice.id, [{ line: r.rows[1].line, qty: 1000 }], 'cash');
  assert.equal(cashBack.cash, 2000);
  assert.equal((await t.cash.summary()).expectedCash, before + 2000);
  assert.equal((await t.inventory.supplier(supplier.id)).balance, 13200);
  // الدفاتر: متوازنة، التجار والدرج والبضاعة كما في شاشاتها، ولا شيء معلّق
  const b = await t.accounting.books();
  assertBalanced(b);
  assert.ok(!b.entries.some((e) => e.lines.some((l) => l.account === 'suspense')));
  assert.equal(-bal(b, 'ap'), 13200);
  assert.equal(bal(b, DRAWER), (await t.cash.summary()).expectedCash);
  const stock = (await t.inventory.productsWithStock()).reduce((a, p) => a + stockValue(p.qty, p.avg_cost), 0);
  assert.equal(bal(b, 'inventory'), stock);
  assert.equal(bal(b, 'stock_diff'), 0);
  // التقرير: المشتريات بعد طرح المرتجع
  const report = buildReport({
    invoices: await t.db.invoices.toArray(), lines: await t.db.invoice_lines.toArray(), payments: await t.db.payments.toArray(),
    products: await t.db.products.toArray(), from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z',
  });
  assert.equal(report.purchasesTotal, 17000 - 3800 - 2000);
  // فاتورة شراء نقدية بلا تاجر: المرتجع نقدًا فقط
  const cashBuy = await t.inventory.savePurchase({ lines: [purchaseLine(oil, { qty: 2000, unitCost: 2000 })], paid: 'cash' });
  const rr = await t.inventory.purchaseReturnable(cashBuy.invoice.id);
  await assert.rejects(t.inventory.returnPurchase(cashBuy.invoice.id, [{ line: rr.rows[0].line, qty: 1000 }], 'credit'), /بلا تاجر/);
});
