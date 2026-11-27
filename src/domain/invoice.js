// الفاتورة (نقي): نموذج واحد تُبنى منه الفاتورة على الشاشة، وصورتها، ونصها لواتساب، وملف PDF.
// لا تكلفة ولا ربح في النموذج أبدًا: هذه نسخة الزبون. والبحث في سجل الفواتير.
import { formatMoney } from './currency.js';
import { formatQty } from './units.js';
import { matchesInvoiceNumber } from './numbering.js';
import { normalizeArabic } from './product.js';

export const INVOICE_TITLES = Object.freeze({ sale: 'فاتورة بيع', sale_return: 'فاتورة مرتجع', purchase: 'فاتورة شراء', purchase_return: 'مرتجع شراء' });

function two(n) { return String(n).padStart(2, '0'); }
/** 13/11/2026 07:12 بأرقام غربية وبتوقيت الجهاز. */
export function dateTimeText(iso) {
  const d = new Date(iso);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * data: { invoice, lines, payments, methods (Map id→name), customer, supplier, shop }
 * يرجع نموذج العرض: كل القيم نصوص جاهزة.
 */
export function receiptModel({ invoice, lines, payments = [], methodNames = new Map(), customer = null, supplier = null, shop = {} }) {
  const cur = invoice.currency || 'ILS';
  const m = (v) => formatMoney(v, cur);
  const totals = [];
  if (invoice.discount) {
    totals.push({ label: 'المجموع', value: m(invoice.subtotal) });
    totals.push({ label: 'الخصم', value: m(-invoice.discount) });
  }
  // الضريبة: المضافة تظهر قبل الإجمالي (المجموع قبلها ثم هي)، والشاملة بعده «منها ضريبة»
  const tax = invoice.tax || 0;
  const onTop = tax > 0 && invoice.total > (invoice.subtotal || 0) - (invoice.discount || 0);
  const taxLabel = (shop.settings && shop.settings.tax && String(shop.settings.tax.name || '').trim()) || 'ضريبة القيمة المضافة';
  if (onTop) {
    totals.push({ label: 'قبل الضريبة', value: m(invoice.total - tax) });
    totals.push({ label: taxLabel, value: m(tax) });
  }
  totals.push({ label: 'الإجمالي', value: m(invoice.total), strong: true });
  if (tax > 0 && !onTop) totals.push({ label: `منها ${taxLabel}`, value: m(tax) });
  if (invoice.type === 'purchase' && invoice.paid < invoice.total) totals.push({ label: 'على الحساب', value: m(invoice.total - invoice.paid) });
  // فاتورة بيع ملغاة: ما خرج عند إلغائها (direction = out) ليس طريقة دفع تُعرض للزبون
  for (const p of invoice.type === 'sale' ? payments.filter((x) => x.direction !== 'out') : payments) {
    totals.push({ label: p.method_kind === 'credit' ? 'آجل (على الحساب)' : (methodNames.get(p.method_id) || 'نقدًا'), value: m(p.amount) });
  }
  const voided = invoice.status === 'void';
  // فاتورة فيها ضريبة تحمل رقم المشتغل المرخّص تحت اسم المحل
  const taxNo = tax > 0 && shop.settings && shop.settings.tax && String(shop.settings.tax.number || '').trim();
  return {
    shopName: shop.name || '', shopPhone: shop.phone || '', shopAddress: [shop.address || '', taxNo ? `مشتغل مرخّص ${taxNo}` : ''].filter(Boolean).join(' — '),
    // الملغاة تحمل ذلك في عنوانها أينما ظهرت (شاشة، صورة، نص، طباعة)
    title: `${INVOICE_TITLES[invoice.type] || 'فاتورة'}${voided ? ' ملغاة' : ''}`, number: invoice.number, date: dateTimeText(invoice.created_at),
    voided,
    // زبون عابر بلا حساب: اسمه المكتوب على الفاتورة (invoice.note لفاتورة البيع)
    party: customer ? `الزبون: ${customer.name}` : supplier ? `التاجر: ${supplier.name}` : invoiceName(invoice) ? `الاسم: ${invoiceName(invoice)}` : '',
    rows: lines.map((l) => ({
      name: l.name,
      calc: `${formatQty(l.qty)} × ${formatMoney(l.unit_price, cur, { symbol: false })}${l.discount ? ` − ${formatMoney(l.discount, cur, { symbol: false })}` : ''}`,
      total: m(l.total),
    })),
    totals,
    foot: invoice.type === 'sale' && !voided ? 'شكرًا لتعاملكم معنا' : '',
  };
}

/** الاسم المكتوب على فاتورة بيع لزبون عابر (بلا حساب)، أو ''. */
export function invoiceName(invoice) {
  return invoice && invoice.type === 'sale' && !invoice.customer_id && invoice.note ? String(invoice.note) : '';
}

/** الفاتورة ملغاة؟ والتي حلّت مكانها فاتورة معدَّلة تُسمّى «عُدّلت». replacedIds: أرقام الفواتير التي عُدّلت. */
export const isVoid = (i) => i.status === 'void';
export function replacedIds(invoices) {
  return new Set(invoices.filter((i) => i.type === 'sale' && i.original_invoice_id && !i.deleted).map((i) => i.original_invoice_id));
}

/**
 * سند قبض: ورقة للزبون حين يدفع من دينه (بنفس شكل الفاتورة: شاشة، صورة، نص، طباعة).
 * data: { payment, customer, shop, methodName, balanceAfter } — balanceAfter رصيد الزبون بعد الدفعة (موجب = عليه).
 */
export function voucherModel({ payment, customer = null, shop = {}, methodName = null, balanceAfter = null }) {
  const cur = payment.currency || 'ILS';
  const m = (v) => formatMoney(v, cur);
  const totals = [{ label: 'المبلغ المستلم', value: m(payment.amount), strong: true }];
  totals.push({ label: 'طريقة الدفع', value: methodName || (payment.method_kind === 'transfer' ? 'تحويل' : 'نقدًا') });
  if (Number.isSafeInteger(balanceAfter)) {
    totals.push({ label: 'الرصيد قبل الدفعة', value: m(balanceAfter + payment.amount) });
    totals.push({ label: balanceAfter > 0 ? 'الباقي عليه' : balanceAfter < 0 ? 'له عندنا' : 'الباقي', value: m(Math.abs(balanceAfter)) });
  }
  return {
    shopName: shop.name || '', shopPhone: shop.phone || '', shopAddress: shop.address || '',
    title: 'سند قبض', number: payment.number || '', date: dateTimeText(payment.created_at),
    party: customer ? `استلمنا من: ${customer.name}` : '',
    rows: [], totals,
    foot: Number.isSafeInteger(balanceAfter) && balanceAfter <= 0 ? 'سُدّد الحساب كاملًا — شكرًا لكم' : 'شكرًا لكم',
  };
}

/** نص الفاتورة لرسالة واتساب (الأخف على الإنترنت الضعيف). */
export function invoiceText(model) {
  const out = [`*${model.shopName}*`];
  if (model.shopPhone) out.push(model.shopPhone);
  out.push(`${model.title} ${model.number}`.trim(), model.date);
  if (model.party) out.push(model.party);
  out.push('——————');
  for (const r of model.rows) out.push(`${r.name}\n   ${r.calc} = ${r.total}`);
  if (model.rows.length) out.push('——————');
  for (const t of model.totals) out.push(t.strong ? `*${t.label}: ${t.value}*` : `${t.label}: ${t.value}`);
  if (model.foot) out.push(model.foot);
  return out.join('\n');
}

/**
 * بحث في سجل الفواتير. filter: { query, type ('' = الكل، 'void' = الملغاة), from (ISO أو null) }.
 * الملغاة لا تظهر إلا في تبويبها: السجل يعرض ما هو قائم فعلًا. والبحث يطابق أيضًا الاسم المكتوب على الفاتورة.
 * extra: { customerNames: Map(id→اسم), supplierNames, productHits: Set(invoice_id) — فواتير فيها صنف يطابق البحث }.
 */
export function filterInvoices(invoices, { query = '', type = '', from = null } = {}, { customerNames = new Map(), supplierNames = new Map(), productHits = new Set() } = {}) {
  const q = normalizeArabic(query);
  return invoices.filter((i) => {
    if (i.deleted) return false;
    if (type === 'void' ? !isVoid(i) : isVoid(i)) return false;
    if (type && type !== 'void' && i.type !== type) return false;
    if (from && i.created_at < from) return false;
    if (!q) return true;
    if (matchesInvoiceNumber(i.number, query)) return true;
    const party = normalizeArabic(customerNames.get(i.customer_id) || supplierNames.get(i.supplier_id) || invoiceName(i));
    return (party && party.includes(q)) || productHits.has(i.id);
  }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * ملف PDF من صور JPEG (صفحة لكل صورة بمقاسها). بلا مكتبات: الصورة تحمل النص العربي كما رسمه الجهاز.
 * pages: [{ jpeg: Uint8Array, width, height }] بالبكسل. scale: كم بكسل لكل نقطة PDF.
 */
export function pdfFromJpegs(pages, scale = 2) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let size = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n${body}\nendobj\n`); };
  const total = 2 + pages.length * 3;
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((pg, i) => {
    const n = 3 + i * 3;
    const W = Math.round(pg.width / scale), H = Math.round(pg.height / scale);
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`);
    offsets[n + 1] = size;
    push(`${n + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`);
    push(pg.jpeg);
    push('\nendstream\nendobj\n');
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(n + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const xref = size;
  let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** ملف PDF من صورة واحدة. */
export function pdfFromJpeg(jpeg, width, height, scale = 2) {
  return pdfFromJpegs([{ jpeg, width, height }], scale);
}
