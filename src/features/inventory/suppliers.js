// الموردون: ما عليك لكل مورّد، «دفعت له» بضغطتين، كشف الحساب، واتساب واتصال.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, iconButton, emptyState, button, money, input, field } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import { normalizePhone, whatsappLink } from '../../domain/ledger.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { openLink } from '../customers/customers.js';
import { showReceipt } from '../sale/receipt.js';
import { addDays, dueStatus, dueText } from '../../domain/dues.js';
import { localDay } from '../../domain/offers.js';

const duesOf = () => app.shop?.settings?.supplierDues || {};
/** يحفظ موعد الدفع لمورّد (date = null يمسحه). */
export async function setSupplierDue(id, date, note = null) {
  const next = { ...duesOf() };
  if (date) next[id] = { date, note: note || null }; else delete next[id];
  await app.updateShopSettings({ supplierDues: next });
}
const DUE_CLASS = { overdue: 'due-bad', today: 'due-bad', soon: 'due-warn', later: 'due-ok' };
/** شارة الموعد: «متأخر 3 أيام» / «غدًا» … */
export function dueBadge(id) {
  const d = duesOf()[id];
  if (!d || !d.date) return null;
  const st = dueStatus(d.date, localDay());
  return h('span', { class: `due-badge ${DUE_CLASS[st.state]}` }, icon('alert', 13), dueText(st.days));
}

/** ورقة «متى تدفع له؟»: تاريخ أو ضغطة (أسبوع، أسبوعين، شهر). */
export function dueSheet(s, onDone) {
  const cur = duesOf()[s.id];
  const date = input({ type: 'date', dir: 'ltr', value: cur?.date || addDays(localDay(), 7) });
  const note = input({ maxlength: 60, value: cur?.note || '', placeholder: 'شيك، دفعة أولى… (اختياري)' });
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!date.value) { feedback.error(); return; }
      await setSupplierDue(s.id, date.value, note.value.trim());
      feedback.ok(); close();
      toast(`سنذكّرك بالدفع لـ ${s.name} ${dueText(dueStatus(date.value, localDay()).days)}`, { kind: 'ok', ms: 3500 });
      if (onDone) onDone();
    },
  },
    h('div', { class: 'chips' }, ...[['أسبوع', 7], ['أسبوعين', 14], ['شهر', 30]].map(([l, n]) => h('button', { class: 'chip', type: 'button', onclick: () => { date.value = addDays(localDay(), n); } }, l))),
    field('موعد الدفع', date), field('ملاحظة', note),
    button('حفظ الموعد', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    cur ? button('بلا موعد', { kind: 'text', block: true, onclick: async () => { await setSupplierDue(s.id, null); close(); if (onDone) onDone(); } }) : null,
  ), { title: `متى تدفع لـ ${s.name}؟` });
}

const cur = () => app.shop?.base_currency || 'ILS';
const dateText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
const LABELS = { opening: 'رصيد سابق', purchase: 'شراء', payment: 'دفعة له', return: 'مرتجع', adjustment: 'تسوية' };

export function editSupplier(s, onSaved, onDelete = null) {
  const name = input({ value: s ? s.name : '', maxlength: 60, placeholder: 'اسم المورّد أو الشركة' });
  const phone = input({ value: s ? s.phone || '' : '', type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: '059xxxxxxx' });
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const saved = await app.inventory.saveSupplier({ id: s ? s.id : undefined, name: name.value, phone: phone.value });
        feedback.ok(); close();
        if (onSaved) onSaved(saved);
      } catch (err) { feedback.error(); toast(err.message, { kind: 'error' }); }
    },
  }, field('الاسم', name), field('رقم الجوال (لإرسال الطلبيات على واتساب)', phone),
    button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    s && onDelete ? button('حذف المورّد', { kind: 'text', onclick: () => { close(); onDelete(); } }) : null,
  ), { title: s ? 'تعديل المورّد' : 'مورّد جديد' });
  setTimeout(() => { if (!s) name.focus(); }, 200);
}

