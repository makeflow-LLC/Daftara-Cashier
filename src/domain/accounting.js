// المحاسبة (نقي): دفاتر المحل تُشتق من عمله اليومي — لا أحد يكتب قيدًا ليبيع.
// كل فاتورة ودفعة ومصروف وشيك وسند يتحوّل هنا إلى قيد مزدوج متوازن (مدين = دائن)، ومنها:
//   قيود اليومية، دفتر الأستاذ لكل حساب، ميزان المراجعة، قائمة الدخل، والميزانية العمومية.
// الأرصدة لا تُحفظ في أي مكان: تُحسب من السجلات نفسها، فلا «ترحيل» ولا إقفال ولا دفاتر تخرج عن الواقع.
//
// المطابقة مع باقي التطبيق (يتحقق منها tests/accounting.test.mjs):
//   حساب الزبائن  = مجموع كشوف الزبائن          حساب التجار = مجموع كشوف التجار
//   حساب الدرج    = «يجب أن يكون في الدرج الآن»   حساب البضاعة = قيمة المخزون بالتكلفة
//   شيكات برسم التحصيل = الشيكات الواردة التي لم تُصرف بعد
import { divRound } from './money.js';
import { categoryName, EXPENSE_CATEGORIES } from './expenses.js';
import { isVoidEntry } from './ledger.js';
import { formatMoney } from './currency.js';
import { dateTimeText } from './invoice.js';

export const DRAWER = 'drawer';

export const ACCOUNT_TYPES = Object.freeze({
  asset: { name: 'الأصول', hint: 'ما يملكه المحل', debit: true },
  liability: { name: 'الالتزامات', hint: 'ما على المحل للغير', debit: false },
  equity: { name: 'حقوق الملكية', hint: 'ما لصاحب المحل', debit: false },
  income: { name: 'الإيرادات', hint: 'ما كسبه المحل', debit: false },
  expense: { name: 'المصاريف', hint: 'ما كلّف المحل', debit: true },
});
export const TYPE_ORDER = Object.freeze(['asset', 'liability', 'equity', 'income', 'expense']);

// الحسابات الثابتة: المفتاح ← [الرمز، الاسم، النوع]
const FIXED = Object.freeze({
  drawer: ['1101', 'الصندوق (الدرج)', 'asset'],
  bank_other: ['1199', 'تحويلات بطريقة غير محددة', 'asset'],
  ar: ['1201', 'الزبائن (لك عندهم)', 'asset'],
  cheques_in: ['1301', 'شيكات برسم التحصيل', 'asset'],
  inventory: ['1401', 'البضاعة (المخزون)', 'asset'],
  ap: ['2101', 'التجار (عليك لهم)', 'liability'],
  cheques_out: ['2201', 'شيكات عليك لم تُصرف', 'liability'],
  capital: ['3101', 'رأس المال والأرصدة الافتتاحية', 'equity'],
  owner: ['3201', 'جاري صاحب المحل (مسحوبات وإيداعات)', 'equity'],
  suspense: ['3901', 'فروقات تحتاج مراجعة', 'equity'],
  sales: ['4101', 'المبيعات', 'income'],
  sales_returns: ['4102', 'مردودات المبيعات', 'income'],
  other_income: ['4201', 'إيرادات أخرى', 'income'],
  cogs: ['5101', 'تكلفة البضاعة المباعة', 'expense'],
  purchases_misc: ['5102', 'بضاعة بالدين بلا فاتورة أصناف', 'expense'],
  damage: ['5103', 'بضاعة تالفة', 'expense'],
  stock_diff: ['5104', 'فروقات الجرد وتقييم المخزون', 'expense'],
  fees: ['5201', 'رسوم التحويل', 'expense'],
  cash_diff: ['5202', 'عجز وزيادة الصندوق', 'expense'],
  other_expense: ['5299', 'مصاريف أخرى', 'expense'],
});
const CUSTOM_BASE = Object.freeze({ asset: 1900, liability: 2900, equity: 3900, income: 4900, expense: 5900 });

/** حسابات المحل الخاصة (settings.accounts) بعد التنظيف: [{ id, name, type }]. */
export function customAccounts(list) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    const name = String(a?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!a || !a.id || !name || !ACCOUNT_TYPES[a.type] || a.deleted) continue;
    out.push({ id: String(a.id), name, type: a.type });
  }
  return out;
}

/** رسالة خطأ أو null. */
export function accountProblem({ name, type }, existing = []) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) return 'اكتب اسم الحساب';
  if (!ACCOUNT_TYPES[type]) return 'اختر نوع الحساب';
  if (existing.some((a) => a.name === n)) return 'يوجد حساب بهذا الاسم';
  return null;
}

/** صناديق المحل الإضافية (settings.boxes) بعد التنظيف: [{ id, name, kind: 'cash'|'bank', opening, since, active }]. */
export function shopBoxes(settings) {
  const list = settings && Array.isArray(settings.boxes) ? settings.boxes : [];
  const out = [];
  for (const b of list) {
    const name = String(b?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!b || !b.id || !name) continue;
    out.push({
      id: String(b.id), name, kind: b.kind === 'bank' ? 'bank' : 'cash',
      opening: Number.isSafeInteger(b.opening) ? b.opening : 0, since: b.since || null, active: b.active !== false,
    });
  }
  return out;
}

/** رسالة خطأ أو null. */
export function boxProblem({ name, opening = 0 }, existing = [], exceptId = null) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) return 'اكتب اسم الصندوق';
  if (!Number.isSafeInteger(opening)) return 'الرصيد غير صحيح';
  if (existing.some((b) => b.id !== exceptId && b.active !== false && b.name === n)) return 'يوجد صندوق بهذا الاسم';
  return null;
}

