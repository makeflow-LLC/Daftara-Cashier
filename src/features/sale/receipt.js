// الفاتورة كما يراها الزبون: تظهر مباشرة بعد كل بيع، وتُفتح من سجل الفواتير وكشوف الحساب.
// لا تكلفة ولا ربح هنا أبدًا (الشاشة قد يراها الزبون). تحتها: «أرسل واتساب» بضغطة (اختياري)، ثم الزر الرئيسي.
// ومن سجل الفواتير وكشف الزبون (manage): «عدّل الفاتورة» و«ألغِ الفاتورة» لمن له الصلاحية.
import { h, num } from '../../ui/dom.js';
import { isWide } from '../../ui/wide.js';
import { icon } from '../../ui/icons.js';
import { button } from '../../ui/components.js';
import { openSheet } from '../../ui/overlay.js';
import { loadInvoiceData } from '../invoices/render.js';
import { sendInvoice, moreShareOptions } from '../invoices/share.js';
import { printer } from '../../core/printer.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { formatMoney } from '../../domain/currency.js';
import { dateTimeText } from '../../domain/invoice.js';
import { staffName } from '../../domain/staff.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';

/** يطبع الفاتورة ويُظهر الخطأ بلغة مفهومة. */
export async function printReceipt(invoiceId) {
  try { await printer.printInvoice(invoiceId); feedback.ok(); } catch (e) { feedback.error(); toast(e.message || 'تعذّرت الطباعة', { kind: 'error', ms: 4500 }); }
}

/** عنصر الفاتورة على الشاشة من نموذجها. */
export function receiptElement(model, logoUrl = null) {
  return h('div', { class: 'receipt' },
    h('div', { class: 'rc-head' },
      logoUrl ? h('img', { class: 'rc-logo', src: logoUrl, alt: '' }) : null,
      h('div', { class: 'rc-shop' }, model.shopName),
      model.shopPhone ? h('div', { class: 'rc-sub num' }, model.shopPhone) : null,
      model.shopAddress ? h('div', { class: 'rc-sub' }, model.shopAddress) : null),
    model.voided ? h('div', { class: 'rc-void' }, 'ملغاة') : null,
    h('div', { class: 'rc-meta' }, h('span', null, model.title, ' ', num(model.number)), num(model.date)),
    model.party ? h('div', { class: 'rc-cust' }, model.party) : null,
    // سند القبض بلا سطور أصناف: خط فاصل واحد
    h('div', { class: 'rc-lines' }, ...model.rows.map((r) => h('div', { class: 'rc-line' },
      h('div', { class: 'rc-name' }, r.name),
      h('div', { class: 'rc-calc' }, num(r.calc), num(r.total))))),
    h('div', { class: 'rc-totals' }, ...model.totals.map((t) => h('div', { class: `rc-kv ${t.strong ? 'rc-total' : ''}` }, h('span', null, t.label), num(t.value)))),
    model.foot ? h('div', { class: 'rc-foot' }, model.foot) : null,
  );
}

/**
 * يسأل ثم يلغي فاتورة بيع: يقول بوضوح ما سيحدث للبضاعة والمال ودين الزبون قبل الضغط. onDone بعد الإلغاء.
 * لا شيء يُمحى: الفاتورة تبقى في «الملغاة» ولا تدخل في التقارير.
 */