/** اختيار مورّد (للشراء وطلب البضاعة). يرجع المورّد أو null. */
export function pickSupplier({ title = 'اختر المورّد' } = {}) {
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
          h('span', { class: 'row-ic' }, icon('plus', 20)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'مورّد جديد')))));
      return list;
    }, { title, onClose: () => resolve(chosen) });
  });
}

export function renderSuppliers(el) {
  const totalEl = h('div');
  const body = h('div');
  el.append(header('الموردون', { back: true }), h('div', { class: 'page' }, totalEl,
    button('مورّد جديد', { icon: 'plus', block: true, onclick: () => editSupplier(null, (s) => navigate(`/suppliers/view?id=${s.id}`)) }), h('div', { class: 'section' }, body)));
  async function load() {
    const all = await app.inventory.suppliers();
    const owing = all.filter((s) => s.balance > 0);
    const dues = duesOf();
    const today = localDay();
    const urgent = owing.filter((s) => dues[s.id] && dueStatus(dues[s.id].date, today).state !== 'later');
    fill(totalEl, all.length ? h('div', { class: 'debt-card' }, h('div', { class: 'hero-label' }, 'عليك للموردين'),
      h('div', { class: 'hero-value' }, money(owing.reduce((a, s) => a + s.balance, 0))), h('div', { class: 'hero-mini-label' }, `${owing.length} مورّد له عندك`),
      urgent.length ? h('div', { class: 'hero-mini-label due-line' }, icon('alert', 14), ` مستحق خلال 3 أيام أو متأخر: `, num(formatMoney(urgent.reduce((a, s) => a + s.balance, 0), cur()))) : null) : null);
    // الأقرب موعدًا أولًا، ثم الأكبر رصيدًا
    all.sort((a, b) => {
      const da = a.balance > 0 && dues[a.id] ? dues[a.id].date : '9999'; const db = b.balance > 0 && dues[b.id] ? dues[b.id].date : '9999';
      return da < db ? -1 : da > db ? 1 : b.balance - a.balance;
    });
    fill(body, all.length ? h('div', { class: 'list' }, ...all.map((s) => h('button', { class: 'row row-tap', type: 'button', onclick: () => navigate(`/suppliers/view?id=${s.id}`) },
      h('span', { class: 'row-ic' }, icon('truck', 20)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, s.name), s.balance > 0 && dueBadge(s.id) ? h('span', { class: 'row-sub' }, dueBadge(s.id)) : s.phone ? h('span', { class: 'row-sub num' }, s.phone) : null),
      s.balance ? h('span', { class: `row-end ${s.balance > 0 ? 'owed' : 'credit'}` }, money(s.balance)) : h('span', { class: 'row-end muted small' }, 'لا شيء'))))
      : emptyState('truck', 'لا موردين بعد', 'أضف من تشتري منهم لتعرف ما عليك لكل واحد وترسل له الطلبيات.'));
  }
  load();
  return bus.on('data', (e) => { if (e.tables.includes('suppliers') || e.tables.includes('supplier_entries')) load(); });
}

