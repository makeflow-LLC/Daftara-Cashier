// إرسال الفاتورة: ضغطة «أرسل واتساب» ترسلها صورةً إلى رقم الزبون إن عُرف. وخيارات: نص، PDF.
// على أندرويد: إضافة InvoiceShare تفتح واتساب على محادثة الرقم مباشرة والملف مرفق؛
// بلا واتساب أو بلا رقم تظهر قائمة المشاركة العادية. في المتصفح: مشاركة النظام أو تنزيل الملف.
import { h } from '../../ui/dom.js';
import { button, input, field } from '../../ui/components.js';
import { openSheet, toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { invoiceText } from '../../domain/invoice.js';
import { normalizePhone, whatsappLink } from '../../domain/ledger.js';
import { invoiceFile, loadInvoiceData } from './render.js';
import { openLink } from '../customers/customers.js';

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** يرسل ملفًا: إلى واتساب (محادثة الرقم إن وُجد)، أو — مع chooser — قائمة المشاركة ليختار المستخدم أين يحفظه أو يرسله. */
export async function sendFile(file, phone, caption, { chooser = false } = {}) {
  const native = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins.InvoiceShare : null;
  if (native) {
    await native.share({ data: await toBase64(file.blob), mime: file.mime, name: file.name, phone: normalizePhone(phone), text: caption, chooser });
    return;
  }
  const f = new File([file.blob], file.name, { type: file.mime });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], text: caption }); return; } catch { /* أُلغي */ return; } }
  const a = h('a', { href: URL.createObjectURL(file.blob), download: file.name });
  document.body.append(a); a.click(); a.remove();
  toast('نُزّل ملف الفاتورة');
}

/** kind: 'image' | 'pdf' | 'text' */
export async function shareInvoice(invoiceId, kind, phone) {
  try {
    if (kind === 'text') {
      const { model } = await loadInvoiceData(invoiceId);
      openLink(whatsappLink(phone, invoiceText(model)));
      return;
    }
    const file = await invoiceFile(invoiceId, kind);
    await sendFile(file, phone, `${file.model.title} ${file.model.number} — ${file.model.shopName}`);
  } catch (e) {
    console.error(e);
    feedback.error();
    toast('تعذّر إرسال الفاتورة', { kind: 'error' });
  }
}

/**
 * زر «أرسل واتساب»: رقم الزبون معروف → يرسل فورًا. غير معروف → حقل صغير للرقم (أو اختيار المحادثة من واتساب).
 */
export async function sendInvoice(invoiceId, kind = 'image') {
  const { customer, supplier } = await loadInvoiceData(invoiceId);
  const known = (customer && customer.phone) || (supplier && supplier.phone) || '';
  if (normalizePhone(known)) return shareInvoice(invoiceId, kind, known);
  const phone = input({ type: 'tel', inputmode: 'tel', dir: 'ltr', class: 'input input-xl', placeholder: '059xxxxxxx' });
  openSheet((close) => h('form', {
    onsubmit: (e) => { e.preventDefault(); if (!normalizePhone(phone.value)) { feedback.error(); toast('الرقم غير صحيح', { kind: 'error' }); return; } close(); shareInvoice(invoiceId, kind, phone.value); },
  }, field('رقم واتساب الزبون', phone),
    button('أرسل', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    button('بلا رقم — أختار المحادثة من واتساب', { kind: 'text', onclick: () => { close(); shareInvoice(invoiceId, kind, ''); } }),
  ), { title: 'إرسال الفاتورة' });
  setTimeout(() => phone.focus(), 150);
  return undefined;
}

/** خيارات الإرسال الأخرى. */
export function moreShareOptions(invoiceId) {
  openSheet((close) => h('div', null,
    button('رسالة نصية (الأخف على الإنترنت)', { kind: 'outline', icon: 'receipt', block: true, onclick: () => { close(); sendInvoice(invoiceId, 'text'); } }),
    button('ملف PDF', { kind: 'outline', icon: 'clipboard', block: true, onclick: () => { close(); sendInvoice(invoiceId, 'pdf'); } }),
    button('صورة', { kind: 'outline', icon: 'camera', block: true, onclick: () => { close(); sendInvoice(invoiceId, 'image'); } }),
  ), { title: 'إرسال الفاتورة' });
}