/**
 * دليل الحسابات: الثابتة + حساب لكل طريقة دفع بالتحويل (بنك، محفظة) + الصناديق + بنود المصاريف + الحسابات الخاصة.
 * الرموز ثابتة ما دام ترتيب الإعداد ثابتًا (الجديد يأخذ الرقم التالي).
 * ctx: { methods: [payment_methods], boxes: shopBoxes(), accounts: customAccounts(), expenseCategories: [أسماء بنود المحل] }
 */
export function makeChart({ methods = [], boxes = [], accounts = [], expenseCategories = [] } = {}) {
  const map = new Map();
  const put = (key, code, name, type, extra = {}) => map.set(key, { key, code, name, type, ...extra });
  for (const [key, [code, name, type]] of Object.entries(FIXED)) put(key, code, name, type);
  const order = (a, b) => (a.sort || 0) - (b.sort || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id));
  const cashMethods = new Set(methods.filter((m) => m.kind === 'cash').map((m) => m.id));
  methods.filter((m) => m.kind === 'transfer').sort(order).forEach((m, i) => put(`method:${m.id}`, String(1151 + i), m.name, 'asset', { money: 'bank', deleted: !!m.deleted }));
  boxes.filter((b) => b.kind === 'cash').forEach((b, i) => put(`box:${b.id}`, String(1111 + i), b.name, 'asset', { money: 'cash', closed: !b.active }));
  boxes.filter((b) => b.kind === 'bank').forEach((b, i) => put(`box:${b.id}`, String(1131 + i), b.name, 'asset', { money: 'bank', closed: !b.active }));
  EXPENSE_CATEGORIES.forEach((c, i) => put(`exp:${c.key}`, String(5301 + i), `مصاريف: ${c.name}`, 'expense'));
  expenseCategories.forEach((n, i) => { if (!map.has(`exp:${n}`)) put(`exp:${n}`, String(5351 + i), `مصاريف: ${n}`, 'expense'); });
  const counters = {};
  for (const a of accounts) {
    counters[a.type] = (counters[a.type] || 0) + 1;
    put(`acc:${a.id}`, String(CUSTOM_BASE[a.type] + counters[a.type]), a.name, a.type, { custom: true });
  }
  const boxIds = new Set(boxes.map((b) => b.id));
  let unknown = 0;
  const chart = {
    cashMethods, boxIds,
    /** معلومات حساب بمفتاحه؛ المفتاح غير المعروف (بند مصاريف قديم، طريقة دفع محذوفة) يأخذ اسمًا معقولًا ولا يضيع. */
    info(key) {
      if (map.has(key)) return map.get(key);
      const k = String(key);
      const made = k.startsWith('exp:') ? { key: k, code: String(5390 + (++unknown % 9)), name: `مصاريف: ${categoryName(k.slice(4))}`, type: 'expense' }
        : k.startsWith('method:') || k.startsWith('box:') ? { key: k, code: '1198', name: 'صندوق أو طريقة دفع محذوفة', type: 'asset', money: 'bank' }
          : { key: k, code: '3902', name: 'حساب محذوف', type: 'equity' };
      map.set(k, made);
      return made;
    },
    has: (key) => map.has(key),
    /** كل الحسابات مرتبة برمزها. */
    all: () => [...map.values()].sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name, 'ar')),
    /**
     * مفتاح حساب الصندوق من معرّفه في السجلات: 'drawer' أو طريقة دفع نقدية ← الدرج، صندوق ← box:،
     * طريقة تحويل ← method:، وفارغ ← fallback.
     */
    money(id, fallback = 'bank_other') {
      if (!id) return fallback;
      if (id === DRAWER || cashMethods.has(id)) return DRAWER;
      if (boxIds.has(id)) return `box:${id}`;
      return `method:${id}`;
    },
  };
  return chart;
}

/** حساب المال لدفعة: نقدًا ← الدرج دائمًا؛ تحويل ← حساب طريقته (أو الصندوق إن كانت الطريقة صندوقًا). */
function paymentAccount(chart, p) {
  if (p.method_kind === 'cash') return DRAWER;
  return chart.money(p.method_id);
}

const amountOf = (qty, unitCost) => divRound(Math.abs(qty) * (Number.isSafeInteger(unitCost) ? unitCost : 0), 1000);
const pad = (n) => String(n).padStart(2, '0');
/** يوم محلي 'YYYY-MM-DD' من وقت ISO. */
export function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** أول لحظة من اليوم التالي لهذا الوقت (ISO). */
function nextDayStart(iso) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
}

// ---------- ما يدخل الدرج ويخرج منه خارج البيع والدفعات: سندات وشيكات ----------
/** هل هذا السند قائم وله أثر مالي مباشر؟ (سند المصروف أثره في جدول المصاريف) */
export const liveVoucher = (v) => !v.deleted && v.status !== 'void' && !v.ref_table;

/** حركات الدرج من السندات والشيكات: [{ at, delta, source }]. */
export function drawerExtraFlows({ vouchers = [], cheques = [] }, chart) {
  const out = [];
  for (const v of vouchers) {
    if (!liveVoucher(v) || v.type === 'journal') continue;
    const from = chart.money(v.account, null);
    const to = v.type === 'transfer' ? chart.money(v.to_account, null) : null;
    if (v.type === 'receipt' && from === DRAWER) out.push({ at: v.created_at, delta: v.amount, source: 'voucher' });
    if (v.type === 'payment' && from === DRAWER) out.push({ at: v.created_at, delta: -v.amount, source: 'voucher' });
    if (v.type === 'transfer' && from !== to) {
      if (from === DRAWER) out.push({ at: v.created_at, delta: -v.amount, source: 'transfer' });
      if (to === DRAWER) out.push({ at: v.created_at, delta: v.amount, source: 'transfer' });
    }
  }
  for (const c of cheques) {
    if (c.deleted || c.status !== 'cleared' || chart.money(c.account, null) !== DRAWER) continue;
    out.push({ at: c.status_at || c.updated_at, delta: c.direction === 'in' ? c.amount : -c.amount, source: 'cheque' });
  }
  return out;
}

