// السندات: سند قبض (مال دخل)، سند صرف (مال خرج)، وتحويل بين الصناديق. ثلاث خطوات: ممّن/لمن ← المبلغ ← أين.
// سند القبض من زبون وسند الصرف لتاجر يسجَّلان في كشفيهما كأي دفعة؛ والمصروف يدخل المصاريف. كل سند برقمه ويُرسل أو يُطبع.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, field, money, emptyState, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { formatMoney } from '../../domain/currency.js';
import { contraChoices, VOUCHER_TITLES } from '../../domain/accounting.js';
import { EXPENSE_CATEGORIES, SALARY, customCategories, categoryName } from '../../domain/expenses.js';
import { matchesInvoiceNumber } from '../../domain/numbering.js';
import { normalizeArabic } from '../../domain/product.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { pickCustomer } from '../customers/picker.js';
import { pickSupplier } from '../inventory/suppliers.js';
import { showVoucher } from '../customers/voucher.js';
import { cur, dateText, amountInput, dateInput, moneyPicker, showMoneyVoucher } from './common.js';

const TONE = { receipt: 'credit', payment: 'owed', transfer: '', journal: '' };
const ICON = { receipt: 'plus', payment: 'minus', transfer: 'swap', journal: 'book' };

/**
 * ورقة سند قبض أو صرف. preset: { party: 'customer'|'supplier'|…, customer, supplier } لفتحها من مكان يعرف الطرف.
 * onSaved() بعد الحفظ.
 */
