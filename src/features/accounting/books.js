// دفاتر المحاسب: ميزان المراجعة، دفتر الأستاذ ودليل الحسابات، قيود اليومية (مع قيد يدوي)، قائمة الدخل والميزانية.
// لا شيء هنا يُدخَل باليد إلا القيد اليدوي: الدفاتر تُكتب وحدها من البيع والشراء والدفعات والمصاريف والشيكات والسندات.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, field, money, emptyState, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { formatMoney, parseMoney } from '../../domain/currency.js';
import {
  trialBalance, accountLedger, incomeStatement, balanceSheet, balances, journalTotals, journalProblem, ACCOUNT_TYPES, TYPE_ORDER,
} from '../../domain/accounting.js';
import { normalizeArabic } from '../../domain/product.js';
import { matchesInvoiceNumber } from '../../domain/numbering.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { showReceipt } from '../sale/receipt.js';
import { exportSections } from '../reports/reports.js';
import { cur, dateText, amt, periodPicker, dateInput, canBooks, showVoucherById, amountInput } from './common.js';
import { openCheque } from './cheques.js';

const plainMoney = (v) => formatMoney(v, cur(), { symbol: false });
const side = (v) => (v > 0 ? 'مدين' : v < 0 ? 'دائن' : '');
const exportBar = (onExport) => h('div', { class: 'product-actions' },
  button('PDF', { kind: 'outline', icon: 'receipt', onclick: () => onExport('pdf') }),
  button('Excel', { kind: 'outline', icon: 'clipboard', onclick: () => onExport('xlsx') }));

/** من لا يرى الأرباح لا يرى الدفاتر (فيها التكلفة والربح والرواتب). */
function guard(el, title) {
  if (canBooks()) return false;
  el.append(header(title, { back: true }), h('div', { class: 'page' }, emptyState('lock', 'للمحاسب وصاحب المحل', 'هذه الصفحة تعرض الأرباح والتكلفة. يفتحها صاحب المحل ومن أعطاه «التقارير» و«يرى الأرباح».')));
  return true;
}

/** يفتح مصدر قيد: الفاتورة، كشف الزبون أو التاجر، السند، أو الشيك. */
function openSource(ref, reload) {
  if (!ref) return;
  if (ref.type === 'invoice') showReceipt(ref.id, { doneLabel: 'إغلاق', doneIcon: 'x' });
  else if (ref.type === 'customer' && ref.id) navigate(`/customers/view?id=${ref.id}`);
  else if (ref.type === 'supplier' && ref.id) navigate(`/suppliers/view?id=${ref.id}`);
  else if (ref.type === 'voucher') showVoucherById(ref.id, { onChanged: reload, doneLabel: 'إغلاق' });
  else if (ref.type === 'cheque') openCheque(ref.id, reload);
  else if (ref.type === 'expense') navigate('/expenses');
  else if (ref.type === 'drawer') navigate('/cash');
}

