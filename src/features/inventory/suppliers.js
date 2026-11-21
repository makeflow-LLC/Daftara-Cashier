// ديون التجار (تجار الجملة والموردون): ما عليك لكل تاجر، «دين جديد» و«دفعت له» بضغطتين، رصيد سابق من
// الدفتر القديم، كشف الحساب مع تعديل وحذف، وإرسال الكشف للتاجر على واتساب للمطابقة.
// مرآة قسم الزبائن: هناك «لك»، وهنا «عليك». الدين اليدوي لا يمسّ المخزون؛ «شراء بفاتورة» يدخل الأصناف.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, iconButton, emptyState, syncBadge, button, money, input, field, dataTable, helpButton } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import { normalizePhone, whatsappLink, editableEntry, SUPPLIER_ENTRY_LABELS, supplierStatementText } from '../../domain/ledger.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { openLink } from '../customers/customers.js';
import { debtTabs } from '../customers/tabs.js';
import { showReceipt } from '../sale/receipt.js';
import { dueStatus, supplierDues } from '../../domain/dues.js';
import { localDay } from '../../domain/offers.js';
import { duePicker, dueSheet, dueStrip, dueBadge, setSupplierDue } from './due.js';

export { dueSheet, dueBadge, setSupplierDue };

const cur = () => app.shop?.base_currency || 'ILS';
const minorOf = () => CURRENCIES[cur()].minor;
const plain = (v) => formatDecimal(v, minorOf(), { trim: true, group: false });
const dateText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : 0);
const ageText = (days) => (days >= 60 ? `منذ ${Math.floor(days / 30)} شهر` : days === 1 ? 'منذ يوم' : days === 2 ? 'منذ يومين' : `منذ ${days} يوم`);

export function editSupplier(s, onSaved, onDelete = null) {
  const name = input({ value: s ? s.name : '', maxlength: 60, placeholder: 'اسم التاجر أو الشركة' });
  const phone = input({ value: s ? s.phone || '' : '', type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: '059xxxxxxx' });
  const opening = input({ dir: 'ltr', inputmode: 'decimal', placeholder: '0' });
  const note = input({ value: s ? s.note || '' : '', maxlength: 120, placeholder: 'مثال: يمرّ كل خميس (اختياري)' });
  let busy = false;
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      const open = s || !opening.value.trim() ? 0 : parseMoney(opening.value, cur());
      if (open === null || open < 0) { feedback.error(); toast('الرصيد السابق غير صحيح', { kind: 'error' }); opening.focus(); return; }
      busy = true;
      try {
        const saved = await app.inventory.saveSupplier({ id: s ? s.id : undefined, name: name.value, phone: phone.value, note: note.value, opening: open });
        feedback.ok(); close();
        if (onSaved) onSaved(saved);
      } catch (err) { busy = false; feedback.error(); toast(err.message, { kind: 'error' }); }
    },
  }, field('الاسم', name), field('رقم الجوال (للواتساب والاتصال)', phone),
    // من الدفتر القديم إلى التطبيق: ما عليك له اليوم، بلا إدخال تاريخ كل فاتورة
    s ? null : field('كم عليك له الآن؟', opening, 'من دفترك القديم. اتركه فارغًا إن لم يكن عليك شيء.'),
    field('ملاحظة', note),
    button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    s && onDelete ? button('حذف التاجر', { kind: 'text', onclick: () => { close(); onDelete(); } }) : null,
  ), { title: s ? 'تعديل التاجر' : 'تاجر جديد' });
  setTimeout(() => { if (!s) name.focus(); }, 200);
}

/** اختيار تاجر (للشراء وطلب البضاعة). يرجع التاجر أو null. */
export function pickSupplier({ title = 'اختر التاجر' } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    const list = h('div', { class: 'list picker-list' });
    openSheet((close) => {
      const pick = (s) => { chosen = s; close(); };
      app.inventory.suppliers().then((all) => fill(list,
        ...all.map((s) => h('button', { class: 'row row-tap', type: 'button', onclick: () => pick(s) },
          h('span', { class: 'row-ic' }, icon('truck', 20)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, s.name)),
          s.balance > 0 ? h('span', { class: 'row-end owed' }, money(s.balance)) : null)),
        h('button', { class: 'row row-tap row-add', type: 'button', onclick: () => editSupplier(null, (s) => pick({ ...s, balance: 0 })) },
          h('span', { class: 'row-ic' }, icon('plus', 20)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'تاجر جديد')))));
      return list;
    }, { title, onClose: () => resolve(chosen) });
  });
}

