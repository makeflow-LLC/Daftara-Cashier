// المحاسبة على الجهاز: الصناديق، السندات (قبض، صرف، تحويل، قيد)، الشيكات، والدفاتر المحسوبة من سجلات المحل.
// لا رصيد يُحفظ: الدفاتر تُبنى من الفواتير والدفعات والمصاريف والشيكات والسندات (domain/accounting.js)،
// وتُحفظ نتيجتها في الذاكرة حتى يتغيّر شيء.
import {
  makeChart, shopBoxes, customAccounts, buildJournal, boxProblem, accountProblem, voucherProblem, position, moneyAccounts,
  balances, liveVoucher, DRAWER, VOUCHER_TITLES, contraChoices,
} from '../../domain/accounting.js';
import { chequeProblem, chequeEntries, chequeUndoEntry, chequesDue, chequeActions } from '../../domain/cheques.js';
import { cancelledIds, isVoidEntry } from '../../domain/ledger.js';
import { customCategories, expenseProblem, categoryName } from '../../domain/expenses.js';
import { formatInvoiceNumber } from '../../domain/numbering.js';
import { stockValue } from '../../domain/stock.js';
import { costCenters, centerProblem, centerReport } from '../../domain/centers.js';
import { uuid } from '../../core/ids.js';

/**
 * getSettings: إعدادات المحل الحالية. saveSettings(patch): يحفظها (دمج سطحي).
 * inventory / customers: مستودعا المخزون والزبائن (قيمة البضاعة، دفعات التجار والزبائن).
 */
