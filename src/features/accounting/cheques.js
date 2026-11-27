// الشيكات: شيك استلمته من زبون أو أعطيته لتاجر، بموعده. الدين ينزل فور تسجيل الشيك، والمال يتحرك حين يُصرف.
// التطبيق يذكّرك قبل الموعد بثلاثة أيام، وبضغطة على الشيك: صُرف، رجع، جيّرته لتاجر، أو أُلغي.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, field, money, emptyState, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { formatMoney } from '../../domain/currency.js';
import { CHEQUE_STATUS, chequeActions, chequeDue, chequeTotals, filterCheques, chequeLabel, chequeReminderText } from '../../domain/cheques.js';
import { dueText, addDays } from '../../domain/dues.js';
import { whatsappLink, normalizePhone } from '../../domain/ledger.js';
import { normalizeArabic } from '../../domain/product.js';
import { localDay } from '../../domain/offers.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { pickCustomer } from '../customers/picker.js';
import { pickSupplier } from '../inventory/suppliers.js';
import { cur, amountInput, moneyPicker } from './common.js';

const openLink = (url) => { const native = globalThis.Capacitor?.isNativePlatform?.(); const w = native ? null : window.open(url, '_blank', 'noopener'); if (!w) window.location.href = url; };
const dayText = (d) => { const [y, m, dd] = String(d).split('-'); return `${dd}/${m}/${y}`; };
const TAG = { cleared: '', bounced: 'bad', endorsed: 'warn', cancelled: 'bad' };

/**
 * ورقة شيك جديد. direction: 'in' استلمته، 'out' أعطيته. party: زبون أو تاجر معروف سلفًا (من صفحته).
 * amount: مبلغ مقترح. onSaved(cheque).
 */
export function newChequeSheet({ direction = 'in', party = null, partyType = null, amount: preset = null, onSaved = null } = {}) {
  const isIn = direction === 'in';
  let type = partyType || (isIn ? 'customer' : 'supplier');
  let who = party;
  const amount = amountInput(preset);
  const number = input({ maxlength: 30, inputmode: 'numeric', dir: 'ltr', placeholder: 'رقم الشيك' });
  const bank = input({ maxlength: 40, placeholder: 'مثال: بنك فلسطين' });
  const other = input({ maxlength: 60, placeholder: isIn ? 'اسم صاحب الشيك' : 'اسم من أخذ الشيك' });
  const due = input({ type: 'date', dir: 'ltr', value: addDays(localDay(), 30), min: addDays(localDay(), -365) });
  const note = input({ maxlength: 120, placeholder: 'ملاحظة (اختياري)' });
  const mainType = isIn ? 'customer' : 'supplier';
  const kinds = h('div', { class: 'chips' });
  const detail = h('div');
  const quick = h('div', { class: 'chips pay-quick' }, ...[[7, 'بعد أسبوع'], [30, 'بعد شهر'], [60, 'بعد شهرين'], [90, 'بعد 3 شهور']].map(([n, label]) =>
    h('button', { class: 'chip', type: 'button', onclick: () => { due.value = addDays(localDay(), n); } }, label)));
  async function choose() {
    const p = mainType === 'customer' ? await pickCustomer() : await pickSupplier();
    if (p) { who = p; paint(); if (!amount.el.value && p.balance > 0) amount.el.select(); amount.el.focus(); }
  }
  function paint() {
    fill(kinds,
      h('button', { class: `chip ${type === mainType ? 'on' : ''}`, type: 'button', onclick: () => { type = mainType; paint(); if (!who) choose(); } }, icon(isIn ? 'user' : 'truck', 16), isIn ? 'من زبون' : 'لتاجر'),
      h('button', { class: `chip ${type === 'other' ? 'on' : ''}`, type: 'button', onclick: () => { type = 'other'; paint(); other.focus(); } }, isIn ? 'من غيره' : 'لغيره'));
    fill(detail, type === 'other' ? field(isIn ? 'ممّن الشيك؟' : 'لمن الشيك؟', other)
      : h('button', { class: 'row row-tap picked-party', type: 'button', onclick: party ? null : choose, disabled: !!party },
        h('span', { class: 'row-ic' }, icon(isIn ? 'user' : 'truck', 20)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, who ? who.name : (isIn ? 'اختر الزبون' : 'اختر التاجر')),
          who && who.balance > 0 ? h('span', { class: 'row-sub' }, isIn ? 'عليه ' : 'عليك له ', num(formatMoney(who.balance, cur()))) : null),
        party ? null : icon('chevron', 20, 'row-go')));
  }
  paint();
  let busy = false;
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      try {
        const saved = await app.accounting.saveCheque({
          direction, number: number.value, bank: bank.value, amount: amount.get(), due_date: due.value,
          party_type: type, party_id: type === 'other' ? null : who ? who.id : null, party_name: type === 'other' ? other.value : who ? who.name : null, note: note.value,
        });
        feedback.ok(); close();
        toast(`${isIn ? 'سُجّل الشيك' : 'سُجّل الشيك الصادر'}: ${formatMoney(saved.amount, cur())} — يستحق ${dayText(saved.due_date)}`, { kind: 'ok', ms: 3800, undo: async () => { await app.accounting.removeCheque(saved.id); if (onSaved) onSaved(null); } });
        if (onSaved) onSaved(saved);
      } catch (err) { busy = false; feedback.error(); toast(err.errors?.amount || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  },
    party ? null : h('div', { class: 'field' }, kinds),
    detail,
    field('مبلغ الشيك', amount.el),
    field('تاريخ الاستحقاق', due), quick,
    h('div', { class: 'grid-2' }, field('رقم الشيك', number), field('البنك', bank)),
    field('ملاحظة', note),
    h('p', { class: 'muted small' }, isIn
      ? 'دين الزبون ينزل الآن، والمال يدخل صندوقك حين تصرف الشيك. إن رجع الشيك عاد الدين بضغطة.'
      : 'ما عليك للتاجر ينزل الآن، والمال يخرج من حسابك حين يصرف التاجر الشيك.'),
    button('حفظ الشيك', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
  ), { title: isIn ? 'شيك استلمته' : 'شيك أعطيته' });
  if (who || type === 'other') amount.focus(); else setTimeout(choose, 200);
}