// ============ القائمة ============
export function renderSuppliers(el) {
  let all = [];
  let query = '';
  const search = input({ type: 'search', placeholder: 'ابحث باسم التاجر أو رقمه', autocomplete: 'off', oninput: (e) => { query = e.target.value; paint(); } });
  const tabs = debtTabs('suppliers');
  const totalEl = h('div');
  const tools = h('div');
  const body = h('div');
  const add = () => editSupplier(null, (s) => navigate(`/suppliers/view?id=${s.id}`));

  el.append(header('التجار', { actions: [syncBadge()] }), h('div', { class: 'page' }, tabs.el, totalEl, tools, body));

  function paint() {
    if (!all.length) {
      fill(totalEl); fill(tools);
      fill(body, emptyState('truck', 'سجّل ما عليك للتجار',
        'أضف تاجر الجملة أو المورّد الذي تأخذ منه بالدين، واكتب كم عليك له الآن. بعدها: كل بضاعة تأخذها «دين جديد»، وكل مبلغ تدفعه «دفعت له» — والباقي يُحسب وحده.',
        button('أضف أول تاجر', { icon: 'plus', size: 'lg', onclick: add })));
      return;
    }
    const owing = all.filter((s) => s.balance > 0);
    const total = owing.reduce((a, s) => a + s.balance, 0);
    const credit = -all.filter((s) => s.balance < 0).reduce((a, s) => a + s.balance, 0);
    const urgent = supplierDues(all, app.dues.map(), localDay());
    fill(totalEl, h('div', { class: `debt-card ${total > 0 ? '' : 'clear'}` },
      h('div', { class: 'hero-label' }, 'عليك للتجار'),
      h('div', { class: 'hero-value' }, money(total)),
      h('div', { class: 'hero-mini-label' }, total > 0 ? `${owing.length} تاجر له عندك من ${all.length}` : 'لا شيء عليك لأي تاجر'),
      urgent.length ? h('div', { class: 'hero-mini-label due-line' }, icon('alert', 14), ' مستحق خلال 3 أيام أو متأخر: ', num(formatMoney(urgent.reduce((a, d) => a + d.supplier.balance, 0), cur()))) : null,
      credit > 0 ? h('div', { class: 'hero-mini-label' }, 'ولك عند التجار ', num(formatMoney(credit, cur()))) : null));
    if (!tools.firstChild) {
      fill(tools,
        h('div', { class: 'search-row' }, icon('search', 20), search),
        h('div', { class: 'product-actions' },
          button('تاجر جديد', { icon: 'plus', onclick: add }),
          button('شراء بفاتورة', { kind: 'outline', icon: 'truck', onclick: () => navigate('/inventory/purchase') })));
    }
    // الأقرب موعدًا أولًا، ثم الأكبر رصيدًا
    const dueOf = (s) => (s.balance > 0 && app.dues.get(s.id) ? app.dues.get(s.id).date : '9999');
    const items = app.inventory.searchSuppliers(all, query).slice().sort((a, b) => (dueOf(a) < dueOf(b) ? -1 : dueOf(a) > dueOf(b) ? 1 : 0));
    if (isWide() && items.length) {
      fill(body, dataTable({
        rows: items,
        onRow: (s) => navigate(`/suppliers/view?id=${s.id}`),
        columns: [
          { key: 'name', label: 'التاجر', grow: true, by: (s) => s.name, cell: (s) => h('span', { class: 'dt-name' }, h('span', { class: `avatar ${s.balance > 0 ? 'owed' : ''}` }, s.name.trim().charAt(0)), h('span', null, s.name)) },
          { key: 'phone', label: 'الجوال', by: (s) => s.phone || '', cell: (s) => (s.phone ? num(s.phone) : h('span', { class: 'muted' }, '—')) },
          { key: 'due', label: 'موعد الدفع', by: dueOf, cell: (s) => (s.balance > 0 ? dueBadge(s.id) : null) || h('span', { class: 'muted' }, '—') },
          { key: 'age', label: 'أقدم دين', by: (s) => (s.balance > 0 ? daysSince(s.oldestUnpaidAt) : 0), cell: (s) => (s.balance > 0 && daysSince(s.oldestUnpaidAt) >= 1 ? ageText(daysSince(s.oldestUnpaidAt)) : h('span', { class: 'muted' }, '—')) },
          { key: 'balance', label: 'عليك له', num: true, by: (s) => s.balance, cell: (s) => (s.balance > 0 ? h('span', { class: 'owed' }, money(s.balance)) : s.balance < 0 ? h('span', { class: 'credit' }, 'لك ', money(-s.balance)) : h('span', { class: 'muted' }, 'لا شيء')) },
        ],
      }));
      return;
    }
    fill(body, items.length ? h('div', { class: 'list' }, ...items.slice(0, 200).map((s) => {
      const days = daysSince(s.oldestUnpaidAt);
      const badge = s.balance > 0 ? dueBadge(s.id) : null;
      // الموعد أهم من عمر الدين: إن حُدّد يظهر مكانه
      const sub = [s.phone ? num(s.phone) : null, badge || (s.balance > 0 && days >= 1 ? `أقدم دين ${ageText(days)}` : null)].filter(Boolean);
      return h('button', { class: 'row row-tap', type: 'button', onclick: () => navigate(`/suppliers/view?id=${s.id}`) },
        h('span', { class: `avatar ${s.balance > 0 ? 'owed' : ''}` }, s.name.trim().charAt(0)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, s.name),
          sub.length ? h('span', { class: 'row-sub' }, sub[0], sub[1] ? [' · ', sub[1]] : null) : null),
        s.balance > 0 ? h('span', { class: 'row-end owed' }, money(s.balance))
          : s.balance < 0 ? h('span', { class: 'row-end credit' }, h('small', null, 'لك '), money(-s.balance))
            : h('span', { class: 'row-end muted small' }, 'لا شيء'));
    })) : emptyState('search', 'لا نتائج', `لا تاجر يطابق «${query}»`));
  }

  async function load() { all = await app.inventory.suppliers(); paint(); tabs.refresh(); }
  load();
  const offData = bus.on('data', (e) => { if (e.tables.includes('suppliers') || e.tables.includes('supplier_entries')) load(); });
  const offDues = bus.on('dues', paint);
  const offShop = bus.on('shop', paint); // موعد غُيّر من جهاز آخر
  return () => { offData(); offDues(); offShop(); };
}