// ---------- ميزان المراجعة ----------
export function renderTrial(el) {
  if (guard(el, 'ميزان المراجعة')) return undefined;
  const top = h('div');
  const body = h('div');
  let range = { from: null, to: null, label: 'كل المدة' };
  let tb = null;
  const picker = periodPicker((r) => { range = r; load(); });
  el.append(header('ميزان المراجعة', { back: true }), h('div', { class: 'page' }, picker.el, top, body));

  const link = (r) => `/accounting/ledger?account=${encodeURIComponent(r.key)}${range.from ? `&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : ''}`;
  async function load() {
    const b = await app.accounting.books();
    tb = trialBalance(b.entries, b.chart, range);
    const t = tb.totals;
    fill(top,
      h('div', { class: `balance-card ${tb.balanced ? 'clear' : 'owed'}` },
        h('div', { class: 'hero-label' }, tb.balanced ? 'الميزان متوازن ✓' : 'الميزان غير متوازن'),
        h('div', { class: 'hero-value' }, money(t.debit)),
        h('div', { class: 'hero-mini-label' }, 'مجموع المدين = مجموع الدائن — ', range.label)),
      tb.rows.length ? exportBar(doExport) : null);
    if (!tb.rows.length) { fill(body, emptyState('scale', 'لا حركات في هذه المدة', 'الميزان يُكتب وحده من البيع والشراء والدفعات والمصاريف. بِع أو اشترِ وسيظهر هنا.')); return; }
    const hasOpening = !!range.from && tb.rows.some((r) => r.opening);
    if (isWide()) {
      fill(body, dataTable({
        rows: tb.rows, onRow: (r) => navigate(link(r)), sort: null, pageSize: 300,
        columns: [
          { key: 'code', label: 'الرمز', by: (r) => r.code, cell: (r) => num(r.code) },
          { key: 'name', label: 'الحساب', grow: true, by: (r) => r.name, cell: (r) => r.name },
          { key: 'type', label: 'النوع', by: (r) => TYPE_ORDER.indexOf(r.type), cell: (r) => h('span', { class: 'muted' }, ACCOUNT_TYPES[r.type].name) },
          ...(hasOpening ? [{ key: 'opening', label: 'رصيد سابق', num: true, by: (r) => r.opening, cell: (r) => (r.opening ? [amt(Math.abs(r.opening)), ' ', h('span', { class: 'muted small' }, side(r.opening))] : '') }] : []),
          { key: 'debit', label: 'مدين', num: true, by: (r) => r.debit, cell: (r) => (r.debit ? amt(r.debit) : '') },
          { key: 'credit', label: 'دائن', num: true, by: (r) => r.credit, cell: (r) => (r.credit ? amt(r.credit) : '') },
          { key: 'cd', label: 'الرصيد مدين', num: true, by: (r) => Math.max(0, r.closing), cell: (r) => (r.closing > 0 ? h('strong', null, amt(r.closing)) : '') },
          { key: 'cc', label: 'الرصيد دائن', num: true, by: (r) => Math.max(0, -r.closing), cell: (r) => (r.closing < 0 ? h('strong', null, amt(-r.closing)) : '') },
        ],
      }), totalsCard(t));
      return;
    }
    fill(body, ...TYPE_ORDER.map((type) => {
      const rows = tb.rows.filter((r) => r.type === type);
      if (!rows.length) return null;
      return h('div', { class: 'section' }, h('h2', { class: 'section-title' }, ACCOUNT_TYPES[type].name),
        h('div', { class: 'list' }, ...rows.map((r) => h('button', { class: 'row row-tap', type: 'button', onclick: () => navigate(link(r)) },
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, r.name),
            h('span', { class: 'row-sub' }, num(r.code), ' · مدين ', num(plainMoney(r.debit)), ' · دائن ', num(plainMoney(r.credit)))),
          h('span', { class: 'row-end acc-bal' }, h('strong', null, amt(Math.abs(r.closing))), h('span', { class: 'muted small' }, side(r.closing)))))));
    }), totalsCard(t));
  }
  function totalsCard(t) {
    const kv = (label, a, b) => h('div', { class: 'rc-kv' }, h('span', null, label), h('span', null, num(plainMoney(a)), ' = ', num(plainMoney(b))));
    return h('div', { class: 'card acc-totals' }, kv('مجموع الحركة (مدين = دائن)', t.debit, t.credit), kv('مجموع الأرصدة (مدين = دائن)', t.closingDebit, t.closingCredit));
  }
  function doExport(type) {
    const rows = tb.rows.map((r) => [`${r.code} ${r.name}`, plainMoney(r.debit), plainMoney(r.credit), r.closing > 0 ? plainMoney(r.closing) : '', r.closing < 0 ? plainMoney(-r.closing) : '']);
    rows.push(['المجموع', plainMoney(tb.totals.debit), plainMoney(tb.totals.credit), plainMoney(tb.totals.closingDebit), plainMoney(tb.totals.closingCredit)]);
    exportSections({ type, title: 'ميزان المراجعة', sub: `${app.shop.name} — ${range.label}`, name: 'trial-balance', sections: [{ title: 'ميزان المراجعة', head: ['الحساب', 'مدين', 'دائن', 'رصيد مدين', 'رصيد دائن'], rows }] });
  }
  load();
  return bus.on('data', load);
}

// ---------- دفتر الأستاذ ودليل الحسابات ----------
export function renderLedger(el, params) {
  const key = params && params.account ? params.account : null;
  if (!key) return renderChart(el);
  // حركة صندوق تُفتح من «الصناديق» لمن له الصندوق؛ باقي الحسابات للمحاسب
  const isMoney = key === 'drawer' || key.startsWith('box:') || key.startsWith('method:');
  if (!(isMoney && app.can('cash')) && guard(el, 'دفتر الأستاذ')) return undefined;
  const top = h('div');
  const body = h('div');
  let led = null;
  let info = null;
  const title = h('h1', null, 'دفتر الأستاذ');
  const picker = periodPicker((r) => { range = r; load(); }, 'all', params.from && params.to ? { from: params.from, to: params.to } : null);
  let range = picker.range();
  el.append(
    h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'رجوع', onclick: () => history.back() }, icon('back')),
      h('div', { class: 'topbar-title' }, title), h('div', { class: 'topbar-actions' })),
    h('div', { class: 'page' }, picker.el, top, body));

  async function load() {
    const b = await app.accounting.books();
    info = b.chart.info(key);
    led = accountLedger(b.entries, key, range);
    title.textContent = info.name;
    const debitNature = ACCOUNT_TYPES[info.type].debit;
    const shown = debitNature ? led.closing : -led.closing;
    fill(top,
      h('div', { class: `balance-card ${shown < 0 ? 'owed' : 'clear'}` },
        h('div', { class: 'hero-label' }, isMoney ? 'الرصيد الآن' : `الرصيد (${side(led.closing) || 'صفر'})`),
        h('div', { class: 'hero-value' }, money(isMoney ? led.closing : Math.abs(led.closing))),
        h('div', { class: 'hero-mini-label' }, num(info.code), ' · ', ACCOUNT_TYPES[info.type].name, ' · ', range.label)),
      // صندوق أو حساب بنك: «كم فيه فعلًا؟» يصحّح رصيده برقم واحد (الدرج يُصحَّح بإغلاق الصندوق)
      isMoney && key !== 'drawer' && app.can('cash') ? button('صحّح الرصيد: كم فيه فعلًا الآن؟', { kind: 'outline', block: true, icon: 'check', onclick: async () => correctSheet(await app.accounting.balanceOf(key)) }) : null,
      led.rows.length ? exportBar(doExport) : null);
    if (!led.rows.length && !led.opening) { fill(body, emptyState('book', 'لا حركات على هذا الحساب في هذه المدة')); return; }
    const rows = [...led.rows].reverse();
    const reload = () => load();
    const inLabel = isMoney ? 'دخل' : 'مدين', outLabel = isMoney ? 'خرج' : 'دائن';
    if (isWide()) {
      fill(body, dataTable({
        rows, onRow: (r) => openSource(r.ref, reload), pageSize: 200,
        columns: [
          { key: 'date', label: 'التاريخ', by: (r) => r.date, cell: (r) => num(dateText(r.date)) },
          { key: 'number', label: 'المرجع', by: (r) => r.number || '', cell: (r) => num(r.number || '') },
          { key: 'memo', label: 'البيان', grow: true, cell: (r) => r.memo },
          { key: 'debit', label: inLabel, num: true, by: (r) => r.debit, cell: (r) => (r.debit ? h('span', { class: isMoney ? 'credit' : '' }, amt(r.debit)) : '') },
          { key: 'credit', label: outLabel, num: true, by: (r) => r.credit, cell: (r) => (r.credit ? h('span', { class: isMoney ? 'owed' : '' }, amt(r.credit)) : '') },
          { key: 'balance', label: 'الرصيد', num: true, cell: (r) => [amt(Math.abs(r.balance)), isMoney ? (r.balance < 0 ? ' −' : '') : [' ', h('span', { class: 'muted small' }, side(r.balance))]] },
        ],
      }), led.opening ? h('p', { class: 'muted small' }, 'رصيد سابق قبل المدة: ', num(plainMoney(Math.abs(led.opening))), ' ', side(led.opening)) : null);
      return;
    }
    fill(body, h('div', { class: 'list' }, ...rows.map((r) => {
      const tap = r.ref && r.ref.type !== 'box';
      return h(tap ? 'button' : 'div', { class: `row ${tap ? 'row-tap' : ''}`, type: tap ? 'button' : null, onclick: tap ? () => openSource(r.ref, reload) : null },
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, r.memo),
          h('span', { class: 'row-sub' }, num(dateText(r.date)), r.number ? [' · ', num(r.number)] : null, ' · الرصيد ', num(plainMoney(Math.abs(r.balance))), isMoney ? '' : ` ${side(r.balance)}`)),
        h('span', { class: `row-end ${isMoney ? (r.debit ? 'credit' : 'owed') : ''}` }, num(`${r.debit ? (isMoney ? '+' : '') : (isMoney ? '−' : '')}${plainMoney(r.debit || r.credit)}`), isMoney ? null : h('span', { class: 'muted small' }, r.debit ? ' مدين' : ' دائن')));
    })), led.opening ? h('p', { class: 'muted small' }, 'رصيد سابق قبل المدة: ', num(plainMoney(Math.abs(led.opening))), ' ', side(led.opening)) : null);
  }
  function correctSheet(current) {
    const actual = amountInput();
    let reason = 'opening';
    const chips = h('div', { class: 'chips' });
    const live = h('div');
    const paint = () => fill(chips,
      h('button', { class: `chip ${reason === 'opening' ? 'on' : ''}`, type: 'button', onclick: () => { reason = 'opening'; paint(); } }, 'مال كان فيه من قبل'),
      h('button', { class: `chip ${reason === 'diff' ? 'on' : ''}`, type: 'button', onclick: () => { reason = 'diff'; paint(); } }, 'رسوم بنك أو فرق'));
    paint();
    actual.el.addEventListener('input', () => {
      if (!actual.el.value.trim()) { fill(live); return; }
      const d = actual.get() - current;
      fill(live, h('div', { class: `pay-change ${d < 0 ? 'bad' : 'ok'}` }, h('span', null, d === 0 ? 'مطابق تمامًا' : d > 0 ? 'يُضاف' : 'يُنقص'), money(Math.abs(d))));
    });
    let busy = false;
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (busy || !actual.el.value.trim()) { actual.el.focus(); return; }
        busy = true;
        try {
          const v = await app.accounting.correctBalance(key.slice(key.indexOf(':') + 1), actual.get(), reason);
          feedback.ok(); close();
          toast(v ? `صُحّح الرصيد بسند ${v.number}` : 'الرصيد مطابق — لا تغيير', { kind: 'ok', undo: v ? async () => { await app.accounting.voidVoucher(v.id); load(); } : null });
          load();
        } catch (err) { busy = false; feedback.error(); toast(err.errors?.amount || 'تعذّر الحفظ', { kind: 'error' }); }
      },
    }, h('div', { class: 'pay-total' }, h('span', null, 'المسجَّل في التطبيق'), money(current)),
      field('كم فيه فعلًا الآن؟', actual.el), live,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'سبب الفرق'), chips),
      button('صحّح الرصيد', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: `تصحيح رصيد ${info.name}` });
    actual.focus();
  }
  function doExport(type) {
    const rows = led.rows.map((r) => [`${dateText(r.date)} ${r.memo}${r.number ? ` ${r.number}` : ''}`, r.debit ? plainMoney(r.debit) : '', r.credit ? plainMoney(r.credit) : '', `${plainMoney(Math.abs(r.balance))} ${side(r.balance)}`]);
    exportSections({ type, title: `دفتر الأستاذ: ${info.name}`, sub: `${app.shop.name} — ${range.label}`, name: 'ledger', sections: [{ title: info.name, head: ['البيان', 'مدين', 'دائن', 'الرصيد'], rows }] });
  }
  load();
  return bus.on('data', load);
}

/** دليل الحسابات: كل حساب برصيده الآن، وإضافة حساب خاص (قرض، أثاث ومعدات، شريك…). */
function renderChart(el) {
  if (guard(el, 'دليل الحسابات')) return undefined;
  const body = h('div');
  el.append(header('دليل الحسابات', { back: true }), h('div', { class: 'page' },
    h('p', { class: 'muted' }, 'اضغط أي حساب لترى دفتر الأستاذ (كل حركاته). الحسابات جاهزة ولا تحتاج إعدادًا؛ أضف حسابًا خاصًا فقط لما ليس له مكان: قرض، أثاث ومعدات، شريك.'),
    button('حساب خاص جديد', { kind: 'outline', block: true, icon: 'plus', onclick: () => accountSheet(load) }), body));
  async function load() {
    const b = await app.accounting.books();
    const bal = balances(b.entries);
    const custom = new Set(app.accounting.accounts().map((a) => `acc:${a.id}`));
    const all = b.chart.all().filter((a) => bal.get(a.key) || custom.has(a.key) || ['drawer', 'ar', 'ap', 'inventory', 'sales', 'cogs', 'capital', 'owner'].includes(a.key));
    fill(body, ...TYPE_ORDER.map((type) => {
      const rows = all.filter((a) => a.type === type);
      if (!rows.length) return null;
      return h('div', { class: 'section' }, h('h2', { class: 'section-title' }, ACCOUNT_TYPES[type].name, h('span', { class: 'muted small' }, ` — ${ACCOUNT_TYPES[type].hint}`)),
        h('div', { class: 'list' }, ...rows.map((a) => {
          const v = bal.get(a.key) || 0;
          return h('div', { class: 'row row-split' },
            h('button', { class: 'row-tap row-body', type: 'button', onclick: () => navigate(`/accounting/ledger?account=${encodeURIComponent(a.key)}`) },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, a.name), h('span', { class: 'row-sub' }, num(a.code), a.custom ? ' · حساب خاص' : '')),
              h('span', { class: 'row-end acc-bal' }, h('strong', null, amt(Math.abs(v))), h('span', { class: 'muted small' }, side(v)))),
            a.custom && !v && app.can('delete') ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `حذف ${a.name}`, onclick: async () => {
              try { await app.accounting.removeAccount(a.key.slice(4)); toast(`حُذف «${a.name}»`, { kind: 'ok' }); load(); } catch (err) { feedback.error(); toast(err.errors?.name || 'تعذّر الحذف', { kind: 'error' }); }
            } }, icon('trash', 20)) : null);
        })));
    }));
  }
  load();
  const off = bus.on('data', load);
  const offShop = bus.on('shop', load);
  return () => { off(); offShop(); };
}

function accountSheet(onSaved) {
  const name = input({ maxlength: 40, placeholder: 'مثال: قرض من أخي، أثاث ومعدات' });
  let type = 'liability';
  const chips = h('div', { class: 'chips' });
  const hint = h('span', { class: 'field-hint' });
  const EX = { asset: 'ما اشتراه المحل ليبقى: ثلاجة، رفوف، سيارة', liability: 'ما على المحل: قرض، دين لغير التجار', equity: 'ما لصاحب المحل أو شريكه: رأس مال، حصة شريك', income: 'دخل غير البيع: إيجار، عمولة', expense: 'مصروف تريد متابعته في حساب وحده' };
  const paint = () => { fill(chips, ...TYPE_ORDER.map((t) => h('button', { class: `chip ${type === t ? 'on' : ''}`, type: 'button', onclick: () => { type = t; paint(); } }, ACCOUNT_TYPES[t].name))); hint.textContent = EX[type]; };
  paint();
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try { const a = await app.accounting.saveAccount({ name: name.value, type }); feedback.ok(); close(); toast(`أُضيف حساب «${a.name}»`, { kind: 'ok' }); if (onSaved) onSaved(a); }
      catch (err) { feedback.error(); toast(err.errors?.name || 'تعذّر الحفظ', { kind: 'error' }); name.focus(); }
    },
  }, field('اسم الحساب', name), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'نوعه'), chips, hint),
    button('أضف الحساب', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: 'حساب خاص جديد' });
  setTimeout(() => name.focus(), 150);
}

// ---------- قيود اليومية ----------
export function renderJournal(el) {
  if (guard(el, 'قيود اليومية')) return undefined;
  const body = h('div');
  let all = [];
  let chart = null;
  let query = '';
  let shown = 60;
  const search = input({ type: 'search', placeholder: 'ابحث في البيان أو برقم الفاتورة أو السند', autocomplete: 'off', oninput: (e) => { query = e.target.value; shown = 60; paint(); } });
  el.append(header('قيود اليومية', { back: true }), h('div', { class: 'page' },
    app.can('cash') ? button('قيد يدوي جديد', { kind: 'outline', block: true, icon: 'plus', onclick: () => journalSheet(load) }) : null,
    h('div', { class: 'search-row' }, icon('search', 20), search), h('div', { class: 'acc-body' }, body)));

  function paint() {
    const q = normalizeArabic(query);
    const list = all.filter((e) => !q || normalizeArabic(e.memo).includes(q) || (e.number && matchesInvoiceNumber(e.number, query)));
    if (!list.length) { fill(body, emptyState('clipboard', all.length ? 'لا قيد يطابق البحث' : 'لا قيود بعد', all.length ? '' : 'كل بيع وشراء ودفعة ومصروف يكتب قيده هنا وحده.')); return; }
    const reload = () => load();
    fill(body, ...list.slice(0, shown).map((e) => {
      const tap = e.ref && e.ref.type !== 'box';
      return h('div', { class: 'card je' },
        h(tap ? 'button' : 'div', { class: `je-head ${tap ? 'row-tap' : ''}`, type: tap ? 'button' : null, onclick: tap ? () => openSource(e.ref, reload) : null },
          h('span', { class: 'je-memo' }, e.memo), h('span', { class: 'je-date' }, e.number ? [num(e.number), ' · '] : null, num(dateText(e.date)))),
        h('table', { class: 'je-lines' }, h('tbody', null, ...e.lines.map((l) => h('tr', { class: l.credit ? 'je-cr' : '' },
          h('td', { class: 'je-acc' }, chart.info(l.account).name),
          h('td', { class: 'je-num' }, l.debit ? amt(l.debit) : ''),
          h('td', { class: 'je-num' }, l.credit ? amt(l.credit) : ''))))));
    }), list.length > shown ? button(`اعرض المزيد (${list.length - shown})`, { kind: 'outline', block: true, onclick: () => { shown += 120; paint(); } }) : null);
  }
  async function load() {
    const b = await app.accounting.books();
    chart = b.chart;
    all = [...b.entries].reverse();
    paint();
  }
  load();
  return bus.on('data', load);
}

/** قيد يدوي: لمن يعرف المحاسبة. سطور مدين ودائن على أي حساب، ولا يُحفظ إلا متوازنًا. */
async function journalSheet(onSaved) {
  const b = await app.accounting.books();
  const accounts = b.chart.all().filter((a) => !a.closed && !a.deleted && a.key !== 'suspense');
  const note = input({ maxlength: 120, placeholder: 'بيان القيد: ماذا حدث؟' });
  const date = dateInput();
  const lines = [{ account: '', side: 'debit', amount: '' }, { account: '', side: 'credit', amount: '' }];
  const box = h('div');
  const totals = h('div');
  const parsed = () => lines.map((l) => { const v = parseMoney(l.amount || '', cur()) || 0; return { account: l.account, debit: l.side === 'debit' ? v : 0, credit: l.side === 'credit' ? v : 0 }; });
  const select = (l) => h('select', { class: 'input', onchange: (e) => { l.account = e.target.value; } },
    h('option', { value: '' }, 'اختر الحساب'),
    ...TYPE_ORDER.map((t) => h('optgroup', { label: ACCOUNT_TYPES[t].name }, ...accounts.filter((a) => a.type === t).map((a) => h('option', { value: a.key, selected: l.account === a.key }, `${a.code} ${a.name}`)))));
  function paintTotals() {
    const t = journalTotals(parsed());
    fill(totals, h('div', { class: `pay-change ${t.diff === 0 && t.debit > 0 ? 'ok' : 'bad'}` },
      h('span', null, t.diff === 0 ? (t.debit > 0 ? 'القيد متوازن' : 'اكتب المبالغ') : t.diff > 0 ? 'ينقص الدائن' : 'ينقص المدين'), t.diff === 0 ? money(t.debit) : money(Math.abs(t.diff))));
  }
  function paint() {
    fill(box, ...lines.map((l, i) => h('div', { class: 'jl' },
      select(l),
      h('div', { class: 'jl-row' },
        h('div', { class: 'chips' },
          h('button', { class: `chip ${l.side === 'debit' ? 'on' : ''}`, type: 'button', onclick: () => { l.side = 'debit'; paint(); } }, 'مدين'),
          h('button', { class: `chip ${l.side === 'credit' ? 'on' : ''}`, type: 'button', onclick: () => { l.side = 'credit'; paint(); } }, 'دائن')),
        input({ dir: 'ltr', inputmode: 'decimal', placeholder: '0', value: l.amount, 'aria-label': 'المبلغ', oninput: (e) => { l.amount = e.target.value; paintTotals(); } }),
        lines.length > 2 ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'احذف السطر', onclick: () => { lines.splice(i, 1); paint(); } }, icon('x', 20)) : null))),
    h('button', { class: 'btn btn-text', type: 'button', onclick: () => { const t = journalTotals(parsed()); lines.push({ account: '', side: t.diff > 0 ? 'credit' : 'debit', amount: '' }); paint(); } }, icon('plus', 18), h('span', null, 'سطر آخر')));
    paintTotals();
  }
  paint();
  let busy = false;
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      const ls = parsed();
      const err = journalProblem(ls);
      if (err) { feedback.error(); toast(err, { kind: 'error', ms: 4000 }); return; }
      busy = true;
      try {
        const saved = await app.accounting.saveVoucher({ type: 'journal', lines: ls, note: note.value, date: date.get() });
        feedback.ok(); close();
        toast(`حُفظ القيد ${saved.number}`, { kind: 'ok', undo: async () => { await app.accounting.voidVoucher(saved.id); if (onSaved) onSaved(); } });
        if (onSaved) onSaved();
      } catch (er) { busy = false; feedback.error(); toast(er.errors?.amount || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  }, field('البيان', note), box, totals, field('التاريخ', date.el),
    button('حفظ القيد', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: 'قيد يومية يدوي' });
  setTimeout(() => note.focus(), 150);
}

// ---------- قائمة الدخل والميزانية ----------
export function renderStatements(el) {
  if (guard(el, 'قائمة الدخل والميزانية')) return undefined;
  const body = h('div');
  let range = { from: null, to: null, label: 'كل المدة' };
  let data = null;
  const picker = periodPicker((r) => { range = r; load(); }, 'month');
  range = picker.range();
  el.append(header('قائمة الدخل والميزانية', { back: true }), h('div', { class: 'page' }, picker.el, body));

  const linkOf = (key) => (key === 'profit' ? null : () => navigate(`/accounting/ledger?account=${encodeURIComponent(key)}`));
  const line = (r) => { const tap = linkOf(r.key); return h(tap ? 'button' : 'div', { class: `row ${tap ? 'row-tap' : ''}`, type: tap ? 'button' : null, onclick: tap }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.name)), h('span', { class: 'row-end' }, money(r.amount))); };
  const total = (label, v, cls = '') => h('div', { class: `row row-total ${cls}` }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label)), h('span', { class: 'row-end strong' }, money(v)));
  const block = (title, rows, totalLabel, totalValue) => h('div', { class: 'section' }, h('h2', { class: 'section-title' }, title),
    h('div', { class: 'list' }, ...(rows.length ? rows.map(line) : [h('div', { class: 'row' }, h('span', { class: 'row-main muted' }, 'لا شيء'))]), total(totalLabel, totalValue)));

  async function load() {
    const b = await app.accounting.books();
    const inc = incomeStatement(b.entries, b.chart, range);
    const bs = balanceSheet(b.entries, b.chart, range.to);
    data = { inc, bs };
    fill(body,
      h('div', { class: `balance-card ${inc.net < 0 ? 'owed' : 'clear'}` },
        h('div', { class: 'hero-label' }, inc.net < 0 ? 'صافي الخسارة' : 'صافي الربح'),
        h('div', { class: 'hero-value' }, money(Math.abs(inc.net))),
        h('div', { class: 'hero-mini-label' }, range.label)),
      exportBar(doExport),
      h('div', { class: 'acc-cols' },
        h('div', null,
          h('h2', { class: 'section-title stmt-title' }, 'قائمة الدخل'),
          block('الإيرادات', inc.income, 'مجموع الإيرادات', inc.totalIncome),
          block('التكاليف والمصاريف', inc.expenses, 'مجموع التكاليف والمصاريف', inc.totalExpenses)),
        h('div', null,
          h('h2', { class: 'section-title stmt-title' }, 'الميزانية العمومية', h('span', { class: 'muted small' }, range.to ? ' — في نهاية المدة' : ' — الآن')),
          block('الأصول (ما يملكه المحل)', bs.assets, 'مجموع الأصول', bs.totals.assets),
          block('الالتزامات (ما عليه)', bs.liabilities, 'مجموع الالتزامات', bs.totals.liabilities),
          block('حقوق الملكية (ما لصاحبه)', bs.equity, 'مجموع حقوق الملكية', bs.totals.equity),
          h('div', { class: 'card acc-totals' }, h('div', { class: 'rc-kv' }, h('span', null, bs.balanced ? 'الأصول = الالتزامات + حقوق الملكية ✓' : 'الميزانية غير متوازنة'),
            h('span', null, num(plainMoney(bs.totals.assets)), ' = ', num(plainMoney(bs.totals.liabilities + bs.totals.equity))))))));
  }
  function doExport(type) {
    const { inc, bs } = data;
    const rows = (list) => list.map((r) => [r.name, plainMoney(r.amount)]);
    exportSections({ type, title: 'قائمة الدخل والميزانية', sub: `${app.shop.name} — ${range.label}`, name: 'statements', sections: [
      { title: 'قائمة الدخل', head: ['البند', 'المبلغ'], rows: [...rows(inc.income), ['مجموع الإيرادات', plainMoney(inc.totalIncome)], ...rows(inc.expenses), ['مجموع التكاليف والمصاريف', plainMoney(inc.totalExpenses)], [inc.net < 0 ? 'صافي الخسارة' : 'صافي الربح', plainMoney(Math.abs(inc.net))]] },
      { title: 'الأصول', head: ['الحساب', 'المبلغ'], rows: [...rows(bs.assets), ['مجموع الأصول', plainMoney(bs.totals.assets)]] },
      { title: 'الالتزامات', head: ['الحساب', 'المبلغ'], rows: [...rows(bs.liabilities), ['مجموع الالتزامات', plainMoney(bs.totals.liabilities)]] },
      { title: 'حقوق الملكية', head: ['الحساب', 'المبلغ'], rows: [...rows(bs.equity), ['مجموع حقوق الملكية', plainMoney(bs.totals.equity)]] },
    ].filter((s) => s.rows.length) });
  }
  load();
  return bus.on('data', load);
}