/** يفتح شيكًا برقمه: تفاصيله وما يمكن فعله به الآن. */
export async function openCheque(id, onChanged = null) {
  const c = await app.accounting.cheque(id);
  if (!c) { toast('الشيك غير موجود', { kind: 'error' }); return; }
  const isIn = c.direction === 'in';
  const actions = app.can('cash') ? chequeActions(c) : [];
  const st = c.status === 'pending' ? chequeDue(c, localDay()) : null;
  const kv = (label, value) => (value ? h('div', { class: 'rc-kv' }, h('span', null, label), h('span', null, value)) : null);
  const customer = isIn && c.party_type === 'customer' && c.party_id ? await app.db.customers.get(c.party_id) : null;
  const accountName = c.status === 'cleared' ? await app.accounting.moneyName(c.account) : null;
  const changed = () => { if (onChanged) onChanged(); };
  const act = async (close, fn, message) => {
    try {
      await fn();
      feedback.ok(); close();
      toast(message, { kind: 'ok', ms: 4500, undo: async () => { await app.accounting.chequeUndo(c.id); changed(); } });
      changed();
    } catch (err) { feedback.error(); toast(err.errors?.amount || 'تعذّر الحفظ', { kind: 'error' }); }
  };

  openSheet((close) => {
    async function clear() {
      const choices = await app.accounting.moneyChoices();
      // الشيك يُصرف غالبًا في البنك؛ وإن لم يكن للمحل حساب بنك ففي الدرج
      const bankFirst = choices.find((x) => !x.drawer) || choices[0];
      const pick = moneyPicker(choices, { selected: bankFirst ? bankFirst.id : undefined });
      openSheet((close2) => h('div', null,
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, isIn ? 'أين دخل مال الشيك؟' : 'من أين خرج مال الشيك؟'), pick.el),
        button(isIn ? 'صُرف الشيك' : 'صُرف من حسابي', { block: true, size: 'lg', icon: 'check', onclick: async () => {
          const box = pick.get();
          if (!box) { feedback.error(); toast('اختر الصندوق', { kind: 'error' }); return; }
          close2();
          await act(close, () => app.accounting.chequeAction(c.id, 'clear', { accountId: box.id }), `صُرف الشيك: ${formatMoney(c.amount, cur())} ${isIn ? 'دخل' : 'خرج من'} ${box.name}`);
        } })), { title: 'صرف الشيك' });
    }
    async function endorse() {
      const s = await pickSupplier({ title: 'لأي تاجر أعطيت الشيك؟' });
      if (!s) return;
      await act(close, () => app.accounting.chequeAction(c.id, 'endorse', { supplierId: s.id, supplierName: s.name }), `جُيّر الشيك إلى ${s.name} — نزل مما عليك له ${formatMoney(c.amount, cur())}`);
    }
    return h('div', null,
      h('div', { class: `balance-card ${isIn ? 'clear' : 'owed'}` },
        h('div', { class: 'hero-label' }, isIn ? `شيك لك${c.party_name ? ` من ${c.party_name}` : ''}` : `شيك عليك${c.party_name ? ` لـ ${c.party_name}` : ''}`),
        h('div', { class: 'hero-value' }, money(c.amount)),
        h('div', { class: 'hero-mini-label' }, c.status === 'pending' ? ['يستحق ', num(dayText(c.due_date)), ` — ${dueText(st.days)}`] : CHEQUE_STATUS[c.status])),
      h('div', { class: 'card' },
        kv('رقم الشيك', c.number ? num(c.number) : null), kv('البنك', c.bank), kv('تاريخ الاستحقاق', num(dayText(c.due_date))),
        kv('الحالة', CHEQUE_STATUS[c.status]), kv(isIn ? 'دخل إلى' : 'خرج من', accountName), kv('جُيّر إلى', c.endorsed_name), kv('ملاحظة', c.note)),
      actions.includes('clear') ? button(isIn ? 'صُرف — دخل المال' : 'صُرف — خرج المال من حسابي', { block: true, size: 'lg', icon: 'check', onclick: clear }) : null,
      actions.includes('endorse') ? button('جيّرته لتاجر (دفعت به ما عليّ)', { kind: 'outline', block: true, icon: 'truck', onclick: endorse }) : null,
      actions.includes('bounce') ? button(c.status === 'endorsed' ? 'رجع الشيك المجيَّر' : 'رجع الشيك (بلا رصيد)', { kind: 'outline', block: true, icon: 'undo',
        onclick: () => act(close, () => app.accounting.chequeAction(c.id, 'bounce'), c.party_type === 'customer' ? `رجع الشيك — عاد ${formatMoney(c.amount, cur())} دينًا على ${c.party_name || 'الزبون'}` : 'سُجّل رجوع الشيك') }) : null,
      actions.includes('cancel') ? button('أُلغي الشيك أو رجع', { kind: 'outline', block: true, icon: 'undo',
        onclick: () => act(close, () => app.accounting.chequeAction(c.id, 'cancel'), c.party_type === 'supplier' ? `أُلغي الشيك — عاد ${formatMoney(c.amount, cur())} عليك لـ ${c.party_name || 'التاجر'}` : 'أُلغي الشيك') }) : null,
      isIn && c.status === 'pending' && c.party_name ? button('ذكّره بموعد الشيك واتساب', { kind: 'outline', block: true, icon: 'chat', onclick: () => {
        if (!normalizePhone(customer?.phone)) toast('لا رقم جوال محفوظ — اختر جهة الاتصال من واتساب');
        openLink(whatsappLink(customer?.phone, chequeReminderText({ shopName: app.shop.name, cheque: c, currency: cur() })));
      } }) : null,
      c.status !== 'pending' && app.can('cash') ? button('تراجع: أعده «بانتظار الصرف»', { kind: 'text', onclick: async () => { await app.accounting.chequeUndo(c.id); feedback.ok(); close(); toast('عاد الشيك بانتظار الصرف', { kind: 'ok' }); changed(); } }) : null,
      actions.includes('remove') && app.can('delete') ? h('button', { class: 'btn btn-text btn-block btn-danger-text', type: 'button', onclick: async () => {
        try { await app.accounting.removeCheque(c.id); feedback.ok(); close(); toast('حُذف الشيك وأُلغي أثره من الحساب', { kind: 'ok' }); changed(); } catch (err) { feedback.error(); toast(err.errors?.amount || 'تعذّر الحذف', { kind: 'error' }); }
      } }, icon('trash', 20), h('span', null, 'حذف الشيك (سُجّل خطأ)')) : null,
    );
  }, { title: chequeLabel(c) });
}