export async function renderSupplier(el, params) {
  let s = await app.inventory.supplier(params.id);
  if (!s) { navigate('/suppliers', { replace: true }); return; }
  const top = h('div'); const list = h('div'); const title = h('h1', null, s.name);
  el.append(
    h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'رجوع', onclick: () => history.back() }, icon('back')),
      h('div', { class: 'topbar-title' }, title),
      h('div', { class: 'topbar-actions' }, iconButton('edit', 'تعديل المورّد', () => editSupplier(s, load, async () => {
        await app.inventory.removeSupplier(s.id); history.back();
        toast(`حُذف «${s.name}»`, { undo: () => app.inventory.restoreSupplier(s.id) });
      })))),
    h('div', { class: 'page' }, top, list));

  function paint() {
    title.textContent = s.name;
    const phone = normalizePhone(s.phone);
    fill(top,
      h('div', { class: `balance-card ${s.balance > 0 ? 'owed' : 'clear'}` },
        h('div', { class: 'hero-label' }, s.balance > 0 ? 'عليك له' : 'لا شيء عليك له'), h('div', { class: 'hero-value' }, money(Math.abs(s.balance)))),
      s.balance > 0 ? h('button', { class: 'due-row', type: 'button', onclick: () => dueSheet(s, paint) },
        icon('alert', 20),
        duesOf()[s.id] ? h('span', { class: 'row-main due-main' }, 'موعد الدفع ', h('b', { class: 'num' }, duesOf()[s.id].date.split('-').reverse().join('/')), ' ', dueBadge(s.id), duesOf()[s.id].note ? h('span', { class: 'muted' }, ` · ${duesOf()[s.id].note}`) : null)
          : h('span', { class: 'row-main due-main' }, 'حدد موعد الدفع — نذكّرك قبله'),
        icon('edit', 18)) : null,
      h('div', { class: 'big-actions' },
        h('button', { class: 'big-btn pay', type: 'button', onclick: payHim }, icon('cash', 26), h('span', null, 'دفعت له')),
        h('button', { class: 'big-btn debt', type: 'button', onclick: () => navigate(`/inventory/purchase?supplier=${s.id}`) }, icon('truck', 26), h('span', null, 'شراء منه'))),
      h('div', { class: 'mini-actions' },
        h('button', { class: 'mini-btn', type: 'button', disabled: !phone, onclick: () => openLink(whatsappLink(s.phone, `مرحبًا ${s.name}،`)) }, icon('receipt', 20), h('span', null, 'واتساب')),
        h('button', { class: 'mini-btn', type: 'button', disabled: !phone, onclick: () => openLink(`tel:+${phone}`) }, icon('phone', 20), h('span', null, 'اتصال')),
        h('button', { class: 'mini-btn', type: 'button', onclick: () => navigate('/inventory?reorder=1') }, icon('clipboard', 20), h('span', null, 'طلبية'))));
    fill(list, s.entries.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'كشف الحساب'),
      h('div', { class: 'list' }, ...s.entries.map((e) => {
        const tap = e.invoice_id && e.type === 'purchase' ? () => showReceipt(e.invoice_id, { doneLabel: 'إغلاق', doneIcon: 'x' }) : null;
        return h(tap ? 'button' : 'div', { class: `row ${tap ? 'row-tap' : ''}`, type: tap ? 'button' : null, onclick: tap },
          h('span', { class: `row-ic ${e.amount > 0 ? 'ic-debt' : ''}` }, icon(e.amount > 0 ? 'truck' : 'check', 20)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, LABELS[e.type] || '', e.note ? h('span', { class: 'muted' }, ` · ${e.note}`) : null),
            h('span', { class: 'row-sub' }, num(dateText(e.created_at)), ' · الرصيد ', num(formatMoney(e.balance, cur())))),
          h('span', { class: `row-end ${e.amount > 0 ? 'owed' : 'credit'}` }, num(`${e.amount > 0 ? '+' : '−'}${formatMoney(Math.abs(e.amount), cur(), { symbol: false })}`)));
      }))) : emptyState('receipt', 'لا حركات بعد', 'سجّل شراءً منه أو دفعة له.'));
  }

  function payHim() {
    const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0' });
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const v = parseMoney(amt.value || '', cur());
        if (!v || v <= 0) { feedback.error(); toast('اكتب المبلغ', { kind: 'error' }); return; }
        await app.inventory.paySupplier(s.id, v);
        feedback.ok(); close(); await load();
        if (s.balance <= 0 && duesOf()[s.id]) await setSupplierDue(s.id, null);
        toast(`دُفع ${formatMoney(v, cur())} — الباقي له ${formatMoney(Math.max(0, s.balance), cur())}`, { kind: 'ok', ms: 3500 });
      },
    }, field('المبلغ المدفوع', amt),
      s.balance > 0 ? h('div', { class: 'chips pay-quick' }, h('button', { class: 'chip', type: 'button', onclick: () => { amt.value = formatDecimal(s.balance, CURRENCIES[cur()].minor, { trim: true, group: false }); } }, 'كامل المبلغ ', num(formatMoney(s.balance, cur())))) : null,
      button('حفظ الدفعة', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: `دفعة إلى ${s.name}` });
    setTimeout(() => amt.focus(), 150);
  }

  async function load() { const n = await app.inventory.supplier(params.id); if (n) { s = n; paint(); } }
  paint();
}