/** مجموع ما دخل الدرج وخرج منه بالسندات والشيكات منذ since: { in, out }. */
export function drawerExtras(data, chart, since) {
  let i = 0, o = 0;
  for (const f of drawerExtraFlows(data, chart)) {
    if (f.at < since) continue;
    if (f.delta > 0) i += f.delta; else o -= f.delta;
  }
  return { in: i, out: o };
}

/**
 * يحاكي الدرج كما تحسبه شاشة الصندوق: بلا وردية مفتوحة يبدأ كل يوم من صفر، والوردية تبدأ بنقدها الافتتاحي،
 * والإغلاق يقارن المعدود بالمتوقع ثم يُسلَّم النقد لصاحب المحل. يرجع { steps, balance }:
 *   steps: [{ at, kind: 'open'|'close'|'day', before, opening?, counted?, session? }]
 */
export function simulateDrawer({ flows, sessions = [], now }) {
  const ev = [];
  for (const f of flows) ev.push({ at: f.at, order: 3, flow: f.delta });
  for (const s of sessions) {
    if (s.deleted || !s.opened_at) continue;
    ev.push({ at: s.opened_at, order: 2, open: s });
    if (s.closed_at) ev.push({ at: s.closed_at, order: 1, close: s });
  }
  ev.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order));
  const steps = [];
  let bal = 0, open = 0, last = null;
  const newDay = (at) => {
    if (open === 0 && last !== null && bal !== 0 && dayKey(at) !== dayKey(last)) {
      steps.push({ at: nextDayStart(last), kind: 'day', before: bal });
      bal = 0;
    }
  };
  for (const e of ev) {
    newDay(e.at);
    if (e.open) {
      const opening = Number.isSafeInteger(e.open.opening_cash) ? e.open.opening_cash : 0;
      if (opening !== bal) steps.push({ at: e.at, kind: 'open', before: bal, opening, session: e.open.id });
      bal = opening; open += 1;
    } else if (e.close) {
      const c = e.close.counted && Number.isSafeInteger(e.close.counted.cash) ? e.close.counted.cash : bal;
      if (bal !== 0 || c !== 0) steps.push({ at: e.at, kind: 'close', before: bal, counted: c, session: e.close.id });
      bal = 0; open = Math.max(0, open - 1);
    } else bal += e.flow;
    last = e.at;
  }
  if (now && (last === null || now > last)) newDay(now);
  return { steps, balance: bal };
}

// ---------- بناء قيود اليومية ----------
/**
 * data: { invoices, payments, customerEntries, supplierEntries, movements, expenses, sessions, vouchers, cheques,
 *         boxes, stockValue (قيمة المخزون الآن بالتكلفة، أو null), now (ISO) }
 * يرجع القيود مرتبة بالتاريخ: [{ id, date, kind, memo, number, ref: { type, id } | null, lines: [{ account, debit, credit }] }]
 * كل قيد متوازن دائمًا: ما لا يجد مقابله (سجل لم يصل من جهاز آخر بعد) يذهب إلى «فروقات تحتاج مراجعة».
 */