export async function voucherSheet(type, { onSaved = null, preset = {} } = {}) {
  const isIn = type === 'receipt';
  const choices = await app.accounting.moneyChoices();
  const amount = amountInput();
  const who = input({ maxlength: 60, placeholder: isIn ? 'اسم من دفع (اختياري)' : 'اسم من استلم (اختياري)' });
  const note = input({ maxlength: 120, placeholder: 'ملاحظة (اختياري)' });
  const date = dateInput();
  // لمن / ممّن: زبون أو تاجر (كشف حسابه)، مصروف (بنده)، ثم الحسابات المقابلة الجاهزة والخاصة
  const targets = [
    isIn ? { key: 'customer', label: 'زبون', hint: 'دفعة من دينه', ic: 'user' } : { key: 'supplier', label: 'تاجر', hint: 'دفعة مما عليك له', ic: 'truck' },
    ...(isIn ? [] : [{ key: 'expense', label: 'مصروف', hint: 'كهرباء، إيجار، مواصلات…', ic: 'coins' }]),
    ...contraChoices(type, app.accounting.accounts()).map((c) => ({ ...c, ic: c.key === 'owner' ? 'user' : c.custom ? 'book' : 'tag' })),
  ];
  let target = targets.find((t) => t.key === preset.party) || targets[0];
  let party = preset.customer || preset.supplier || null;
  let category = null;
  const picker = moneyPicker(choices, { outside: null });
  const targetChips = h('div', { class: 'chips' });
  const detail = h('div');
  const hint = h('span', { class: 'field-hint' });

  function paint() {
    fill(targetChips, ...targets.map((t) => h('button', { class: `chip ${target === t ? 'on' : ''}`, type: 'button', onclick: () => { target = t; party = null; paint(); if (t.key === 'customer' || t.key === 'supplier') choose(); } }, icon(t.ic, 16), t.label)));
    hint.textContent = target.hint || '';
    if (target.key === 'customer' || target.key === 'supplier') {
      fill(detail, h('button', { class: 'row row-tap picked-party', type: 'button', onclick: choose },
        h('span', { class: 'row-ic' }, icon(target.ic, 20)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, party ? party.name : (target.key === 'customer' ? 'اختر الزبون' : 'اختر التاجر')),
          party && party.balance > 0 ? h('span', { class: 'row-sub' }, target.key === 'customer' ? 'عليه ' : 'عليك له ', num(formatMoney(party.balance, cur()))) : null),
        icon('chevron', 20, 'row-go')));
    } else if (target.key === 'expense') {
      const custom = customCategories(app.shop?.settings?.expenseCategories);
      fill(detail, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'بند المصروف'), h('div', { class: 'chips' },
        ...EXPENSE_CATEGORIES.filter((c) => c.key !== SALARY).map((c) => h('button', { class: `chip ${category === c.key ? 'on' : ''}`, type: 'button', onclick: () => { category = c.key; paint(); } }, icon(c.icon, 16), c.name)),
        ...custom.map((n) => h('button', { class: `chip ${category === n ? 'on' : ''}`, type: 'button', onclick: () => { category = n; paint(); } }, n)))));
    } else fill(detail, field(isIn ? 'ممّن؟' : 'لمن؟', who));
  }
  async function choose() {
    const p = target.key === 'customer' ? await pickCustomer() : await pickSupplier();
    if (p) { party = p; paint(); amount.focus(); }
  }

  let busy = false;
  const sheet = openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      const v = amount.get();
      const box = picker.get();
      const fail = (msg) => { feedback.error(); toast(msg, { kind: 'error' }); };
      if ((target.key === 'customer' || target.key === 'supplier') && !party) { fail(target.key === 'customer' ? 'اختر الزبون' : 'اختر التاجر'); choose(); return; }
      if (target.key === 'expense' && !category) { fail('اختر بند المصروف'); return; }
      if (!v || v <= 0) { fail('اكتب المبلغ'); amount.el.focus(); return; }
      if (!box) { fail('اختر الصندوق'); return; }
      busy = true;
      try {
        if (target.key === 'customer') {
          const entry = await app.customers.recordPayment(party.id, v, box);
          app.sms.notify('payment', party, v);
          done(close, `استُلمت ${formatMoney(v, cur())} من ${party.name}`);
          if (entry && entry.payment_id) showVoucher(entry.payment_id);
        } else if (target.key === 'supplier') {
          const entry = await app.inventory.paySupplier(party.id, v, { method: box, note: note.value });
          done(close, `دُفع ${formatMoney(v, cur())} لـ ${party.name}`);
          await openSaved((x) => x.source === 'supplier' && x.id === entry.payment_id);
        } else if (target.key === 'expense') {
          const saved = await app.accounting.saveExpenseVoucher({ category, amount: v, method: box, note: note.value, party_name: who.value, date: date.get() });
          done(close, `سُجّل مصروف ${categoryName(category)}: ${formatMoney(v, cur())}`);
          await openSaved((x) => x.source === 'voucher' && x.id === saved.id);
        } else {
          const saved = await app.accounting.saveVoucher({ type, amount: v, account: box.id, contra: target.key, party_name: who.value, note: note.value, date: date.get() });
          done(close, `${VOUCHER_TITLES[type]} ${saved.number}: ${formatMoney(v, cur())}`);
          await openSaved((x) => x.source === 'voucher' && x.id === saved.id);
        }
      } catch (err) { busy = false; feedback.error(); toast(err.errors?.amount || err.message || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, isIn ? 'ممّن استلمت؟' : 'لمن صرفت؟'), targetChips, hint),
    detail,
    field('المبلغ', amount.el),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, isIn ? 'أين دخل المال؟' : 'من أين دُفع؟'), picker.el),
    h('div', { class: 'grid-2' }, field('التاريخ', date.el), field('ملاحظة', note)),
    button(isIn ? 'حفظ سند القبض' : 'حفظ سند الصرف', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
  ), { title: isIn ? 'سند قبض — مال دخل' : 'سند صرف — مال خرج' });

  function done(close, message) {
    feedback.ok(); close();
    toast(message, { kind: 'ok', ms: 3200 });
    if (onSaved) onSaved();
  }
  async function openSaved(match) {
    const item = (await app.accounting.vouchers()).find(match);
    if (item) showMoneyVoucher(item, { onChanged: onSaved });
  }
  paint();
  if (party || (target.key !== 'customer' && target.key !== 'supplier')) amount.focus();
  return sheet;
}

