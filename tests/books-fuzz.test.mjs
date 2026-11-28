// اختبار عشوائي للدفاتر: مئات العمليات المتتابعة بترتيب عشوائي (ببذرة ثابتة، فالفشل يتكرر كما هو)،
// وبعد كل عملية: كل قيد متوازن، لا شيء معلّق، وحسابات الزبائن والتجار والدرج والبضاعة والشيكات والضريبة
// تطابق ما تعرضه شاشاتها.
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
import { makeLine, cartTotals } from '../src/domain/cart.js';
import { purchaseLine } from '../src/domain/inventory.js';
import { makeClock } from '../src/domain/merge.js';
import { stockValue } from '../src/domain/stock.js';
import { trialBalance, balanceSheet, balances, incomeStatement, taxReport, DRAWER } from '../src/domain/accounting.js';
import { buildReport } from '../src/domain/reports.js';
import { uuid } from '../src/core/ids.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function run(seed, steps, taxMode) {
  const R = rng(seed);
  const int = (a, b) => a + Math.floor(R() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const db = createDb(Dexie, `fuzz-${seed}-${taxMode}-${Date.now()}`);
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'A' };
  const clock = makeClock();
  const store = createStore({ db, clock, getContext: () => ctx });
  const deps = { db, store, getContext: () => ctx, clock };
  const settings = {};
  const getSettings = () => settings;
  const cashM = await store.put('payment_methods', { name: 'نقدًا', kind: 'cash', sort: 0 });
  const bank = await store.put('payment_methods', { name: 'بنك', kind: 'transfer', fee_bp: 0, sort: 1 });
  const wallet = await store.put('payment_methods', { name: 'محفظة', kind: 'transfer', fee_bp: 150, sort: 2 });
  const inventory = createInventoryRepo(deps); const customers = createCustomerRepo(deps);
  const products = createProductRepo(deps); const sales = createSaleRepo(deps);
  const cash = createCashRepo({ ...deps, getSettings }); const expenses = createExpenseRepo(deps);
  const acc = createAccountingRepo({ ...deps, getSettings, saveSettings: async (p) => Object.assign(settings, p), inventory, customers });
  const tax = taxMode === 'none' ? null : { rate: 1600, inclusive: taxMode === 'inclusive' };
  const ptax = () => (tax && R() < 0.7 ? { rate: 1600, mode: R() < 0.5 ? 'inclusive' : 'exclusive' } : null);

  const P = [];
  for (const [name, sell, cost, unit] of [['سكر', 1160, 700, 'piece'], ['أرز', 1745, 1100, 'piece'], ['بندورة', 399, 250, 'kg'], ['زيت', 2599, 1990, 'piece']]) {
    const { product } = await products.save({ name, sell_price: sell, cost_price: cost, unit });
    await products.save({ ...product }, { qty: int(20, 60) * 1000 });
    P.push(product.id);
  }
  const C = []; for (const n of ['أم أحمد', 'أبو علي', 'محمود']) C.push((await customers.create({ name: n })).id);
  const S = []; for (const n of ['الجنيدي', 'النور']) S.push((await inventory.saveSupplier({ name: n, opening: int(0, 3) * 10000 })).id);
  const safe = await acc.saveBox({ name: 'الخزنة', kind: 'cash', opening: 50000 });
  const centre = await acc.saveCenter({ name: 'سيارة' });
  const saleIds = []; const buyIds = []; const cheques = []; const vouchers = [];
  const log = [];

  const lineOf = async (pid) => {
    const p = await db.products.get(pid); const s = await db.stock.get(pid);
    const qty = p.unit === 'kg' ? int(1, 12) * 250 : int(1, 4) * 1000;
    return makeLine(p, { qty, avgCost: s ? s.avgCost : null });
  };
  const ops = {
    async sale() {
      const lines = []; for (let i = int(1, 3); i > 0; i--) lines.push(await lineOf(pick(P)));
      const discount = R() < 0.3 ? (R() < 0.5 ? { type: 'percent', value: int(1, 20) * 100 } : { type: 'amount', value: int(1, 300) }) : null;
      const total = cartTotals(lines, discount, 0, tax).total;
      if (total <= 0) return;
      const how = int(0, 4); const customerId = how >= 3 ? pick(C) : (R() < 0.2 ? pick(C) : null);
      let payments;
      if (how === 0) payments = [{ kind: 'cash', method_id: cashM.id, amount: total + int(0, 2) * 500 }]; // مع باقٍ
      else if (how === 1) payments = [{ kind: 'transfer', method_id: wallet.id, amount: total, fee_bp: 150 }];
      else if (how === 2) { const a = Math.floor(total / 2); payments = [{ kind: 'transfer', method_id: bank.id, amount: a, fee_bp: 0 }, { kind: 'cash', method_id: cashM.id, amount: total - a }].filter((x) => x.amount > 0); }
      else if (how === 3) payments = [{ kind: 'credit', amount: total }];
      else { const a = Math.floor(total / 3); payments = [{ kind: 'cash', method_id: cashM.id, amount: a }, { kind: 'credit', amount: total - a }].filter((x) => x.amount > 0); }
      const r = await sales.checkout({ lines, discount, payments, customerId, tax });
      saleIds.push(r.invoice.id);
    },
    async saleReturn() {
      if (!saleIds.length) return;
      const id = pick(saleIds); const inv = await db.invoices.get(id);
      if (inv.status === 'void') return;
      const r = await sales.returnable(id);
      const picks = r.rows.filter((x) => x.returnable > 0 && R() < 0.7).map((x) => ({ line: x.line, qty: x.line.unit === 'kg' ? Math.min(x.returnable, 250 * int(1, 4)) : Math.min(x.returnable, 1000) }));
      if (!picks.length) return;
      await sales.processReturn(id, picks, inv.customer_id ? pick(['auto', 'cash', 'credit']) : 'cash');
    },
    async voidSale() {
      if (!saleIds.length) return;
      const id = pick(saleIds);
      try { await sales.voidInvoice(id); } catch (e) { if (!/ملغاة|رُجعت/.test(e.message)) throw e; }
    },
    async editSale() {
      if (!saleIds.length) return;
      const id = pick(saleIds); const inv = await db.invoices.get(id);
      const lines = [await lineOf(pick(P))];
      const total = cartTotals(lines, null, 0, tax).total;
      try {
        const r = await sales.checkout({ replaces: id, lines, payments: [{ kind: 'cash', method_id: cashM.id, amount: total }], customerId: inv.customer_id, tax });
        saleIds.push(r.invoice.id);
      } catch (e) { if (!/ملغاة|رُجعت/.test(e.message)) throw e; }
    },
    async purchase() {
      const p = await db.products.get(pick(P));
      const supplierId = R() < 0.8 ? pick(S) : null;
      const r = await inventory.savePurchase({ lines: [purchaseLine(p, { qty: int(1, 20) * 1000, unitCost: int(200, 2200) })], supplierId, paid: supplierId && R() < 0.6 ? 'credit' : 'cash', tax: ptax() });
      buyIds.push(r.invoice.id);
    },
    async purchaseReturn() {
      if (!buyIds.length) return;
      const id = pick(buyIds); const r = await inventory.purchaseReturnable(id);
      const row = r.rows[0]; const have = r.stock.get(row.line.product_id) || 0;
      const qty = Math.min(row.returnable, Math.floor(have / 1000) * 1000, int(1, 3) * 1000);
      if (qty <= 0) return;
      await inventory.returnPurchase(id, [{ line: row.line, qty }], r.invoice.supplier_id && R() < 0.6 ? 'credit' : 'cash');
    },
    async debt() { await customers.addDebt(pick(C), int(1, 50) * 100); },
    async customerPay() { await customers.recordPayment(pick(C), int(1, 30) * 100, pick([cashM, bank, { id: safe.id, kind: 'transfer' }])); },
    async supplierPay() { await inventory.paySupplier(pick(S), int(1, 40) * 100, { method: pick([null, bank, { id: safe.id, kind: 'transfer' }]) }); },
    async voidCustomerEntry() {
      const c = await customers.get(pick(C));
      const e = c.entries.find((x) => !x.cancelled && !x.invoice_id && !(x.payment_id && cheques.includes(x.payment_id)) && (x.type === 'payment' || x.type === 'adjustment'));
      if (e) await customers.voidEntry(e);
    },
    async expense() { await expenses.save({ category: pick(['rent', 'electricity', 'نظافة']), amount: int(1, 30) * 100, method: pick([cashM, bank, null, { id: safe.id, kind: 'transfer' }]), cost_center: R() < 0.4 ? centre.id : null }); },
    async damage() { const pid = pick(P); const s = await db.stock.get(pid); if (s && s.qty >= 1000) await inventory.damage(pid, 1000); },
    async voucher() {
      const t = pick(['receipt', 'payment', 'transfer']);
      const box = pick(['drawer', bank.id, safe.id]);
      const v = t === 'transfer'
        ? await acc.saveVoucher({ type: t, amount: int(1, 30) * 100, account: box, to_account: pick(['drawer', bank.id, safe.id].filter((x) => x !== box)) })
        : await acc.saveVoucher({ type: t, amount: int(1, 30) * 100, account: box, contra: t === 'receipt' ? pick(['owner', 'other_income']) : pick(['owner', 'other_expense', ...(tax ? ['vat'] : [])]), cost_center: R() < 0.3 ? centre.id : null });
      vouchers.push(v.id);
    },
    async expenseVoucher() { const v = await acc.saveExpenseVoucher({ category: 'maintenance', amount: int(1, 20) * 100, method: R() < 0.5 ? { id: cashM.id, kind: 'cash' } : null }); vouchers.push(v.id); },
    async voidVoucher() { if (vouchers.length) { const id = pick(vouchers); if (R() < 0.7) await acc.voidVoucher(id); else await acc.restoreVoucher(id); } },
    async cheque() {
      const out = R() < 0.4;
      const other = R() < 0.15;
      const c = await acc.saveCheque(out
        ? { direction: 'out', amount: int(1, 40) * 100, due_date: '2026-12-20', party_type: other ? 'other' : 'supplier', party_id: other ? null : pick(S), party_name: 'تاجر' }
        : { direction: 'in', amount: int(1, 40) * 100, due_date: '2026-12-10', party_type: other ? 'other' : 'customer', party_id: other ? null : pick(C), party_name: 'زبون' });
      cheques.push(c.id);
    },
    async chequeMove() {
      if (!cheques.length) return;
      const id = pick(cheques); const c = await acc.cheque(id);
      if (!c) return;
      const what = int(0, 5);
      if (what === 0) { if (c.status !== 'pending') await acc.chequeUndo(id); return; }
      if (c.status === 'pending') {
        if (what === 1) await acc.chequeAction(id, 'clear', { accountId: pick(['drawer', bank.id, safe.id, cashM.id]) });
        else if (what === 2) await acc.chequeAction(id, c.direction === 'in' ? 'bounce' : 'cancel');
        else if (what === 3 && c.direction === 'in') await acc.chequeAction(id, 'endorse', { supplierId: pick(S), supplierName: 'تاجر' });
        else if (what === 4) await acc.removeCheque(id);
      } else if (c.status === 'endorsed' && what === 2) await acc.chequeAction(id, 'bounce');
    },
    async drawer() {
      const open = await cash.openSession();
      if (!open && R() < 0.5) await cash.open(int(0, 5) * 1000);
      else { const s = await cash.summary(); await cash.close(Math.max(0, s.expectedCash + pick([0, 0, 100, -100]))); }
    },
    async correct() { const m = (await acc.money()).find((x) => x.id === safe.id); await acc.correctBalance(safe.id, Math.max(0, m.balance + pick([500, -300])), pick(['opening', 'diff'])); },
  };
  const weights = { sale: 10, saleReturn: 4, voidSale: 2, editSale: 2, purchase: 5, purchaseReturn: 3, debt: 3, customerPay: 4, supplierPay: 3, voidCustomerEntry: 2, expense: 4, damage: 1, voucher: 4, expenseVoucher: 2, voidVoucher: 2, cheque: 4, chequeMove: 6, drawer: 2, correct: 1 };
  const bag = Object.entries(weights).flatMap(([k, n]) => Array(n).fill(k));

  async function check(step, name) {
    acc.invalidate();
    const b = await acc.books();
    const where = `seed ${seed} tax ${taxMode} step ${step} after ${name} [${log.slice(-6).join(', ')}]`;
    for (const e of b.entries) {
      const d = e.lines.reduce((a, l) => a + l.debit, 0), c = e.lines.reduce((a, l) => a + l.credit, 0);
      assert.equal(d, c, `unbalanced entry ${e.id} — ${where}`);
      assert.ok(!e.lines.some((l) => l.account === 'suspense'), `suspense in ${e.id} (${e.memo}) — ${where}`);
    }
    const bal = balances(b.entries); const g = (k) => bal.get(k) || 0; const z = (v) => v || 0;
    assert.ok(trialBalance(b.entries, b.chart).balanced, `trial balance — ${where}`);
    assert.ok(balanceSheet(b.entries, b.chart).balanced, `balance sheet — ${where}`);
    assert.equal(g('ar'), (await customers.list()).reduce((a, c) => a + c.balance, 0), `receivables — ${where}`);
    assert.equal(z(-g('ap')), (await inventory.suppliers()).reduce((a, s) => a + s.balance, 0), `payables — ${where}`);
    assert.equal(g(DRAWER), (await cash.summary()).expectedCash, `drawer — ${where}`);
    const stock = (await inventory.productsWithStock()).reduce((a, p) => a + stockValue(p.qty, p.avg_cost), 0);
    assert.equal(g('inventory'), stock, `inventory — ${where}`);
    const live = (await acc.cheques()).filter((c) => c.status === 'pending');
    assert.equal(g('cheques_in'), live.filter((c) => c.direction === 'in').reduce((a, c) => a + c.amount, 0), `cheques in — ${where}`);
    assert.equal(z(-g('cheques_out')), live.filter((c) => c.direction === 'out').reduce((a, c) => a + c.amount, 0), `cheques out — ${where}`);
    // الضريبة: حسابها = ضريبة الفواتير القائمة (مبيعات − مرتجعاتها − مشتريات + مرتجعاتها) − ما دُفع بسندات
    const inv = (await db.invoices.toArray()).filter((i) => !i.deleted && i.status !== 'void');
    const sign = { sale: 1, sale_return: -1, purchase: -1, purchase_return: 1 };
    const tr = taxReport(b.entries, {});
    assert.equal(tr.output - tr.input, inv.reduce((a, i) => a + sign[i.type] * (i.tax || 0), 0), `tax — ${where}`);
    assert.equal(z(-g('vat')), tr.output - tr.input - tr.paid, `vat account — ${where}`);
    if (!tax) assert.equal(g('vat'), 0, `no tax, no vat — ${where}`);
    // كل فاتورة بيع قائمة: ما دُفع وما بقي آجلًا = إجماليها، وضريبتها لا تتجاوز إجماليها
    for (const i of inv) {
      assert.ok((i.tax || 0) >= 0 && (i.tax || 0) <= i.total, `tax within total ${i.number} — ${where}`);
      if (i.type === 'sale') assert.ok(i.paid >= 0 && i.paid <= i.total, `paid within total ${i.number} — ${where}`);
    }
    // المرتجعات لا تردّ أكثر من الفاتورة ولا من ضريبتها (بيعًا وشراءً)
    const back = new Map();
    for (const i of inv) if ((i.type === 'sale_return' || i.type === 'purchase_return') && i.original_invoice_id) {
      const x = back.get(i.original_invoice_id) || { total: 0, tax: 0 }; x.total += i.total; x.tax += i.tax || 0; back.set(i.original_invoice_id, x);
    }
    for (const [id, x] of back) {
      const o = await db.invoices.get(id);
      assert.ok(x.total <= o.total && x.tax <= (o.tax || 0), `returns exceed invoice ${o.number}: ${x.total}/${o.total} tax ${x.tax}/${o.tax} — ${where}`);
    }
    return b;
  }

  await check(0, 'setup');
  for (let i = 1; i <= steps; i++) {
    const name = pick(bag);
    log.push(name);
    await ops[name]();
    await check(i, name);
  }
  // في النهاية: قائمة الدخل = تقرير الأرباح بعد ما لا يعرفه التقرير (ديون يدوية، إيرادات ومصاريف السندات، فروقات الدرج والتقييم، شيكات «آخر»)
  const b = await check(steps + 1, 'end');
  const report = buildReport({
    invoices: await db.invoices.toArray(), lines: await db.invoice_lines.toArray(), payments: await db.payments.toArray(), products: await db.products.toArray(),
    expenses: await db.expenses.toArray(), movements: await db.movements.toArray(), from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z',
  });
  const bal = balances(b.entries); const g = (k) => bal.get(k) || 0; const z = (v) => v || 0;
  // رسوم دفعات الزبائن بالمحفظة لا تدخل تقرير الأرباح (ليست في فاتورة): نقارن بما عداها
  const extra = -g('other_income') - g('other_expense') - g('cash_diff') - g('stock_diff');
  const manual = (await db.customer_entries.toArray()).filter((e) => e.type === 'adjustment' && !e.invoice_id && !(e.payment_id && cheques.includes(e.payment_id))).reduce((a, e) => a + e.amount, 0);
  const loosePurch = g('purchases_misc');
  assert.equal(incomeStatement(b.entries, b.chart).net, report.netProfit + manual + extra - loosePurch - (g('fees') - report.feeTotal), `income statement vs profit report — seed ${seed} tax ${taxMode}`);
  return log.length;
}

const MANY = Number(process.env.FUZZ_SEEDS || 0); // FUZZ_SEEDS=60 node --test tests/books-fuzz.test.mjs لجولة أوسع
const RUNS = MANY ? Array.from({ length: MANY }, (_, i) => [100 + i, ['none', 'inclusive', 'exclusive'][i % 3]]) : [[1, 'none'], [2, 'inclusive'], [3, 'exclusive'], [4, 'inclusive'], [5, 'none'], [6, 'exclusive']];
for (const [seed, taxMode] of RUNS) {
  test(`books stay consistent through 120 random operations (seed ${seed}, tax ${taxMode})`, async () => {
    assert.equal(await run(seed, 120, taxMode), 120);
  });
}