export function buildJournal(data, chart) {
  const {
    invoices = [], payments = [], customerEntries = [], supplierEntries = [], movements = [], expenses = [],
    sessions = [], vouchers = [], cheques = [], boxes = [], stockValue = null, now = null,
  } = data;
  const entries = [];
  function entry(id, date, kind, memo, { number = null, ref = null } = {}) {
    const e = { id, date, kind, memo, number, ref, lines: [] };
    const add = (account, debit, credit) => {
      if (!debit && !credit) return;
      const same = e.lines.find((l) => l.account === account && (debit ? l.debit > 0 : l.credit > 0));
      if (same) { same.debit += debit; same.credit += credit; } else e.lines.push({ account, debit, credit });
    };
    e.dr = (account, v) => { if (v > 0) add(account, v, 0); else if (v < 0) add(account, 0, -v); return e; };
    e.cr = (account, v) => e.dr(account, -v);
    e.done = () => {
      let diff = 0;
      for (const l of e.lines) diff += l.debit - l.credit;
      if (diff !== 0) e.cr('suspense', diff);
      delete e.dr; delete e.cr; delete e.done;
      if (e.lines.length) entries.push(e);
    };
    return e;
  }

  const invById = new Map(invoices.filter((i) => !i.deleted).map((i) => [i.id, i]));
  const chequeById = new Map(cheques.filter((c) => !c.deleted).map((c) => [c.id, c]));
  const paysOf = new Map();   // invoice_id → دفعات (غير الآجل)
  const loose = [];           // دفعات بلا فاتورة
  for (const p of payments) {
    if (p.method_kind === 'credit') continue; // الآجل ليس مالًا: أثره في كشف الزبون
    if (p.invoice_id && invById.has(p.invoice_id)) { if (!paysOf.has(p.invoice_id)) paysOf.set(p.invoice_id, []); paysOf.get(p.invoice_id).push(p); } else loose.push(p);
  }
  const payIds = new Set(loose.map((p) => p.id));
  const group = (rows) => {
    const byInvoice = new Map(), byPayment = new Map(), rest = [];
    for (const e of rows) {
      if (e.invoice_id && invById.has(e.invoice_id)) { if (!byInvoice.has(e.invoice_id)) byInvoice.set(e.invoice_id, []); byInvoice.get(e.invoice_id).push(e); }
      else if (e.payment_id && payIds.has(e.payment_id)) { if (!byPayment.has(e.payment_id)) byPayment.set(e.payment_id, []); byPayment.get(e.payment_id).push(e); }
      else rest.push(e);
    }
    return { byInvoice, byPayment, rest };
  };
  const cust = group(customerEntries);
  const supp = group(supplierEntries);
  const money = (e, p, fee = 0) => { const acc = paymentAccount(chart, p); const v = p.amount - fee; if (p.direction === 'in') e.dr(acc, v); else e.cr(acc, v); };
  const last = (rows, fallback) => rows.reduce((m, r) => (r.created_at > m ? r.created_at : m), '') || fallback;

  // ----- الفواتير -----
  for (const inv of invById.values()) {
    const pays = paysOf.get(inv.id) || [];
    const ce = cust.byInvoice.get(inv.id) || [];
    const se = supp.byInvoice.get(inv.id) || [];
    const ref = { type: 'invoice', id: inv.id };
    if (inv.type === 'sale') {
      const normal = pays.filter((p) => p.direction === 'in');
      const back = pays.filter((p) => p.direction !== 'in');
      const e = entry(`inv:${inv.id}`, inv.created_at, 'sale', `فاتورة بيع ${inv.number}`, { number: inv.number, ref });
      e.cr('sales', inv.total);
      const feeOf = new Map();
      for (const p of normal) { money(e, p, p.fee || 0); e.dr('fees', p.fee || 0); if (p.fee) feeOf.set(p.method_id, (feeOf.get(p.method_id) || 0) + p.fee); }
      for (const x of ce) if (!isVoidEntry(x)) e.dr('ar', x.amount);
      e.dr('cogs', inv.cost_total || 0).cr('inventory', inv.cost_total || 0);
      e.done();
      const undo = ce.filter(isVoidEntry);
      if (inv.status === 'void' || back.length || undo.length) {
        const v = entry(`inv:${inv.id}:void`, last([...back, ...undo], inv.updated_at || inv.created_at), 'void', `إلغاء فاتورة ${inv.number}`, { number: inv.number, ref });
        if (inv.status === 'void') { v.dr('sales', inv.total); v.dr('inventory', inv.cost_total || 0).cr('cogs', inv.cost_total || 0); }
        for (const p of back) {
          const fee = Math.min(feeOf.get(p.method_id) || 0, p.amount);
          if (fee) feeOf.set(p.method_id, feeOf.get(p.method_id) - fee);
          money(v, p, fee); v.cr('fees', fee);
        }
        for (const x of undo) v.dr('ar', x.amount);
        v.done();
      }
    } else if (inv.type === 'sale_return') {
      if (inv.status === 'void') continue;
      const e = entry(`inv:${inv.id}`, inv.created_at, 'sale_return', `مرتجع ${inv.number}`, { number: inv.number, ref });
      e.dr('sales_returns', inv.total);
      for (const p of pays) money(e, p);
      for (const x of ce) e.dr('ar', x.amount);
      e.dr('inventory', inv.cost_total || 0).cr('cogs', inv.cost_total || 0);
      e.done();
    } else if (inv.type === 'purchase' || inv.type === 'purchase_return') {
      if (inv.status === 'void') continue;
      const buy = inv.type === 'purchase';
      const e = entry(`inv:${inv.id}`, inv.created_at, inv.type, `${buy ? 'فاتورة شراء' : 'مرتجع شراء'} ${inv.number}`, { number: inv.number, ref });
      if (buy) e.dr('inventory', inv.total); else e.cr('inventory', inv.total);
      for (const p of pays) money(e, p);
      for (const x of se) e.cr('ap', x.amount);
      e.done();
    }
  }

  // ----- دفعات الزبائن والتجار (بلا فاتورة) -----
  for (const p of loose) {
    const ce = cust.byPayment.get(p.id) || [];
    const se = supp.byPayment.get(p.id) || [];
    const who = ce.length || p.customer_id ? 'customer' : se.length || p.supplier_id ? 'supplier' : null;
    const fix = [...ce, ...se].some(isVoidEntry);
    const memo = who === 'customer' ? (fix ? 'تصحيح دفعة زبون' : 'دفعة من زبون') : who === 'supplier' ? (fix ? 'تصحيح دفعة لتاجر' : 'دفعة لتاجر') : 'دفعة بلا مرجع';
    const e = entry(`pay:${p.id}`, p.created_at, who === 'supplier' ? 'supplier_payment' : who === 'customer' ? 'customer_payment' : 'payment', memo,
      { number: p.number || null, ref: who === 'customer' ? { type: 'customer', id: p.customer_id || ce[0]?.customer_id } : who === 'supplier' ? { type: 'supplier', id: p.supplier_id || se[0]?.supplier_id } : null });
    money(e, p, p.fee || 0);
    e.dr('fees', p.fee || 0);
    for (const x of ce) e.dr('ar', x.amount);
    for (const x of se) e.cr('ap', x.amount);
    // استلام حر بالمحفظة (بلا فاتورة ولا زبون): إيراد
    if (!who && p.direction === 'in') e.cr('other_income', p.amount);
    e.done();
  }

  // ----- قيود الزبائن والتجار بلا فاتورة ولا دفعة: شيك، رصيد سابق، دين يدوي -----
  for (const x of cust.rest) {
    const cheque = x.payment_id ? chequeById.get(x.payment_id) : null;
    const contra = cheque ? (cheque.direction === 'in' ? 'cheques_in' : 'cheques_out')
      : x.type === 'opening' || x.type === 'import' ? 'capital' : x.type === 'adjustment' && !x.invoice_id ? 'sales' : 'suspense';
    const memo = cheque ? `شيك ${cheque.number || ''}`.trim() : x.type === 'opening' ? 'رصيد سابق لزبون' : x.type === 'import' ? 'رصيد مستورد من دفترة' : x.type === 'adjustment' ? (isVoidEntry(x) ? 'تصحيح دين زبون' : 'دين على زبون بلا فاتورة') : 'قيد زبون';
    const e = entry(`ce:${x.id}`, x.created_at, cheque ? 'cheque' : 'customer_entry', memo, { ref: cheque ? { type: 'cheque', id: cheque.id } : { type: 'customer', id: x.customer_id } });
    e.dr('ar', x.amount).cr(contra, x.amount);
    e.done();
  }
  for (const x of supp.rest) {
    const cheque = x.payment_id ? chequeById.get(x.payment_id) : null;
    const contra = cheque ? (cheque.direction === 'in' ? 'cheques_in' : 'cheques_out')
      : x.type === 'opening' ? 'capital' : x.type === 'adjustment' && !x.invoice_id ? 'purchases_misc' : 'suspense';
    const memo = cheque ? `شيك ${cheque.number || ''}`.trim() : x.type === 'opening' ? 'رصيد سابق لتاجر' : x.type === 'adjustment' ? (isVoidEntry(x) ? 'تصحيح دين لتاجر' : 'بضاعة بالدين بلا فاتورة') : 'قيد تاجر';
    const e = entry(`se:${x.id}`, x.created_at, cheque ? 'cheque' : 'supplier_entry', memo, { ref: cheque ? { type: 'cheque', id: cheque.id } : { type: 'supplier', id: x.supplier_id } });
    e.cr('ap', x.amount).dr(contra, x.amount);
    e.done();
  }

  // ----- المخزون خارج الفواتير: رصيد افتتاحي، جرد وتعديل، تالف — قيد واحد لكل يوم ونوع -----
  const stockDays = new Map();
  for (const m of movements) {
    if (m.ref_type === 'invoice' || !['opening', 'adjustment', 'damage'].includes(m.type)) continue;
    // كمية كُتبت في بطاقة الصنف (لا جرد): بضاعة دخلت بلا فاتورة = بضاعة أول المدة، لا ربح
    const type = m.type === 'adjustment' && m.qty > 0 && m.ref_type !== 'stock_count' ? 'opening' : m.type;
    const key = `${dayKey(m.created_at)}:${type}`;
    const g = stockDays.get(key) || { type, at: m.created_at, value: 0, count: 0 };
    const v = amountOf(m.qty, m.unit_cost);
    g.value += m.type === 'damage' ? -v : m.qty >= 0 ? v : -v;
    g.count += 1;
    if (m.created_at > g.at) g.at = m.created_at;
    stockDays.set(key, g);
  }
  for (const [key, g] of stockDays) {
    const contra = g.type === 'opening' ? 'capital' : g.type === 'damage' ? 'damage' : 'stock_diff';
    const memo = g.type === 'opening' ? 'بضاعة أول المدة (أُدخلت بلا فاتورة شراء)' : g.type === 'damage' ? 'بضاعة تالفة' : 'جرد وتعديل كميات';
    const e = entry(`stock:${key}`, g.at, 'stock', `${memo} (${g.count} صنف)`);
    e.dr('inventory', g.value).cr(contra, g.value);
    e.done();
  }

  // ----- المصاريف -----
  for (const x of expenses) {
    if (x.deleted) continue;
    const paid = x.method_id ? chart.money(x.method_id) : 'owner'; // «من خارج الصندوق» = من جيب صاحب المحل
    const e = entry(`exp:${x.id}`, x.spent_at || x.created_at, 'expense', `${categoryName(x.category)}${x.note ? ` — ${x.note}` : ''}`, { ref: { type: 'expense', id: x.id } });
    e.dr(`exp:${x.category || 'other'}`, x.amount).cr(paid, x.amount);
    e.done();
  }

  // ----- الصناديق: رصيدها عند إضافتها -----
  for (const b of boxes) {
    if (!b.opening) continue;
    const e = entry(`box:${b.id}:open`, b.since || '1970-01-01T00:00:00.000Z', 'opening', `رصيد أول المدة: ${b.name}`, { ref: { type: 'box', id: b.id } });
    e.dr(`box:${b.id}`, b.opening).cr('capital', b.opening);
    e.done();
  }

  // ----- السندات -----
  for (const v of vouchers) {
    if (!liveVoucher(v)) continue;
    const ref = { type: 'voucher', id: v.id };
    const date = v.voucher_date || v.created_at;
    if (v.type === 'journal') {
      const e = entry(`v:${v.id}`, date, 'journal', v.note || 'قيد يومية', { number: v.number, ref });
      for (const l of Array.isArray(v.lines) ? v.lines : []) { e.dr(l.account, l.debit || 0); e.cr(l.account, l.credit || 0); }
      e.done();
    } else if (v.type === 'transfer') {
      const e = entry(`v:${v.id}`, date, 'transfer', v.note || 'تحويل بين الصناديق', { number: v.number, ref });
      e.dr(chart.money(v.to_account), v.amount).cr(chart.money(v.account), v.amount);
      e.done();
    } else {
      const inn = v.type === 'receipt';
      const who = v.party_name ? ` — ${v.party_name}` : '';
      const e = entry(`v:${v.id}`, date, v.type, `${inn ? 'سند قبض' : 'سند صرف'}${who}${v.note ? ` (${v.note})` : ''}`, { number: v.number, ref });
      const contra = v.contra || (inn ? 'other_income' : 'other_expense');
      if (inn) e.dr(chart.money(v.account), v.amount).cr(contra, v.amount); else e.dr(contra, v.amount).cr(chart.money(v.account), v.amount);
      e.done();
    }
  }

  // ----- الشيكات: ما ليس له كشف زبون أو تاجر، وصرف الشيك -----
  for (const c of chequeById.values()) {
    const acc = c.direction === 'in' ? 'cheques_in' : 'cheques_out';
    const ref = { type: 'cheque', id: c.id };
    const label = `شيك ${c.number || ''}${c.party_name ? ` — ${c.party_name}` : ''}`.replace(/\s+/g, ' ').trim();
    if (c.party_type === 'other' || !c.party_id) {
      const e = entry(`chq:${c.id}`, c.created_at, 'cheque', c.direction === 'in' ? `استلام ${label}` : `إصدار ${label}`, { ref });
      if (c.direction === 'in') e.dr(acc, c.amount).cr('other_income', c.amount); else e.dr('other_expense', c.amount).cr(acc, c.amount);
      e.done();
      if (c.status === 'bounced' || c.status === 'cancelled') {
        const u = entry(`chq:${c.id}:back`, c.status_at || c.updated_at, 'cheque', `${c.status === 'bounced' ? 'رجوع' : 'إلغاء'} ${label}`, { ref });
        if (c.direction === 'in') u.dr('other_income', c.amount).cr(acc, c.amount); else u.dr(acc, c.amount).cr('other_expense', c.amount);
        u.done();
      }
    }
    if (c.status === 'cleared') {
      const e = entry(`chq:${c.id}:clear`, c.status_at || c.updated_at, 'cheque', `صرف ${label}`, { ref });
      const m = chart.money(c.account || DRAWER);
      if (c.direction === 'in') e.dr(m, c.amount).cr(acc, c.amount); else e.dr(acc, c.amount).cr(m, c.amount);
      e.done();
    }
  }

  // ----- الدرج: بداية اليوم، الإغلاق، ونهاية يوم بلا إغلاق -----
  const flows = [];
  for (const p of payments) if (p.method_kind === 'cash') flows.push({ at: p.created_at, delta: p.direction === 'in' ? p.amount : -p.amount });
  for (const x of expenses) if (!x.deleted && x.method_id && chart.cashMethods.has(x.method_id)) flows.push({ at: x.created_at, delta: -x.amount });
  flows.push(...drawerExtraFlows({ vouchers, cheques }, chart));
  const sim = simulateDrawer({ flows, sessions, now });
  sim.steps.forEach((s, i) => {
    const id = `drawer:${s.kind}:${s.session || s.at}:${i}`;
    if (s.kind === 'open') {
      const e = entry(id, s.at, 'drawer', 'بداية اليوم: نقد في الدرج', { ref: { type: 'drawer' } });
      e.dr(DRAWER, s.opening - s.before).cr('owner', s.opening - s.before);
      e.done();
    } else if (s.kind === 'close') {
      const diff = s.counted - s.before;
      const e = entry(id, s.at, 'drawer', diff === 0 ? 'إغلاق الصندوق: مطابق' : diff > 0 ? 'إغلاق الصندوق: زيادة' : 'إغلاق الصندوق: عجز', { ref: { type: 'drawer' } });
      e.cr(DRAWER, s.before).dr('owner', s.counted).cr('cash_diff', diff);
      e.done();
    } else {
      const e = entry(id, s.at, 'drawer', 'نقد نهاية يوم بلا إغلاق للصندوق', { ref: { type: 'drawer' } });
      e.cr(DRAWER, s.before).dr('owner', s.before);
      e.done();
    }
  });

  // ----- تقييم المخزون: الدفاتر تُطابَق بقيمة البضاعة الفعلية الآن (تغيّر تكلفة، تقريب، بيع قبل تسجيل التكلفة) -----
  if (Number.isSafeInteger(stockValue)) {
    let book = 0;
    for (const e of entries) for (const l of e.lines) if (l.account === 'inventory') book += l.debit - l.credit;
    if (book !== stockValue) {
      const e = entry('stock:revalue', now || new Date().toISOString(), 'stock', 'مطابقة قيمة البضاعة بالتكلفة الحالية');
      e.dr('inventory', stockValue - book).cr('stock_diff', stockValue - book);
      e.done();
    }
  }

  return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

// ---------- الدفاتر ----------
/** رصيد كل حساب (مدين موجب) حتى تاريخ (غير شامل) أو كل القيود. */
export function balances(entries, until = null) {
  const out = new Map();
  for (const e of entries) {
    if (until && e.date >= until) continue;
    for (const l of e.lines) out.set(l.account, (out.get(l.account) || 0) + l.debit - l.credit);
  }
  return out;
}

/**
 * ميزان المراجعة لفترة [from, to) — to غير شاملة، وكلاهما اختياري.
 * rows: [{ key, code, name, type, opening, debit, credit, closing }] (opening و closing: مدين موجب، دائن سالب)
 * totals: { debit, credit, closingDebit, closingCredit, openingDebit, openingCredit }, balanced
 */
export function trialBalance(entries, chart, { from = null, to = null } = {}) {
  const acc = new Map();
  const row = (k) => { if (!acc.has(k)) acc.set(k, { opening: 0, debit: 0, credit: 0 }); return acc.get(k); };
  for (const e of entries) {
    if (to && e.date >= to) continue;
    const before = from && e.date < from;
    for (const l of e.lines) {
      const r = row(l.account);
      if (before) r.opening += l.debit - l.credit; else { r.debit += l.debit; r.credit += l.credit; }
    }
  }
  const rows = [];
  for (const [key, r] of acc) {
    if (!r.opening && !r.debit && !r.credit) continue;
    rows.push({ ...chart.info(key), ...r, closing: r.opening + r.debit - r.credit });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name, 'ar'));
  const t = { debit: 0, credit: 0, closingDebit: 0, closingCredit: 0, openingDebit: 0, openingCredit: 0 };
  for (const r of rows) {
    t.debit += r.debit; t.credit += r.credit;
    if (r.closing > 0) t.closingDebit += r.closing; else t.closingCredit -= r.closing;
    if (r.opening > 0) t.openingDebit += r.opening; else t.openingCredit -= r.opening;
  }
  return { rows, totals: t, balanced: t.debit === t.credit && t.closingDebit === t.closingCredit && t.openingDebit === t.openingCredit };
}