export async function confirmVoid(invoiceId, onDone = null) {
  const pv = await app.sales.voidPreview(invoiceId);
  if (pv.problem) { feedback.error(); toast(pv.problem, { kind: 'error', ms: 5000 }); return; }
  const inv = pv.invoice;
  const cur = inv.currency;
  const cust = inv.customer_id ? await app.db.customers.get(inv.customer_id) : null;
  const stocked = pv.lines.some((l) => l.product_id);
  let busy = false;
  openSheet((close) => h('div', null,
    h('p', null, 'ستُلغى الفاتورة ', h('strong', { class: 'num' }, inv.number), ' بمبلغ ', h('strong', null, num(formatMoney(inv.total, cur))), ':'),
    h('ul', { class: 'feature-list' },
      stocked ? h('li', null, 'ترجع بضاعتها إلى المخزون') : null,
      pv.credit ? h('li', null, `ينزل من دين ${cust ? cust.name : 'الزبون'} `, num(formatMoney(pv.credit, cur))) : null,
      pv.refund ? h('li', null, 'يُرد للزبون ', num(formatMoney(pv.refund, cur)), ' ويخرج من الصندوق بطريقة الدفع نفسها') : null,
      h('li', null, 'تخرج من المبيعات والتقارير، وتبقى محفوظة في «الملغاة»')),
    h('button', {
      class: 'btn btn-danger btn-block btn-lg', type: 'button',
      onclick: async () => {
        if (busy) return;
        busy = true;
        try {
          const r = await app.sales.voidInvoice(invoiceId);
          feedback.ok(); close();
          toast(`أُلغيت الفاتورة ${inv.number}${r.credit ? ` — نزل من دينه ${formatMoney(r.credit, cur)}` : ''}${r.refund ? ` — رُدّ له ${formatMoney(r.refund, cur)}` : ''}`, { kind: 'ok', ms: 5000 });
          if (onDone) onDone();
        } catch (e) { busy = false; feedback.error(); toast(e.message || 'تعذّر الإلغاء', { kind: 'error', ms: 4500 }); }
      },
    }, icon('trash', 22), h('span', null, 'نعم، ألغِ الفاتورة')),
    button('لا، أبقِها', { kind: 'text', block: true, onclick: close }),
  ), { title: 'إلغاء الفاتورة' });
}

/**
 * يعرض الفاتورة في ورقة: إرسال واتساب (اختياري) والزر الرئيسي للمتابعة.
 * manage: يُظهر «عدّل» و«ألغِ» لفاتورة بيع قائمة (صلاحية invoices). onChanged: بعد إلغائها (لتُحدَّث الشاشة تحتها).
 */
export async function showReceipt(invoiceId, { doneLabel = 'بيع جديد', doneIcon = 'scan', onClose = null, manage = false, onChanged = null } = {}) {
  const { model, logoUrl, invoice } = await loadInvoiceData(invoiceId);
  const canManage = manage && invoice.type === 'sale' && invoice.status !== 'void' && app.can('invoices');
  // الملغاة: من ألغاها أو عدّلها ومتى (يراه صاحب المحل)
  const info = invoice.status === 'void' ? await app.sales.voidInfo(invoiceId) : null;
  const infoLine = invoice.status !== 'void' ? null : h('p', { class: 'muted small rc-void-info' },
    info ? [info.action === 'invoice_edit' ? 'عُدّلت' : 'أُلغيت', ' ', num(dateTimeText(info.created_at)), app.staff ? ` — ${staffName(app.staff, info.user_id)}` : ''] : 'ملغاة',
    ' · لا تدخل في التقارير');
  // زر الطباعة: يظهر حين تكون الطابعة جاهزة (بلوتوث مختارة، أو حاسوب/متصفح)
  const printBtn = (await printer.ready()) ? h('button', { class: 'btn btn-outline rc-more', type: 'button', 'aria-label': 'اطبع', onclick: () => printReceipt(invoiceId) }, icon('printer', 22)) : null;
  const done = (close) => { const b = button(doneLabel, { block: true, size: 'lg', icon: doneIcon, onclick: close }); if (isWide()) setTimeout(() => b.focus(), 220); return b; }; // الحاسوب: Enter يكمل
  return openSheet((close) => h('div', null, receiptElement(model, logoUrl), infoLine,
    h('div', { class: 'rc-actions' },
      h('div', { class: 'rc-share' },
        h('button', { class: 'btn btn-wa', type: 'button', onclick: () => sendInvoice(invoiceId, 'image') }, icon('receipt', 22), h('span', null, 'أرسل واتساب')),
        printBtn,
        h('button', { class: 'btn btn-outline rc-more', type: 'button', 'aria-label': 'خيارات الإرسال', onclick: () => moreShareOptions(invoiceId) }, icon('more', 22))),
      done(close),
      canManage ? h('div', { class: 'rc-manage' },
        button('عدّل الفاتورة', { kind: 'outline', icon: 'edit', onclick: () => { close(); navigate(`/sale?edit=${invoiceId}`); } }),
        h('button', { class: 'btn btn-outline btn-danger-text', type: 'button', onclick: () => { close(); confirmVoid(invoiceId, onChanged); } }, icon('trash', 22), h('span', null, 'ألغِ الفاتورة'))) : null),
  ), { title: null, onClose });
}
