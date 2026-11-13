// الفاتورة كما يراها الزبون: تظهر مباشرة بعد كل بيع، وتُفتح من سجل الفواتير وكشوف الحساب.
// لا تكلفة ولا ربح هنا أبدًا (الشاشة قد يراها الزبون). تحتها: «أرسل واتساب» بضغطة (اختياري)، ثم الزر الرئيسي.
import { h, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button } from '../../ui/components.js';
import { openSheet } from '../../ui/overlay.js';
import { loadInvoiceData } from '../invoices/render.js';
import { sendInvoice, moreShareOptions } from '../invoices/share.js';

/** عنصر الفاتورة على الشاشة من نموذجها. */
export function receiptElement(model, logoUrl = null) {
  return h('div', { class: 'receipt' },
    h('div', { class: 'rc-head' },
      logoUrl ? h('img', { class: 'rc-logo', src: logoUrl, alt: '' }) : null,
      h('div', { class: 'rc-shop' }, model.shopName),
      model.shopPhone ? h('div', { class: 'rc-sub num' }, model.shopPhone) : null,
      model.shopAddress ? h('div', { class: 'rc-sub' }, model.shopAddress) : null),
    h('div', { class: 'rc-meta' }, h('span', null, model.title, ' ', num(model.number)), num(model.date)),
    model.party ? h('div', { class: 'rc-cust' }, model.party) : null,
    h('div', { class: 'rc-lines' }, ...model.rows.map((r) => h('div', { class: 'rc-line' },
      h('div', { class: 'rc-name' }, r.name),
      h('div', { class: 'rc-calc' }, num(r.calc), num(r.total))))),
    h('div', { class: 'rc-totals' }, ...model.totals.map((t) => h('div', { class: `rc-kv ${t.strong ? 'rc-total' : ''}` }, h('span', null, t.label), num(t.value)))),
    model.foot ? h('div', { class: 'rc-foot' }, model.foot) : null,
  );
}

/** يعرض الفاتورة في ورقة: إرسال واتساب (اختياري) والزر الرئيسي للمتابعة. */
export async function showReceipt(invoiceId, { doneLabel = 'بيع جديد', doneIcon = 'scan', onClose = null } = {}) {
  const { model, logoUrl } = await loadInvoiceData(invoiceId);
  return openSheet((close) => h('div', null, receiptElement(model, logoUrl),
    h('div', { class: 'rc-actions' },
      h('div', { class: 'rc-share' },
        h('button', { class: 'btn btn-wa', type: 'button', onclick: () => sendInvoice(invoiceId, 'image') }, icon('receipt', 22), h('span', null, 'أرسل واتساب')),
        h('button', { class: 'btn btn-outline rc-more', type: 'button', 'aria-label': 'خيارات الإرسال', onclick: () => moreShareOptions(invoiceId) }, icon('more', 22))),
      button(doneLabel, { block: true, size: 'lg', icon: doneIcon, onclick: close })),
  ), { title: null, onClose });
}