export function createAccountingRepo({ db, store, getContext, clock, getSettings = () => ({}), saveSettings = async () => {}, inventory = null, customers = null }) {
  function invalid(message, field = 'amount') { return Object.assign(new Error(message), { errors: { [field]: message } }); }
  let cache = null;

  async function nextNumber(type) {
    const key = `seq:${type}`;
    const seq = ((await db.meta.get(key))?.value || 0) + 1;
    await db.meta.put({ key, value: seq });
    const prefix = getContext().prefix;
    return { seq, number: formatInvoiceNumber(/^[A-Z]{1,3}$/.test(prefix || '') ? prefix : 'A', type, seq) };
  }
  async function openSessionId() {
    const s = (await db.cash_sessions.orderBy('opened_at').reverse().limit(5).toArray()).find((x) => !x.deleted && !x.closed_at);
    return s ? s.id : null;
  }
  async function stockNow() {
    if (!inventory) return null;
    const [ps, whs] = await Promise.all([inventory.productsWithStock(), inventory.warehouses()]);
    return ps.reduce((a, p) => a + stockValue(p.qty, p.avg_cost), 0) + whs.reduce((a, w) => a + w.value, 0);
  }

  const repo = {
    /** يُنادى عند أي تغيّر في البيانات أو إعدادات المحل: الدفاتر تُعاد حسابها عند الطلب التالي. */
    invalidate() { cache = null; },

    boxes: () => shopBoxes(getSettings()),
    accounts: () => customAccounts(getSettings().accounts),
    async chart() {
      const s = getSettings();
      return makeChart({ methods: await db.payment_methods.toArray(), boxes: shopBoxes(s), accounts: customAccounts(s.accounts), expenseCategories: customCategories(s.expenseCategories) });
    },

    /** الدفاتر كلها: { entries, chart, at }. تُحسب مرة وتبقى حتى invalidate(). */
    async books() {
      if (cache) return cache;
      const [invoices, payments, customerEntries, supplierEntries, movements, expenses, sessions, vouchers, cheques, chart, stock, cs, ss] = await Promise.all([
        db.invoices.toArray(), db.payments.toArray(), db.customer_entries.toArray(), db.supplier_entries.toArray(), db.movements.toArray(),
        db.expenses.toArray(), db.cash_sessions.toArray(), db.vouchers.toArray(), db.cheques.toArray(), repo.chart(), stockNow(),
        db.customers.toArray(), db.suppliers.toArray(),
      ]);
      const now = clock(); // ساعة التطبيق (لا تسبقها سجلاته أبدًا)
      const entries = buildJournal({
        invoices, payments, customerEntries, supplierEntries, movements, expenses, sessions, vouchers, cheques,
        boxes: repo.boxes(), stockValue: stock, now, customerNames: new Map(cs.map((c) => [c.id, c.name])), supplierNames: new Map(ss.map((s) => [s.id, s.name])),
      }, chart);
      cache = { entries, chart, at: now };
      return cache;
    },
    /** أين مال المحل الآن (domain position). */
    async position() { const b = await repo.books(); return position(b.entries, b.chart); },
    /** الصناديق والبنوك والمحافظ بأرصدتها. */
    async money() { const b = await repo.books(); return moneyAccounts(b.entries, b.chart); },

    /**
     * ما يُختار منه «من أين دُفع / أين دخل»: الدرج، ثم طرق التحويل (بنك، محافظ)، ثم الصناديق الإضافية.
     * كل عنصر { id, name, kind: 'cash'|'transfer', drawer, box } — يصلح أن يُمرَّر كطريقة دفع لدفعات الزبائن والتجار والمصاريف.
     */
    async moneyChoices() {
      const methods = (await db.payment_methods.orderBy('sort').toArray()).filter((m) => !m.deleted && m.active && m.kind !== 'credit');
      const cash = methods.find((m) => m.kind === 'cash');
      return [
        { id: cash ? cash.id : DRAWER, name: 'الدرج (نقدًا)', kind: 'cash', drawer: true, box: false },
        ...methods.filter((m) => m.kind === 'transfer').map((m) => ({ id: m.id, name: m.name, kind: 'transfer', drawer: false, box: false })),
        ...repo.boxes().filter((b) => b.active).map((b) => ({ id: b.id, name: b.name, kind: 'transfer', drawer: false, box: true })),
      ];
    },
    /** اسم صندوق أو طريقة دفع من معرّفه (للعرض في السندات والكشوف). */
    async moneyName(id) {
      if (!id || id === DRAWER) return 'الدرج';
      const box = repo.boxes().find((b) => b.id === id);
      if (box) return box.name;
      const m = await db.payment_methods.get(id);
      return m ? (m.kind === 'cash' ? 'الدرج' : m.name) : 'تحويل';
    },

    // ---------- الصناديق ----------
    /** صندوق جديد (خزنة، حساب بنك…) برصيده الآن، أو تعديل اسمه ونوعه. */
    async saveBox({ id = null, name, kind = 'cash', opening = 0 }) {
      const list = repo.boxes();
      const err = boxProblem({ name, opening }, list, id);
      if (err) throw invalid(err, 'name');
      const clean = String(name).trim().replace(/\s+/g, ' ').slice(0, 40);
      const next = id
        ? list.map((b) => (b.id === id ? { ...b, name: clean, kind: kind === 'bank' ? 'bank' : 'cash' } : b))
        : [...list, { id: uuid(), name: clean, kind: kind === 'bank' ? 'bank' : 'cash', opening, since: clock(), active: true }];
      await saveSettings({ boxes: next });
      repo.invalidate();
      return next.find((b) => (id ? b.id === id : b.name === clean));
    },
    /** إغلاق صندوق: لا يُغلق وفيه رصيد (حوّله أولًا). الصندوق المغلق يختفي من القوائم وتبقى حركاته في الدفاتر. */
    async closeBox(id) {
      const m = (await repo.money()).find((x) => x.id === id && x.custom);
      if (m && m.balance !== 0) throw invalid('في الصندوق رصيد — حوّله إلى صندوق آخر أولًا', 'name');
      await saveSettings({ boxes: repo.boxes().map((b) => (b.id === id ? { ...b, active: false } : b)) });
      repo.invalidate();
    },
    async reopenBox(id) {
      await saveSettings({ boxes: repo.boxes().map((b) => (b.id === id ? { ...b, active: true } : b)) });
      repo.invalidate();
    },

    // ---------- الحسابات الخاصة (قرض، أثاث ومعدات، شريك…) ----------
    async saveAccount({ name, type }) {
      const list = repo.accounts();
      const err = accountProblem({ name, type }, list);
      if (err) throw invalid(err, 'name');
      const acc = { id: uuid(), name: String(name).trim().replace(/\s+/g, ' ').slice(0, 40), type };
      await saveSettings({ accounts: [...list, acc] });
      repo.invalidate();
      return acc;
    },
    /** لا يُحذف حساب عليه حركة: تبقى الدفاتر متماسكة. */
    async removeAccount(id) {
      const b = await repo.books();
      if (b.entries.some((e) => e.lines.some((l) => l.account === `acc:${id}`))) throw invalid('على هذا الحساب حركات — لا يُحذف', 'name');
      await saveSettings({ accounts: repo.accounts().filter((a) => a.id !== id) });
      repo.invalidate();
    },

    // ---------- مراكز التكلفة ----------
    centers: () => costCenters(getSettings()),
    /** مركز جديد أو تعديله: الاسم والتصنيفات المربوطة به (تصنيف لمركز واحد: يُنزع من غيره). */
    async saveCenter({ id = null, name, categories = [] }) {
      const list = costCenters(getSettings());
      const err = centerProblem({ name }, list, id);
      if (err) throw invalid(err, 'name');
      const clean = String(name).trim().replace(/\s+/g, ' ').slice(0, 40);
      const mine = new Set(categories);
      const others = list.filter((c) => c.id !== id).map((c) => ({ ...c, categories: c.categories.filter((x) => !mine.has(x)) }));
      const center = { id: id || uuid(), name: clean, categories: [...mine], active: true };
      const next = id ? list.map((c) => (c.id === id ? center : others.find((o) => o.id === c.id))) : [...others, center];
      await saveSettings({ costCenters: next });
      return center;
    },
    /** إغلاق مركز: يختفي من الخيارات، وحركاته السابقة تبقى في تقريره. */
    async closeCenter(id, active = false) {
      await saveSettings({ costCenters: costCenters(getSettings()).map((c) => (c.id === id ? { ...c, active } : c)) });
    },
    /** ربح كل مركز في مدة. */
    async centerReport(range = {}) {
      const [invoices, lines, products, expenses, vouchers, movements] = await Promise.all([
        db.invoices.toArray(), db.invoice_lines.toArray(), db.products.toArray(), db.expenses.toArray(), db.vouchers.toArray(), db.movements.toArray(),
      ]);
      const accountTypes = new Map(repo.accounts().map((a) => [`acc:${a.id}`, a.type]));
      return centerReport({ invoices, lines, products, expenses, vouchers, movements, accountTypes }, repo.centers(), range);
    },

    // ---------- السندات ----------
    /**
     * سند قبض أو صرف (بلا زبون ولا تاجر)، تحويل بين صندوقين، أو قيد يومية يدوي.
     * v: { type, amount, account, to_account, contra, party_name, note, date (ISO أو null = الآن), lines }
     */
    async saveVoucher(v) {
      const row = {
        type: v.type, amount: v.type === 'journal' ? (v.lines || []).reduce((a, l) => a + (l.debit || 0), 0) : v.amount,
        account: v.account || null, to_account: v.type === 'transfer' ? v.to_account || null : null,
        contra: v.type === 'receipt' || v.type === 'payment' ? v.contra || null : null,
        party_name: v.party_name ? String(v.party_name).trim().slice(0, 80) || null : null,
        note: v.note ? String(v.note).trim().slice(0, 200) || null : null,
        voucher_at: v.date || clock(),
        lines: v.type === 'journal' ? (v.lines || []).map((l) => ({ account: l.account, debit: l.debit || 0, credit: l.credit || 0 })) : null,
        cost_center: v.cost_center || null,
      };
      const err = voucherProblem(row);
      if (err) throw invalid(err);
      const saved = await store.write(async (w) => {
        const { seq, number } = await nextNumber(v.type);
        return w.put('vouchers', { ...row, seq, number, status: 'final', device_id: getContext().deviceId ?? null });
      });
      repo.invalidate();
      return saved;
    },
    /**
     * سند صرف لمصروف: يُسجَّل المصروف في المصاريف (فيدخل التقارير وصافي الربح كأي مصروف) ومعه سند برقمه.
     * method: من moneyChoices() أو null = من خارج الصندوق.
     */
    async saveExpenseVoucher({ category, amount, method = null, note = null, party_name = null, date = null, cost_center = null }) {
      const exp = {
        category: String(category || '').trim() || null, amount, method_id: method ? method.id : null, cost_center: cost_center || null,
        note: note ? String(note).trim().slice(0, 200) || null : null, spent_at: date || clock(),
      };
      const err = expenseProblem(exp);
      if (err) throw invalid(err);
      const session = method && method.kind === 'cash' ? await openSessionId() : null;
      const saved = await store.write(async (w) => {
        const e = await w.put('expenses', { ...exp, cash_session_id: session });
        const { seq, number } = await nextNumber('payment');
        return w.put('vouchers', {
          type: 'payment', seq, number, status: 'final', amount, account: method ? method.id : null, contra: `exp:${exp.category}`,
          party_name: party_name ? String(party_name).trim().slice(0, 80) || null : null, note: exp.note, voucher_at: exp.spent_at,
          ref_table: 'expenses', ref_id: e.id, cost_center: cost_center || null, device_id: getContext().deviceId ?? null,
        });
      });
      repo.invalidate();
      return saved;
    },
    /** إلغاء سند: يبقى في السجل «ملغى» ولا يدخل الدفاتر. سند المصروف يُحذف معه مصروفه. */
    async voidVoucher(id) {
      const v = await db.vouchers.get(id);
      if (!v || v.deleted) throw invalid('السند غير موجود');
      await store.write(async (w) => {
        await w.patch('vouchers', id, { status: 'void' });
        if (v.ref_table === 'expenses' && v.ref_id && await db.expenses.get(v.ref_id)) await w.patch('expenses', v.ref_id, { deleted: true });
      });
      repo.invalidate();
    },
    async restoreVoucher(id) {
      const v = await db.vouchers.get(id);
      if (!v) return;
      await store.write(async (w) => {
        await w.patch('vouchers', id, { status: 'final' });
        if (v.ref_table === 'expenses' && v.ref_id && await db.expenses.get(v.ref_id)) await w.patch('expenses', v.ref_id, { deleted: false });
      });
      repo.invalidate();
    },

    /**
     * كل السندات في قائمة واحدة، الأحدث أولًا: سندات القبض والصرف من جدول السندات، ودفعات الزبائن (سند قبض)
     * ودفعات التجار (سند صرف) من الدفعات. كل عنصر:
     * { key, source: 'voucher'|'customer'|'supplier', id, type, number, date, amount, party, accountId, contra, note, cancelled, partyId }
     */
    async vouchers({ limit = 500 } = {}) {
      const [vs, payments, ce, se, cs, ss, exps] = await Promise.all([
        db.vouchers.toArray(), db.payments.toArray(), db.customer_entries.toArray(), db.supplier_entries.toArray(),
        db.customers.toArray(), db.suppliers.toArray(), db.expenses.toArray(),
      ]);
      const cName = new Map(cs.map((c) => [c.id, c.name]));
      const sName = new Map(ss.map((s) => [s.id, s.name]));
      const liveOf = (entries) => {
        const gone = cancelledIds(entries);
        return new Set(entries.filter((e) => e.type === 'payment' && e.payment_id && !isVoidEntry(e) && !gone.has(e.id)).map((e) => e.payment_id));
      };
      const liveC = liveOf(ce), liveS = liveOf(se);
      const deadExp = new Set(exps.filter((e) => e.deleted).map((e) => e.id));
      const out = [];
      for (const v of vs) {
        if (v.deleted) continue;
        out.push({
          key: `v:${v.id}`, source: 'voucher', id: v.id, type: v.type, number: v.number, date: v.voucher_at || v.created_at, amount: v.amount,
          party: v.party_name || null, accountId: v.account, toId: v.to_account, contra: v.contra, note: v.note, lines: v.lines, ref_table: v.ref_table,
          cancelled: v.status === 'void' || (v.ref_table === 'expenses' && deadExp.has(v.ref_id)), partyId: null,
        });
      }
      for (const p of payments) {
        if (p.invoice_id || p.method_kind === 'credit' || !p.number) continue;
        if (p.direction === 'in' && p.customer_id && liveC.has(p.id)) {
          out.push({ key: `p:${p.id}`, source: 'customer', id: p.id, type: 'receipt', number: p.number, date: p.created_at, amount: p.amount, party: cName.get(p.customer_id) || '', accountId: p.method_kind === 'cash' ? DRAWER : p.method_id, contra: 'customer', note: null, cancelled: false, partyId: p.customer_id });
        } else if (p.direction === 'out' && p.supplier_id && liveS.has(p.id)) {
          out.push({ key: `p:${p.id}`, source: 'supplier', id: p.id, type: 'payment', number: p.number, date: p.created_at, amount: p.amount, party: sName.get(p.supplier_id) || '', accountId: p.method_kind === 'cash' ? DRAWER : p.method_id, contra: 'supplier', note: null, cancelled: false, partyId: p.supplier_id });
        }
      }
      return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, limit);
    },
    /** اسم الحساب المقابل لسند: «مسحوبات صاحب المحل»، «إيراد آخر»، بند المصروف، أو الحساب الخاص. */
    contraName(type, contra) {
      if (!contra) return null;
      if (contra === 'customer') return 'دفعة من دين زبون';
      if (contra === 'supplier') return 'دفعة لتاجر';
      if (contra === 'capital') return 'رصيد كان موجودًا (أول المدة)';
      if (contra.startsWith('exp:')) return `مصروف: ${categoryName(contra.slice(4))}`;
      const c = contraChoices(type, repo.accounts(), { tax: true }).find((x) => x.key === contra);
      return c ? c.label : null;
    },

    // ---------- الشيكات ----------
    async cheques() {
      return (await db.cheques.toArray()).filter((c) => !c.deleted);
    },
    /** أرقام الشيكات كلها: قيد في كشف زبون أو تاجر يحمل payment_id منها لا يُعدَّل من الكشف بل من الشيك. */
    async chequeIds() {
      return new Set(await db.cheques.toCollection().primaryKeys());
    },
    async cheque(id) {
      const c = await db.cheques.get(id);
      return c && !c.deleted ? c : null;
    },
    /**
     * شيك جديد: استلمته (in) من زبون أو أعطيته (out) لتاجر — دينه ينزل فورًا، والمال يتحرك حين يُصرف الشيك.
     * c: { direction, number, bank, amount, due_date, party_type, party_id, party_name, note }
     */
    async saveCheque(c) {
      const row = {
        id: uuid(), direction: c.direction, number: c.number ? String(c.number).trim().slice(0, 30) || null : null,
        bank: c.bank ? String(c.bank).trim().slice(0, 40) || null : null, amount: c.amount, due_date: c.due_date,
        party_type: c.party_type === 'customer' || c.party_type === 'supplier' ? c.party_type : 'other',
        party_id: c.party_type === 'customer' || c.party_type === 'supplier' ? c.party_id || null : null,
        party_name: c.party_name ? String(c.party_name).trim().slice(0, 80) || null : null,
        note: c.note ? String(c.note).trim().slice(0, 200) || null : null, status: 'pending',
      };
      const err = chequeProblem(row);
      if (err) throw invalid(err);
      const ent = chequeEntries('record', row);
      const saved = await store.write(async (w) => {
        const ch = await w.put('cheques', { ...row, device_id: getContext().deviceId ?? null });
        for (const e of ent.customer) await w.append('customer_entries', e);
        for (const e of ent.supplier) await w.append('supplier_entries', e);
        return ch;
      });
      repo.invalidate();
      return saved;
    },
    /**
     * حدث على شيك: clear (صُرف: accountId = الصندوق) | bounce (رجع) | endorse (جُيّر: supplierId, supplierName) | cancel (أُلغي).
     */
    async chequeAction(id, action, { accountId = null, supplierId = null, supplierName = null } = {}) {
      const c = await repo.cheque(id);
      if (!c) throw invalid('الشيك غير موجود');
      if (!chequeActions(c).includes(action) || action === 'remove') throw invalid('لا يصح هذا مع حالة الشيك الآن');
      if (action === 'clear' && !accountId) throw invalid('اختر الصندوق');
      if (action === 'endorse' && !supplierId) throw invalid('اختر التاجر');
      const now = clock();
      const ent = action === 'clear' ? { customer: [], supplier: [] } : chequeEntries(action, c, { supplierId });
      const patch = action === 'clear' ? { status: 'cleared', account: accountId }
        : action === 'bounce' ? { status: 'bounced' }
          : action === 'endorse' ? { status: 'endorsed', endorsed_to: supplierId, endorsed_name: supplierName || null }
            : { status: 'cancelled' };
      const saved = await store.write(async (w) => {
        for (const e of ent.customer) await w.append('customer_entries', e);
        for (const e of ent.supplier) await w.append('supplier_entries', e);
        return w.patch('cheques', id, { ...patch, status_at: now });
      });
      repo.invalidate();
      return saved;
    },
    /** تراجع عن آخر حدث: يعود الشيك «بانتظار الصرف»، وتُلغى القيود التي كتبها ذلك الحدث (يبقى قيد الاستلام الأول). */
    async chequeUndo(id) {
      const c = await repo.cheque(id);
      if (!c || c.status === 'pending') return c;
      await store.write(async (w) => {
        await undoEntries(w, c, false);
        await w.patch('cheques', id, { status: 'pending', status_at: null, account: null, endorsed_to: null, endorsed_name: null });
      });
      repo.invalidate();
      return repo.cheque(id);
    },
    /** شيك سُجّل خطأ (ولم يُصرف): يُحذف ويُلغى أثره من كشف الزبون أو التاجر. */
    async removeCheque(id) {
      const c = await repo.cheque(id);
      if (!c) return;
      if (c.status !== 'pending') throw invalid('الشيك لم يعد بانتظار الصرف');
      await store.write(async (w) => {
        await undoEntries(w, c, true);
        await w.patch('cheques', id, { deleted: true });
      });
      repo.invalidate();
    },
    /** الشيكات التي حان موعدها أو اقترب. */
    async chequesDue(today) {
      return chequesDue(await repo.cheques(), today);
    },

    /**
     * تصحيح رصيد صندوق أو حساب بنك برقم واحد: «كم فيه فعلًا الآن؟» — يُكتب سند قبض أو صرف بالفرق.
     * reason: 'opening' رصيد كان موجودًا قبل استعمال التطبيق (رأس مال) | 'diff' رسوم بنك أو فرق (مصروف/إيراد آخر).
     * يرجع السند، أو null إن كان الرصيد مطابقًا.
     */
    async correctBalance(accountId, actual, reason = 'opening') {
      if (!Number.isSafeInteger(actual)) throw invalid('اكتب الرصيد الموجود فعلًا');
      const m = (await repo.money()).find((x) => x.id === accountId);
      if (!m || m.kind === 'drawer') throw invalid('الدرج يُصحَّح بإغلاق الصندوق');
      const diff = actual - m.balance;
      if (diff === 0) return null;
      return repo.saveVoucher({
        type: diff > 0 ? 'receipt' : 'payment', amount: Math.abs(diff), account: accountId,
        contra: reason === 'opening' ? 'capital' : diff > 0 ? 'other_income' : 'other_expense', note: 'تصحيح الرصيد',
      });
    },

    /** رصيد حساب واحد الآن (مدين موجب). */
    async balanceOf(key) { const b = await repo.books(); return balances(b.entries).get(key) || 0; },
    titles: VOUCHER_TITLES,
    liveVoucher,
  };

  /** يلغي قيود الشيك في كشوف الزبائن والتجار: كلها (all) أو ما بعد قيد الاستلام الأول فقط. */
  async function undoEntries(w, c, all) {
    for (const table of ['customer_entries', 'supplier_entries']) {
      const rows = (await db.table(table).toArray()).filter((e) => e.payment_id === c.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      const gone = cancelledIds(rows);
      const live = rows.filter((e) => !isVoidEntry(e) && !gone.has(e.id));
      // قيد الاستلام (الأول، سالب) يبقى عند التراجع عن حدث؛ وكل ما بعده يُلغى
      const first = live.find((e) => e.amount < 0 && ((table === 'customer_entries' && c.direction === 'in') || (table === 'supplier_entries' && c.direction === 'out')));
      for (const e of live) {
        if (!all && e === first) continue;
        await w.append(table, chequeUndoEntry(e));
      }
    }
  }

  return repo;
}