export function renderCheques(el, params) {
  let all = [];
  let direction = params && params.dir === 'out' ? 'out' : 'in';
  let status = 'pending';
  let query = '';
  const tabs = h('div', { class: 'debt-tabs', role: 'group', 'aria-label': 'الشيكات' });
  const chips = h('div', { class: 'chips acc-filter' });
  const body = h('div');
  const search = input({ type: 'search', placeholder: 'ابحث بالاسم أو رقم الشيك أو البنك', autocomplete: 'off', oninput: (e) => { query = e.target.value; paint(); } });
  const canWrite = app.can('cash');
  const addBtn = h('div');

  el.append(header('الشيكات', { back: true }), h('div', { class: 'page' }, tabs, addBtn, h('div', { class: 'search-row' }, icon('search', 20), search), chips, body));

  function paint() {
    const t = chequeTotals(all);
    const tab = (dir, title, sub, total) => h('button', {
      class: `debt-tab debt-tab-${dir === 'in' ? 'customers' : 'suppliers'} ${direction === dir ? 'on' : ''}`, type: 'button', 'aria-pressed': direction === dir ? 'true' : 'false',
      onclick: () => { direction = dir; paint(); },
    }, h('span', { class: 'debt-tab-title' }, title), h('span', { class: 'debt-tab-sub' }, sub), h('span', { class: 'debt-tab-amt' }, money(total)));
    fill(tabs, tab('in', 'شيكات لك', `${t.inCount} بانتظار الصرف`, t.inTotal), tab('out', 'شيكات عليك', `${t.outCount} بانتظار الصرف`, t.outTotal));
    fill(addBtn, canWrite ? button(direction === 'in' ? 'استلمت شيكًا' : 'أعطيت شيكًا', { block: true, size: 'lg', icon: 'plus', onclick: () => newChequeSheet({ direction, onSaved: load }) }) : null);
    fill(chips, ...[['pending', 'بانتظار الصرف'], ['done', 'المنتهية'], ['', 'الكل']].map(([k, label]) => h('button', { class: `chip ${status === k ? 'on' : ''}`, type: 'button', onclick: () => { status = k; paint(); } }, label)));
    const list = filterCheques(all, { direction, status, query }, normalizeArabic);
    if (!list.length) {
      fill(body, emptyState('cheque', query ? 'لا شيك يطابق البحث' : status === 'done' ? 'لا شيكات منتهية' : direction === 'in' ? 'لا شيكات لك بانتظار الصرف' : 'لا شيكات عليك بانتظار الصرف',
        query || status === 'done' ? '' : direction === 'in' ? 'أعطاك زبون شيكًا؟ سجّله هنا بموعده: دينه ينزل الآن، ونذكّرك قبل الموعد بثلاثة أيام.' : 'أعطيت تاجرًا شيكًا؟ سجّله بموعده حتى لا يفاجئك يوم صرفه.'));
      return;
    }
    const today = localDay();
    const when = (c) => (c.status === 'pending' ? dueText(chequeDue(c, today).days) : CHEQUE_STATUS[c.status]);
    const tone = (c) => { if (c.status !== 'pending') return ''; const s = chequeDue(c, today).state; return s === 'overdue' || s === 'today' ? 'danger' : s === 'soon' ? 'warn' : ''; };
    const open = (c) => openCheque(c.id, load);
    if (isWide()) {
      fill(body, dataTable({
        rows: list, onRow: open,
        columns: [
          { key: 'who', label: direction === 'in' ? 'ممّن' : 'لمن', grow: true, by: (c) => c.party_name || '', cell: (c) => c.party_name || '—' },
          { key: 'number', label: 'رقم الشيك', by: (c) => c.number || '', cell: (c) => num(c.number || '') },
          { key: 'bank', label: 'البنك', by: (c) => c.bank || '', cell: (c) => c.bank || '' },
          { key: 'due', label: 'الاستحقاق', by: (c) => c.due_date, cell: (c) => num(dayText(c.due_date)) },
          { key: 'state', label: 'الحالة', by: when, cell: (c) => (c.status === 'pending' ? h('span', { class: `dt-tag ${tone(c) === 'danger' ? 'bad' : tone(c)}` }, when(c)) : h('span', { class: `dt-tag ${TAG[c.status]}` }, CHEQUE_STATUS[c.status])) },
          { key: 'amount', label: 'المبلغ', num: true, by: (c) => c.amount, cell: (c) => money(c.amount) },
        ],
      }));
      return;
    }
    fill(body, h('div', { class: 'list' }, ...list.map((c) => h('button', { class: `row row-tap ${tone(c) ? `row-${tone(c)}` : ''}`, type: 'button', onclick: () => open(c) },
      h('span', { class: 'row-ic' }, icon(c.status === 'pending' ? 'cheque' : c.status === 'cleared' ? 'check' : 'undo', 22)),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, c.party_name || chequeLabel(c)),
        h('span', { class: 'row-sub' }, c.number ? [num(c.number), ' · '] : null, c.bank ? `${c.bank} · ` : '', num(dayText(c.due_date)), ' · ', when(c))),
      h('span', { class: 'row-end strong' }, money(c.amount))))));
  }
  async function load() { all = await app.accounting.cheques(); paint(); }
  load();
  return bus.on('data', (e) => { if (e.tables.includes('cheques')) load(); });
}