/**
 * دفتر الأستاذ لحساب: الرصيد السابق ثم كل حركة برصيدها الجاري.
 * يرجع { opening, rows: [{ entry, date, memo, number, ref, debit, credit, balance }], debit, credit, closing }
 */
export function accountLedger(entries, key, { from = null, to = null } = {}) {
  let opening = 0, run = 0, debit = 0, credit = 0;
  const rows = [];
  for (const e of entries) {
    if (to && e.date >= to) continue;
    let d = 0, c = 0;
    for (const l of e.lines) if (l.account === key) { d += l.debit; c += l.credit; }
    if (!d && !c) continue;
    if (from && e.date < from) { opening += d - c; continue; }
    rows.push({ entry: e, date: e.date, memo: e.memo, number: e.number, ref: e.ref, debit: d, credit: c });
    debit += d; credit += c;
  }
  run = opening;
  for (const r of rows) { run += r.debit - r.credit; r.balance = run; }
  return { opening, rows, debit, credit, closing: run };
}

/** قائمة الدخل لفترة: { income: [{…, amount}], expenses: [{…, amount}], totalIncome, totalExpenses, net }. */
export function incomeStatement(entries, chart, range = {}) {
  const tb = trialBalance(entries, chart, range);
  const income = tb.rows.filter((r) => r.type === 'income').map((r) => ({ ...r, amount: r.credit - r.debit })).filter((r) => r.amount);
  const expenses = tb.rows.filter((r) => r.type === 'expense').map((r) => ({ ...r, amount: r.debit - r.credit })).filter((r) => r.amount);
  const totalIncome = income.reduce((a, r) => a + r.amount, 0);
  const totalExpenses = expenses.reduce((a, r) => a + r.amount, 0);
  return { income, expenses, totalIncome, totalExpenses, net: totalIncome - totalExpenses };
}

