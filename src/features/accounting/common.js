// أدوات مشتركة لشاشات المحاسبة: اختيار الصندوق، المدة، خانة المبلغ، وعرض السند (إرسال واتساب، طباعة، إلغاء).
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, input } from '../../ui/components.js';
import { openSheet, toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import { periodRange } from '../../domain/reports.js';
import { voucherDoc } from '../../domain/accounting.js';
import { invoiceText } from '../../domain/invoice.js';
import { whatsappLink } from '../../domain/ledger.js';
import { localDay } from '../../domain/offers.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { printer } from '../../core/printer.js';
import { receiptElement } from '../sale/receipt.js';
import { renderInvoiceCanvas } from '../invoices/render.js';
import { sendFile } from '../invoices/share.js';
import { showVoucher } from '../customers/voucher.js';
import { openLink } from '../customers/customers.js';

export const cur = () => app.shop?.base_currency || 'ILS';
export const dateText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
export const plain = (v) => formatDecimal(v, CURRENCIES[cur()].minor, { trim: true, group: false });
/** مبلغ بلا رمز العملة (للجداول). */
export const amt = (v) => num(formatMoney(v, cur(), { symbol: false }));
/** من يرى الدفاتر (ميزان المراجعة، الأرباح): صاحب المحل ومن له «التقارير» و«يرى الأرباح». */
export const canBooks = () => app.can('reports') && app.can('see_profit');

/** خانة مبلغ كبيرة، مع get() → المبلغ بأصغر وحدة أو 0. */
export function amountInput(value = null) {
  const el = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0', value: value ? plain(value) : '' });
  return { el, get: () => parseMoney(el.value || '', cur()) || 0, focus: () => setTimeout(() => el.focus(), 150) };
}

/** تاريخ السند: اليوم = الآن (null)، ويوم سابق = ظهر ذلك اليوم. */
export function dateInput() {
  const el = input({ type: 'date', dir: 'ltr', value: localDay(), max: localDay() });
  return { el, get: () => (el.value && el.value !== localDay() ? new Date(`${el.value}T12:00:00`).toISOString() : null) };
}

/**
 * اختيار صندوق من moneyChoices(): شرائح. options: { selected (id), outside: نص خيار «من خارج الصندوق» أو null, exclude: id }.
 * get() → عنصر من choices، أو null إن اختير «من خارج الصندوق».
 */
export function moneyPicker(choices, { selected = undefined, outside = null, onchange = null } = {}) {
  let cur0 = selected === undefined ? choices[0] || null : choices.find((c) => c.id === selected) || null;
  let hidden = null;
  const el = h('div', { class: 'chips' });
  const paint = () => fill(el,
    ...choices.filter((c) => c.id !== hidden).map((c) => h('button', { class: `chip ${cur0 === c ? 'on' : ''}`, type: 'button', onclick: () => { cur0 = c; paint(); if (onchange) onchange(c); } },
      icon(c.drawer ? 'cash' : c.box ? 'safe' : 'bank', 16), c.name)),
    outside ? h('button', { class: `chip ${cur0 ? '' : 'on'}`, type: 'button', onclick: () => { cur0 = null; paint(); if (onchange) onchange(null); } }, outside) : null);
  paint();
  return {
    el, get: () => cur0,
    /** يخفي صندوقًا (في التحويل: «إلى» لا يعرض ما اختير في «من»). */
    hide(id) { hidden = id; if (cur0 && cur0.id === id) cur0 = choices.find((c) => c.id !== id) || null; paint(); },
  };
}

const KINDS = [['all', 'كل المدة'], ['month', 'هذا الشهر'], ['lastMonth', 'الشهر الماضي'], ['year', 'هذه السنة'], ['lastYear', 'السنة الماضية'], ['custom', 'مخصص']];
/**
 * شرائح اختيار المدة للدفاتر. onChange(range) حيث range = { from, to, label } و from/to = null لكل المدة.
 * يرجع { el, range() }.
 */
export function periodPicker(onChange, initial = 'all', preset = null) {
  let kind = preset && preset.from && preset.to ? 'custom' : initial;
  const chips = h('div', { class: 'chips chips-scroll' });
  // preset: مدة جاهزة (من ميزان المراجعة إلى دفتر الأستاذ) — to غير شاملة، فآخر يوم هو ما قبلها
  const lastDay = preset && preset.to ? localDay(new Date(Date.parse(preset.to) - 1000)) : localDay();
  const fromIn = input({ type: 'date', dir: 'ltr', value: preset && preset.from ? localDay(new Date(preset.from)) : `${localDay().slice(0, 8)}01` });
  const toIn = input({ type: 'date', dir: 'ltr', value: lastDay });
  const custom = h('div', { class: 'grid-2', hidden: true }, fromIn, toIn);
  const range = () => {
    if (kind === 'all') return { from: null, to: null, label: 'كل المدة' };
    return periodRange(kind, new Date(), kind === 'custom' && fromIn.value && toIn.value ? { from: fromIn.value, to: toIn.value } : null);
  };
  const paint = () => {
    fill(chips, ...KINDS.map(([k, label]) => h('button', { class: `chip ${kind === k ? 'on' : ''}`, type: 'button', onclick: () => { kind = k; paint(); onChange(range()); } }, label)));
    custom.hidden = kind !== 'custom';
  };
  fromIn.addEventListener('change', () => onChange(range()));
  toIn.addEventListener('change', () => onChange(range()));
  paint();
  return { el: h('div', null, chips, custom), range };
}

/**
 * يعرض سندًا من قائمة السندات (app.accounting.vouchers()) في ورقة: إرسال واتساب، طباعة، وإلغاء لسندات هذا الجدول.
 * سند قبض من زبون يُعرض بورقته المعروفة (مع رصيده)، ودفعة التاجر تُعدَّل من كشفه.
 */
export async function showMoneyVoucher(item, { onChanged = null, doneLabel = 'تم' } = {}) {
  if (item.source === 'customer') return showVoucher(item.id, { doneLabel });
  const [accountName, toName] = await Promise.all([
    item.accountId ? app.accounting.moneyName(item.accountId) : (item.ref_table === 'expenses' ? 'من خارج الصندوق' : null),
    item.toId ? app.accounting.moneyName(item.toId) : null,
  ]);
  const model = voucherDoc({
    type: item.type, number: item.number, date: item.date, amount: item.amount, party: item.party, accountName, toName,
    contraName: app.accounting.contraName(item.type, item.contra), note: item.note, cancelled: item.cancelled,
  }, app.shop || {}, cur());
  const logoUrl = await app.media.logoUrl();
  const canPrint = await printer.ready();
  async function sendImage() {
    try {
      const canvas = await renderInvoiceCanvas(model, logoUrl);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
      await sendFile({ blob, name: `voucher-${model.number || 'x'}.jpg`, mime: 'image/jpeg' }, '', `${model.title} ${model.number} — ${model.shopName}`);
    } catch (e) { console.error(e); feedback.error(); toast('تعذّر إرسال السند', { kind: 'error' }); }
  }
  async function print() {
    try { await printer.printModel(model, logoUrl); feedback.ok(); } catch (e) { feedback.error(); toast(e.message || 'تعذّرت الطباعة', { kind: 'error', ms: 4500 }); }
  }
  return openSheet((close) => h('div', null, receiptElement(model, logoUrl),
    h('div', { class: 'rc-actions' },
      h('div', { class: 'rc-share' },
        h('button', { class: 'btn btn-wa', type: 'button', onclick: sendImage }, icon('receipt', 22), h('span', null, 'أرسل السند واتساب')),
        canPrint ? h('button', { class: 'btn btn-outline rc-more', type: 'button', 'aria-label': 'اطبع', onclick: print }, icon('printer', 22)) : null,
        h('button', { class: 'btn btn-outline rc-more', type: 'button', 'aria-label': 'رسالة نصية', title: 'رسالة نصية', onclick: () => openLink(whatsappLink('', invoiceText(model))) }, icon('chat', 22))),
      button(doneLabel, { block: true, size: 'lg', icon: 'check', onclick: close }),
      item.source === 'voucher' && !item.cancelled && app.can('delete') ? button('إلغاء هذا السند', { kind: 'text', onclick: async () => {
        await app.accounting.voidVoucher(item.id);
        feedback.ok(); close();
        toast(`أُلغي ${model.title} ${model.number}`, { undo: async () => { await app.accounting.restoreVoucher(item.id); if (onChanged) onChanged(); } });
        if (onChanged) onChanged();
      } }) : null,
      item.source === 'supplier' ? button('لتعديلها أو حذفها افتح كشف التاجر', { kind: 'text', onclick: () => { close(); navigate(`/suppliers/view?id=${item.partyId}`); } }) : null),
  ), { title: null });
}

/** يفتح سندًا برقمه في جدول السندات (من دفتر الأستاذ). */
export async function showVoucherById(id, opts) {
  const item = (await app.accounting.vouchers({ limit: 100000 })).find((v) => v.source === 'voucher' && v.id === id);
  if (!item) { toast('السند غير موجود', { kind: 'error' }); return null; }
  return showMoneyVoucher(item, opts);
}
