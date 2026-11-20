// سند القبض: ورقة للزبون حين يدفع من دينه — تظهر بعد كل دفعة، ومن كشف حسابه، ومن سجل الفواتير.
// بنفس شكل الفاتورة: المبلغ المستلم، طريقة الدفع، الرصيد قبل الدفعة والباقي. إرسال واتساب (صورة أو نص) وطباعة.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button } from '../../ui/components.js';
import { openSheet, toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { voucherModel, invoiceText } from '../../domain/invoice.js';
import { whatsappLink, normalizePhone } from '../../domain/ledger.js';
import { app } from '../../core/app.js';
import { printer } from '../../core/printer.js';
import { receiptElement } from '../sale/receipt.js';
import { renderInvoiceCanvas } from '../invoices/render.js';
import { sendFile } from '../invoices/share.js';

async function load(paymentId) {
  const r = await app.customers.receipt(paymentId);
  if (!r) return null;
  const model = voucherModel({ payment: r.payment, customer: r.customer, shop: app.shop || {}, methodName: r.methodName, balanceAfter: r.balanceAfter });
  return { ...r, model, logoUrl: await app.media.logoUrl() };
}

/** يعرض سند القبض في ورقة. onEdit (اختياري): زر «تعديل أو حذف الدفعة». */
export async function showVoucher(paymentId, { doneLabel = 'تم', onEdit = null, onClose = null } = {}) {
  const d = await load(paymentId);
  if (!d) { toast('السند غير موجود', { kind: 'error' }); return null; }
  const { model, logoUrl, customer } = d;
  const phone = customer ? customer.phone : '';
  const openLink = (url) => { const native = globalThis.Capacitor?.isNativePlatform?.(); const w = native ? null : window.open(url, '_blank', 'noopener'); if (!w) window.location.href = url; };
  async function sendImage() {
    try {
      const canvas = await renderInvoiceCanvas(model, logoUrl);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
      await sendFile({ blob, name: `receipt-${model.number || 'payment'}.jpg`, mime: 'image/jpeg' }, phone, `${model.title} ${model.number} — ${model.shopName}`.replace('  ', ' '));
    } catch (e) { console.error(e); feedback.error(); toast('تعذّر إرسال السند', { kind: 'error' }); }
  }
  async function print() {
    try { await printer.printModel(model, logoUrl); feedback.ok(); } catch (e) { feedback.error(); toast(e.message || 'تعذّرت الطباعة', { kind: 'error', ms: 4500 }); }
  }
  const canPrint = await printer.ready();
  return openSheet((close) => h('div', null, receiptElement(model, logoUrl),
    h('div', { class: 'rc-actions' },
      h('div', { class: 'rc-share' },
        h('button', { class: 'btn btn-wa', type: 'button', onclick: sendImage }, icon('receipt', 22), h('span', null, 'أرسل السند واتساب')),
        canPrint ? h('button', { class: 'btn btn-outline rc-more', type: 'button', 'aria-label': 'اطبع', onclick: print }, icon('printer', 22)) : null,
        h('button', { class: 'btn btn-outline rc-more', type: 'button', 'aria-label': 'رسالة نصية', title: 'رسالة نصية',
          onclick: () => { if (!normalizePhone(phone)) toast('لا رقم جوال لهذا الزبون — اختر جهة الاتصال من واتساب'); openLink(whatsappLink(phone, invoiceText(model))); } }, icon('chat', 22))),
      button(doneLabel, { block: true, size: 'lg', icon: 'check', onclick: close }),
      onEdit ? button('تعديل أو حذف هذه الدفعة', { kind: 'text', onclick: () => { close(); onEdit(); } }) : null),
  ), { title: null, onClose });
}