/**
 * الميزانية العمومية حتى تاريخ (غير شامل؛ null = الآن): الأصول = الالتزامات + حقوق الملكية.
 * أرباح كل ما مضى تدخل في حقوق الملكية سطرًا واحدًا «الأرباح المتراكمة» (لا إقفال سنوي).
 */
export function balanceSheet(entries, chart, to = null) {
  const bal = balances(entries, to);
  const pick = (type, sign) => {
    const rows = [];
    for (const [key, v] of bal) { const a = chart.info(key); if (a.type === type && v) rows.push({ ...a, amount: sign * v }); }
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  };
  const assets = pick('asset', 1);
  const liabilities = pick('liability', -1);
  const equity = pick('equity', -1);
  let profit = 0;
  for (const [key, v] of bal) { const t = chart.info(key).type; if (t === 'income' || t === 'expense') profit -= v; }
  if (profit) equity.push({ key: 'profit', code: '3999', name: profit >= 0 ? 'الأرباح المتراكمة' : 'الخسائر المتراكمة', type: 'equity', amount: profit, computed: true });
  const total = (rows) => rows.reduce((a, r) => a + r.amount, 0);
  const totals = { assets: total(assets), liabilities: total(liabilities), equity: total(equity) };
  return { assets, liabilities, equity, totals, balanced: totals.assets === totals.liabilities + totals.equity };
}