/** تحويل بين صندوقين: من الدرج إلى الخزنة، من المحفظة إلى البنك… لا ربح فيه ولا مصروف، المال يغيّر مكانه فقط. */
export async function transferSheet({ onSaved = null, from = null, to = null, amount: preset = null } = {}) {
  const choices = await app.accounting.moneyChoices();
  if (choices.length < 2) { toast('أضف صندوقًا ثانيًا أولًا (خزنة أو حساب بنك)', { kind: 'info', ms: 4000 }); return null; }
  const amount = amountInput(preset);
  const note = input({ maxlength: 120, placeholder: 'ملاحظة (اختياري)' });
  const date = dateInput();
  const balances = new Map((await app.accounting.money()).map((m) => [m.id, m.balance]));
  const cashId = choices[0].id;
  const have = h('span', { class: 'field-hint' });
  const toPick = moneyPicker(choices, { selected: to || (choices.find((c) => c.id !== (from || cashId)) || {}).id });
  const fromPick = moneyPicker(choices, { selected: from || cashId, onchange: sync });
  function sync() {
    const f = fromPick.get();
    toPick.hide(f ? f.id : null);
    const b = f ? balances.get(f.drawer ? 'drawer' : f.id) : null;
    fill(have, Number.isSafeInteger(b) ? ['فيه الآن ', num(formatMoney(b, cur()))] : '');
  }
  sync();
  let busy = false;
  const sheet = openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      const v = amount.get();
      const f = fromPick.get(), t = toPick.get();
      if (!v || v <= 0) { feedback.error(); toast('اكتب المبلغ', { kind: 'error' }); amount.el.focus(); return; }
      if (!f || !t || f.id === t.id) { feedback.error(); toast('اختر صندوقين مختلفين', { kind: 'error' }); return; }
      busy = true;
      try {
        const saved = await app.accounting.saveVoucher({ type: 'transfer', amount: v, account: f.id, to_account: t.id, note: note.value, date: date.get() });
        feedback.ok(); close();
        toast(`حُوّل ${formatMoney(v, cur())} من ${f.name} إلى ${t.name}`, { kind: 'ok', ms: 3500, undo: async () => { await app.accounting.voidVoucher(saved.id); if (onSaved) onSaved(); } });
        if (onSaved) onSaved();
      } catch (err) { busy = false; feedback.error(); toast(err.errors?.amount || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'من'), fromPick.el, have),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'إلى'), toPick.el),
    field('المبلغ', amount.el),
    h('div', { class: 'grid-2' }, field('التاريخ', date.el), field('ملاحظة', note)),
    button('حوّل', { type: 'submit', block: true, size: 'lg', icon: 'swap' }),
  ), { title: 'تحويل بين الصناديق' });
  amount.focus();
  return sheet;
}