// ============ صفحة التاجر ============
export async function renderSupplier(el, params) {
  let s = await app.inventory.supplier(params.id);
  if (!s) { navigate('/suppliers', { replace: true }); return undefined; }
  const top = h('div'); const list = h('div'); const title = h('h1', null, s.name);
  el.append(
    h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'رجوع', onclick: () => history.back() }, icon('back')),
      h('div', { class: 'topbar-title' }, title),
      h('div', { class: 'topbar-actions' }, iconButton('edit', 'تعديل التاجر', () => editSupplier(s, load, !app.can('delete') ? null : async () => {
        await app.inventory.removeSupplier(s.id); history.back();
        toast(`حُذف «${s.name}»`, { undo: () => app.inventory.restoreSupplier(s.id) });
      })), helpButton())),
    h('div', { class: 'page split' }, top, list));

  const miniBtn = (ic, label, onclick, disabled) => h('button', { class: 'mini-btn', type: 'button', onclick, disabled: !!disabled }, icon(ic, 20), h('span', null, label));

  function paint() {
    title.textContent = s.name;
    const owe = s.balance > 0;
    const phone = normalizePhone(s.phone);
    const days = daysSince(s.oldestUnpaidAt);
    fill(top,
      h('div', { class: `balance-card ${owe ? 'owed' : 'clear'}` },
        h('div', { class: 'hero-label' }, owe ? 'عليك له' : s.balance < 0 ? 'لك عنده' : 'لا شيء عليك له'),
        h('div', { class: 'hero-value' }, money(Math.abs(s.balance))),
        owe && days >= 1 ? h('div', { class: 'hero-mini-label' }, `أقدم دين لم تسدّده ${ageText(days)}`) : null,
        s.note ? h('div', { class: 'hero-mini-label' }, s.note) : null),
      dueStrip(s, paint),
      h('div', { class: 'big-actions' },
        h('button', { class: 'big-btn pay', type: 'button', onclick: paySheet }, icon('cash', 26), h('span', null, 'دفعت له')),
        h('button', { class: 'big-btn debt', type: 'button', onclick: debtSheet }, icon('plus', 26), h('span', null, 'دين جديد'))),
      h('div', { class: 'mini-actions' },
        miniBtn('truck', 'شراء بفاتورة', () => navigate(`/inventory/purchase?supplier=${s.id}`)),
        miniBtn('receipt', 'كشف واتساب', sendStatement, !s.entries.length),
        miniBtn('phone', 'اتصال', () => openLink(`tel:+${phone}`), !phone),
        miniBtn('clipboard', 'طلبية', () => navigate('/inventory?reorder=1'))));
    if (isWide() && s.entries.length) {
      const amt = (v) => num(formatMoney(v, cur(), { symbol: false }));
      const tapOf = (e) => (e.cancelled ? null : e.invoice_id ? (e.type === 'purchase' ? () => showReceipt(e.invoice_id, { doneLabel: 'إغلاق', doneIcon: 'x' }) : null) : editableEntry(e) && app.can('delete') ? () => entrySheet(e) : null);
      fill(list, h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'كشف الحساب'), dataTable({
        rows: s.entries,
        onRow: (e) => { const t = tapOf(e); if (t) t(); },
        rowClass: (e) => (e.cancelled ? 'dt-cancelled' : ''),
        columns: [
          { key: 'date', label: 'التاريخ', by: (e) => e.created_at, cell: (e) => num(dateText(e.created_at)) },
          { key: 'what', label: 'البيان', grow: true, cell: (e) => [SUPPLIER_ENTRY_LABELS[e.type] || '', e.cancelled ? [' ', h('span', { class: 'tag-cancelled' }, 'ملغاة')] : null, e.note ? h('span', { class: 'muted' }, ` · ${e.note}`) : null] },
          { key: 'debit', label: 'له (دين)', num: true, by: (e) => Math.max(0, e.amount), cell: (e) => (e.amount > 0 ? h('span', { class: e.cancelled ? '' : 'owed' }, amt(e.amount)) : '') },
          { key: 'credit', label: 'دفعت', num: true, by: (e) => Math.max(0, -e.amount), cell: (e) => (e.amount < 0 ? h('span', { class: e.cancelled ? '' : 'credit' }, amt(-e.amount)) : '') },
          { key: 'balance', label: 'الباقي له', num: true, cell: (e) => (e.cancelled ? '' : amt(e.balance)) },
        ],
      })));
      return;
    }
    fill(list, s.entries.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'كشف الحساب'),
      h('div', { class: 'list' }, ...s.entries.map((e) => {
        const label = SUPPLIER_ENTRY_LABELS[e.type] || '';
        if (e.cancelled) {
          return h('div', { class: 'row entry-cancelled' },
            h('span', { class: 'row-ic' }, icon('x', 20)),
            h('span', { class: 'row-main' },
              h('span', { class: 'row-title' }, label, ' ', h('span', { class: 'tag-cancelled' }, 'ملغاة')),
              h('span', { class: 'row-sub' }, num(dateText(e.created_at)))),
            h('span', { class: 'row-end' }, num(formatMoney(Math.abs(e.amount), cur(), { symbol: false }))));
        }
        const tap = e.invoice_id ? (e.type === 'purchase' ? () => showReceipt(e.invoice_id, { doneLabel: 'إغلاق', doneIcon: 'x' }) : null) : editableEntry(e) && app.can('delete') ? () => entrySheet(e) : null;
        return h(tap ? 'button' : 'div', { class: `row ${tap ? 'row-tap' : ''}`, type: tap ? 'button' : null, onclick: tap },
          h('span', { class: `row-ic ${e.amount > 0 ? 'ic-debt' : ''}` }, icon(e.amount > 0 ? (e.type === 'purchase' ? 'truck' : 'plus') : 'check', 20)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label, e.note ? h('span', { class: 'muted' }, ` · ${e.note}`) : null),
            h('span', { class: 'row-sub' }, num(dateText(e.created_at)), ' · الباقي له ', num(formatMoney(e.balance, cur())))),
          h('span', { class: `row-end ${e.amount > 0 ? 'owed' : 'credit'}` }, num(`${e.amount > 0 ? '+' : '−'}${formatMoney(Math.abs(e.amount), cur(), { symbol: false })}`)));
      })))
      : emptyState('receipt', 'لا حركات بعد', 'أخذت منه بضاعة بالدين؟ «دين جديد». دفعت له؟ «دفعت له».'));
  }

  function sendStatement() {
    if (!normalizePhone(s.phone)) toast('لا رقم جوال لهذا التاجر — اختر جهة الاتصال من واتساب');
    openLink(whatsappLink(s.phone, supplierStatementText({ shopName: app.shop.name, supplierName: s.name, entries: s.raw, currency: cur(), formatDate: dateText })));
  }

  // دين جديد: «أخذت بضاعة بـ 800» — مبلغ وملاحظة، بلا إدخال أصناف
  function debtSheet() {
    const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0' });
    const note = input({ maxlength: 80, placeholder: 'مثال: فاتورة 1250، زيت وسكر (اختياري)' });
    const picker = duePicker(app.dues.get(s.id)?.date); // الموعد الحالي يبقى إن لم يُغيَّر
    let busy = false;
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (busy) return;
        const v = parseMoney(amt.value || '', cur());
        if (!v || v <= 0) { feedback.error(); toast('اكتب المبلغ', { kind: 'error' }); amt.focus(); return; }
        busy = true;
        try {
          await app.inventory.addSupplierDebt(s.id, v, note.value);
          await app.dues.set(s.id, picker.value(), app.dues.get(s.id)?.note);
          feedback.ok(); close(); await load();
          toast(`سُجّل ${formatMoney(v, cur())} — صار عليك له ${formatMoney(Math.max(0, s.balance), cur())}`, { kind: 'ok', ms: 3500 });
        } catch (err) { busy = false; feedback.error(); toast(err.errors?.amount || 'تعذّر الحفظ', { kind: 'error' }); }
      },
    }, field('قيمة البضاعة التي أخذتها بالدين', amt), field('ملاحظة', note), picker.el,
      button('حفظ الدين', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
      h('p', { class: 'muted small' }, 'يزيد ما عليك له فقط ولا يغيّر المخزون. لإدخال الأصناف وكمياتها استعمل «شراء بفاتورة».'),
    ), { title: `دين جديد لـ ${s.name}` });
    setTimeout(() => amt.focus(), 150);
  }

  // دفعت له: المبلغ، ومن أين (نقد الدرج، أو تحويل/محفظة لا يمسّان الدرج)
  async function paySheet() {
    const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0' });
    const note = input({ maxlength: 80, placeholder: 'مثال: سند 55 (اختياري)' });
    const methods = (await app.sales.paymentMethods()).filter((m) => m.kind !== 'credit');
    let method = methods.find((m) => m.kind === 'cash') || methods[0] || null;
    const chips = h('div', { class: 'chips' });
    const hint = h('p', { class: 'muted small' });
    const paintChips = () => {
      fill(chips, ...methods.map((m) => h('button', { class: `chip ${method === m ? 'on' : ''}`, type: 'button', onclick: () => { method = m; paintChips(); } }, m.name)));
      hint.textContent = !method || method.kind === 'cash' ? 'نقدًا: تخرج من نقد الدرج. إن دفعت من خارج الدرج اختر «تحويل».' : 'لا تخرج من نقد الدرج.';
    };
    paintChips();
    let busy = false;
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (busy) return;
        const v = parseMoney(amt.value || '', cur());
        if (!v || v <= 0) { feedback.error(); toast('اكتب المبلغ', { kind: 'error' }); amt.focus(); return; }
        busy = true;
        try {
          await app.inventory.paySupplier(s.id, v, { method, note: note.value });
          feedback.ok(); close(); await load();
          await afterPayment();
          toast(s.balance > 0 ? `دُفع ${formatMoney(v, cur())} — الباقي له ${formatMoney(s.balance, cur())}` : s.balance < 0 ? `دُفع ${formatMoney(v, cur())} — صار لك عنده ${formatMoney(-s.balance, cur())}` : `دُفع ${formatMoney(v, cur())} — سدّدت كل ما عليك له ✓`, { kind: 'ok', ms: 3500 });
        } catch (err) { busy = false; feedback.error(); toast(err.errors?.amount || 'تعذّر الحفظ', { kind: 'error' }); }
      },
    }, field('المبلغ الذي دفعته', amt),
      s.balance > 0 ? h('div', { class: 'chips pay-quick' }, h('button', { class: 'chip', type: 'button', onclick: () => { amt.value = plain(s.balance); } }, 'كامل المبلغ ', num(formatMoney(s.balance, cur())))) : null,
      methods.length > 1 ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'دفعت'), chips, hint) : null,
      field('ملاحظة', note),
      button('حفظ الدفعة', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: `دفعة إلى ${s.name}` });
    setTimeout(() => amt.focus(), 150);
  }

  // بعد الدفعة: سدّدت الكل ← يسقط الموعد. بقي عليك والموعد حلّ أو فات ← «متى تدفع الباقي؟»
  async function afterPayment() {
    const due = app.dues.get(s.id);
    if (!due) return;
    if (s.balance <= 0) { await app.dues.set(s.id, null); paint(); return; }
    if (dueStatus(due.date, localDay()).days <= 0) dueSheet(s, paint, { title: `بقي عليك ${formatMoney(s.balance, cur())} — متى تدفعه؟` });
  }

  // تعديل أو حذف دين/دفعة/رصيد سابق: يُضاف قيد تصحيح (والدرج يُصحَّح للدفعات النقدية)، والأصلية تظهر «ملغاة»
  function entrySheet(e) {
    const isPay = e.type === 'payment';
    const label = SUPPLIER_ENTRY_LABELS[e.type] || 'الحركة';
    const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', value: plain(Math.abs(e.amount)) });
    const note = input({ maxlength: 80, value: e.note || '', placeholder: 'ملاحظة (اختياري)' });
    let busy = false;
    openSheet((close) => h('form', {
      onsubmit: async (ev) => {
        ev.preventDefault();
        if (busy) return;
        const v = parseMoney(amt.value || '', cur());
        if (!v || v <= 0) { feedback.error(); toast('اكتب المبلغ', { kind: 'error' }); amt.focus(); return; }
        if (v === Math.abs(e.amount) && (note.value.trim() || null) === (e.note || null)) { close(); return; }
        busy = true;
        try {
          await app.inventory.editSupplierEntry(e, v, note.value);
          feedback.ok(); close(); await load();
          toast(`عُدّلت — ${s.balance >= 0 ? `عليك له الآن ${formatMoney(s.balance, cur())}` : `لك عنده الآن ${formatMoney(-s.balance, cur())}`}`, { kind: 'ok', ms: 3500 });
        } catch (err) { busy = false; feedback.error(); toast(err.errors?.amount || 'تعذّر الحفظ', { kind: 'error' }); }
      },
    },
      h('p', { class: 'muted' }, `${label} بتاريخ `, num(dateText(e.created_at))),
      field('المبلغ', amt), field('ملاحظة', note),
      button('حفظ التعديل', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
      h('button', {
        class: 'btn btn-text btn-block btn-danger-text', type: 'button',
        onclick: async () => {
          if (busy) return;
          busy = true;
          try {
            const undo = await app.inventory.voidSupplierEntry(e);
            feedback.ok(); close(); await load();
            toast(`حُذفت: ${label}`, { undo: async () => { await app.inventory.voidSupplierEntry(undo); await load(); } });
          } catch (err) { busy = false; feedback.error(); toast(err.errors?.amount || 'تعذّر الحذف', { kind: 'error' }); }
        },
      }, icon('trash', 20), h('span', null, isPay ? 'حذف هذه الدفعة' : 'حذف هذه الحركة')),
      isPay ? h('p', { class: 'muted small' }, 'إن كانت نقدًا يعود المبلغ إلى الصندوق تلقائيًا.') : null,
    ), { title: `تعديل: ${label}` });
    setTimeout(() => { amt.focus(); amt.select(); }, 150);
  }

  async function load() { const n = await app.inventory.supplier(params.id); if (n) { s = n; paint(); } }
  paint();
  return bus.on('data', (e) => { if (e.source === 'remote' && (e.tables.includes('suppliers') || e.tables.includes('supplier_entries'))) load(); });
}