/** أين مال المحل الآن: صناديقه وما له وما عليه. net = صافي ما يملكه المحل. */
export function position(entries, chart) {
  const bal = balances(entries);
  const get = (k) => bal.get(k) || 0;
  const money = moneyAccounts(entries, chart, bal);
  const cash = money.reduce((a, m) => a + m.balance, 0);
  const p = {
    cash, receivables: get('ar'), chequesIn: get('cheques_in'), inventory: get('inventory'),
    payables: -get('ap'), chequesOut: -get('cheques_out'), other: 0,
  };
  for (const [key, v] of bal) {
    const a = chart.info(key);
    if (a.custom && a.type === 'asset') p.other += v;
    if (a.custom && a.type === 'liability') p.other += v;
  }
  p.net = p.cash + p.receivables + p.chequesIn + p.inventory + p.other - p.payables - p.chequesOut;
  return { ...p, money };
}

/** الصناديق وحسابات البنوك والمحافظ بأرصدتها: [{ key, id, name, kind: 'drawer'|'cash'|'bank', balance, custom, closed }]. */
export function moneyAccounts(entries, chart, bal = balances(entries)) {
  const out = [{ key: DRAWER, id: DRAWER, name: 'الدرج (صندوق البيع)', kind: 'drawer', balance: bal.get(DRAWER) || 0, custom: false, closed: false }];
  for (const a of chart.all()) {
    if (!a.money) continue;
    const balance = bal.get(a.key) || 0;
    const box = a.key.startsWith('box:');
    if ((a.deleted || a.closed) && !balance) continue; // طريقة محذوفة أو صندوق مغلق بلا رصيد لا يظهر
    out.push({ key: a.key, id: a.key.slice(a.key.indexOf(':') + 1), name: a.name, kind: a.money, balance, custom: box, closed: !!a.closed });
  }
  for (const [key, balance] of bal) {
    if (key !== 'bank_other' && !(key.startsWith('method:') && !chart.has(key))) continue;
    if (balance) out.push({ key, id: null, name: chart.info(key).name, kind: 'bank', balance, custom: false, closed: true });
  }
  return out;
}