/** صفحة كل السندات: بحث بالرقم أو الاسم، وتصفية بالنوع. */
export function renderVouchers(el) {
  let all = [];
  let type = '';
  let query = '';
  const names = new Map();
  const search = input({ type: 'search', placeholder: 'ابحث برقم السند أو الاسم', autocomplete: 'off', oninput: (e) => { query = e.target.value; paint(); } });
  const chips = h('div', { class: 'chips chips-scroll acc-filter' });
  const body = h('div');
  const canWrite = app.can('cash');

  el.append(header('السندات', { back: true }), h('div', { class: 'page' },
    canWrite ? h('div', { class: 'big-actions' },
      h('button', { class: 'big-btn pay', type: 'button', onclick: () => voucherSheet('receipt', { onSaved: load }) }, icon('plus', 26), h('span', null, 'سند قبض')),
      h('button', { class: 'big-btn debt', type: 'button', onclick: () => voucherSheet('payment', { onSaved: load }) }, icon('minus', 26), h('span', null, 'سند صرف'))) : null,
    h('div', { class: 'search-row' }, icon('search', 20), search),
    chips, body));

  const whoOf = (v) => v.party || app.accounting.contraName(v.type, v.contra) || (v.type === 'transfer' ? `${names.get(v.accountId) || ''} ← ${names.get(v.toId) || ''}` : v.note || VOUCHER_TITLES[v.type]);
  function paint() {
    fill(chips, ...[['', 'الكل'], ['receipt', 'قبض'], ['payment', 'صرف'], ['transfer', 'تحويل'], ['journal', 'قيود']].map(([k, label]) =>
      h('button', { class: `chip ${type === k ? 'on' : ''}`, type: 'button', onclick: () => { type = k; paint(); } }, label)));
    const q = normalizeArabic(query);
    const list = all.filter((v) => (!type || v.type === type) && (!q || matchesInvoiceNumber(v.number || '', query) || normalizeArabic(whoOf(v)).includes(q) || normalizeArabic(v.note || '').includes(q)));
    if (!list.length) {
      fill(body, emptyState('receipt', all.length ? 'لا سند يطابق البحث' : 'لا سندات بعد', all.length ? '' : 'سند القبض لمال دخل المحل، وسند الصرف لمال خرج منه. كل دفعة من زبون أو لتاجر تظهر هنا بسندها أيضًا.'));
      return;
    }
    const sign = (v) => (v.type === 'receipt' ? '+' : v.type === 'payment' ? '−' : '');
    const open = (v) => showMoneyVoucher(v, { onChanged: load, doneLabel: 'إغلاق' });
    if (isWide()) {
      fill(body, dataTable({
        rows: list, onRow: open, rowClass: (v) => (v.cancelled ? 'dt-cancelled' : ''),
        columns: [
          { key: 'number', label: 'الرقم', by: (v) => v.number, cell: (v) => num(v.number || '') },
          { key: 'date', label: 'التاريخ', by: (v) => v.date, cell: (v) => num(dateText(v.date)) },
          { key: 'type', label: 'النوع', by: (v) => v.type, cell: (v) => [VOUCHER_TITLES[v.type], v.cancelled ? [' ', h('span', { class: 'tag-cancelled' }, 'ملغى')] : null] },
          { key: 'who', label: 'البيان', grow: true, by: whoOf, cell: (v) => [whoOf(v), v.note && v.party ? h('span', { class: 'muted' }, ` · ${v.note}`) : null] },
          { key: 'box', label: 'الصندوق', by: (v) => names.get(v.accountId) || '', cell: (v) => names.get(v.accountId) || '' },
          { key: 'amount', label: 'المبلغ', num: true, by: (v) => v.amount, cell: (v) => h('span', { class: v.cancelled ? '' : TONE[v.type] }, money(v.amount)) },
        ],
      }));
      return;
    }
    fill(body, h('div', { class: 'list' }, ...list.map((v) => h('button', { class: `row row-tap ${v.cancelled ? 'entry-cancelled' : ''}`, type: 'button', onclick: () => open(v) },
      h('span', { class: `row-ic ${v.type === 'payment' ? 'ic-debt' : ''}` }, icon(ICON[v.type], 20)),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, whoOf(v), v.cancelled ? [' ', h('span', { class: 'tag-cancelled' }, 'ملغى')] : null),
        h('span', { class: 'row-sub' }, VOUCHER_TITLES[v.type], ' ', num(v.number || ''), ' · ', num(dateText(v.date)), names.get(v.accountId) && v.type !== 'transfer' ? ` · ${names.get(v.accountId)}` : '')),
      h('span', { class: `row-end ${v.cancelled ? '' : TONE[v.type]}` }, num(`${sign(v)}${formatMoney(v.amount, cur(), { symbol: false })}`))))));
  }
  async function load() {
    const [list, money] = await Promise.all([app.accounting.vouchers(), app.accounting.money()]);
    all = list;
    names.clear();
    for (const m of money) names.set(m.id, m.kind === 'drawer' ? 'الدرج' : m.name);
    for (const c of await app.accounting.moneyChoices()) if (c.drawer) names.set(c.id, 'الدرج');
    paint();
  }
  load();
  return bus.on('data', (e) => { if (e.tables.some((t) => ['vouchers', 'payments', 'expenses', 'customer_entries', 'supplier_entries'].includes(t))) load(); });
}