// ---------- السندات ----------
export const VOUCHER_TITLES = Object.freeze({ receipt: 'سند قبض', payment: 'سند صرف', transfer: 'تحويل بين الصناديق', journal: 'قيد يومية' });

/** لمن / ممن: الحسابات المقابلة الجاهزة لسند بلا زبون ولا تاجر. */
export function contraChoices(type, accounts = []) {
  const base = type === 'receipt'
    ? [{ key: 'owner', label: 'من صاحب المحل', hint: 'وضع مالًا من جيبه في المحل' }, { key: 'other_income', label: 'إيراد آخر', hint: 'إيجار رفّ، عمولة، خدمة…' }]
    : [{ key: 'owner', label: 'لصاحب المحل', hint: 'مسحوبات شخصية: أخذ مالًا لنفسه أو لبيته' }, { key: 'other_expense', label: 'صرف آخر', hint: 'ما ليس مصروفًا له بند' }];
  return [...base, ...accounts.map((a) => ({ key: `acc:${a.id}`, label: a.name, hint: ACCOUNT_TYPES[a.type].name, custom: true }))];
}

/** رسالة خطأ أو null. */
export function voucherProblem(v) {
  if (!VOUCHER_TITLES[v.type]) return 'نوع السند غير معروف';
  if (v.type === 'journal') return journalProblem(v.lines);
  if (!Number.isSafeInteger(v.amount) || v.amount <= 0) return 'اكتب المبلغ';
  if (!v.account) return 'اختر الصندوق';
  if (v.type === 'transfer') {
    if (!v.to_account) return 'اختر الصندوق المستلم';
    if (v.to_account === v.account) return 'اختر صندوقين مختلفين';
    return null;
  }
  if (!v.ref_table && !v.contra) return v.type === 'receipt' ? 'اختر ممّن استلمت' : 'اختر لمن صرفت';
  return null;
}

/** قيد اليومية اليدوي: سطران على الأقل، كل سطر مدين أو دائن، والمجموعان متساويان. رسالة خطأ أو null. */
export function journalProblem(lines) {
  const list = Array.isArray(lines) ? lines : [];
  if (list.length < 2) return 'القيد يحتاج سطرين على الأقل';
  let d = 0, c = 0;
  for (const l of list) {
    if (!l.account) return 'اختر الحساب في كل سطر';
    const deb = l.debit || 0, cre = l.credit || 0;
    if (!Number.isSafeInteger(deb) || !Number.isSafeInteger(cre) || deb < 0 || cre < 0) return 'مبلغ غير صحيح';
    if ((deb > 0) === (cre > 0)) return 'كل سطر إما مدين أو دائن';
    d += deb; c += cre;
  }
  if (d !== c) return 'القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن';
  return null;
}

/** مجموعا قيد يدوي والفرق بينهما (للعرض الحي أثناء الكتابة). */
export function journalTotals(lines) {
  let debit = 0, credit = 0;
  for (const l of lines || []) { debit += l.debit || 0; credit += l.credit || 0; }
  return { debit, credit, diff: debit - credit };
}

/**
 * نموذج السند للعرض والطباعة والإرسال (نفس شكل نموذج الفاتورة: يرسمه receiptElement و renderInvoiceCanvas).
 * v: { type, number, date, amount, party, accountName, toName, contraName, note, cancelled }
 */
export function voucherDoc(v, shop = {}, currency = 'ILS') {
  const m = (x) => formatMoney(x, currency);
  const totals = [{ label: v.type === 'receipt' ? 'المبلغ المستلم' : v.type === 'payment' ? 'المبلغ المصروف' : 'المبلغ المحوَّل', value: m(v.amount), strong: true }];
  if (v.accountName) totals.push({ label: v.type === 'receipt' ? 'دخل إلى' : v.type === 'payment' ? 'صُرف من' : 'من', value: v.accountName });
  if (v.type === 'transfer' && v.toName) totals.push({ label: 'إلى', value: v.toName });
  if (v.contraName) totals.push({ label: 'البيان', value: v.contraName });
  if (v.note) totals.push({ label: 'ملاحظة', value: v.note });
  if (Number.isSafeInteger(v.balanceAfter)) totals.push({ label: v.balanceLabel || 'الباقي', value: m(Math.abs(v.balanceAfter)) });
  return {
    shopName: shop.name || '', shopPhone: shop.phone || '', shopAddress: shop.address || '',
    title: `${VOUCHER_TITLES[v.type] || 'سند'}${v.cancelled ? ' (ملغى)' : ''}`, number: v.number || '', date: dateTimeText(v.date),
    party: v.party ? `${v.type === 'receipt' ? 'استلمنا من' : 'صرفنا إلى'}: ${v.party}` : '',
    rows: [], totals,
    foot: v.type === 'payment' ? 'توقيع المستلم: ________________' : v.type === 'receipt' ? 'شكرًا لكم' : '',
  };
}
