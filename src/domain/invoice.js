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
  totals.push({ label: 'الإجمالي', value: m(invoice.total), strong: true });
  if (invoice.type === 'purchase' && invoice.paid < invoice.total) totals.push({ label: 'على الحساب', value: m(invoice.total - invoice.paid) });
  for (const p of payments) {
    totals.push({ label: p.method_kind === 'credit' ? 'آجل (على الحساب)' : (methodNames.get(p.method_id) || 'نقدًا'), value: m(p.amount) });
  }
  return {
    shopName: shop.name || '', shopPhone: shop.phone || '', shopAddress: shop.address || '',
    title: INVOICE_TITLES[invoice.type] || 'فاتورة', number: invoice.number, date: dateTimeText(invoice.created_at),
    party: customer ? `الزبون: ${customer.name}` : supplier ? `المورّد: ${supplier.name}` : '',
    rows: lines.map((l) => ({
      name: l.name,
      calc: `${formatQty(l.qty)} × ${formatMoney(l.unit_price, cur, { symbol: false })}${l.discount ? ` − ${formatMoney(l.discount, cur, { symbol: false })}` : ''}`,
      total: m(l.total),
    })),
    totals,
    foot: invoice.type === 'sale' ? 'شكرًا لتعاملكم معنا' : '',
  };
}

/** نص الفاتورة لرسالة واتساب (الأخف على الإنترنت الضعيف). */
export function invoiceText(model) {
  const out = [`*${model.shopName}*`];
  if (model.shopPhone) out.push(model.shopPhone);
  out.push(`${model.title} ${model.number}`, model.date);
  if (model.party) out.push(model.party);
  out.push('——————');
  for (const r of model.rows) out.push(`${r.name}\n   ${r.calc} = ${r.total}`);
  out.push('——————');
  for (const t of model.totals) out.push(t.strong ? `*${t.label}: ${t.value}*` : `${t.label}: ${t.value}`);
  if (model.foot) out.push(model.foot);
  return out.join('\n');
}

/**
 * بحث في سجل الفواتير. filter: { query, type ('' = الكل), from (ISO أو null) }.
 * extra: { customerNames: Map(id→اسم), supplierNames, productHits: Set(invoice_id) — فواتير فيها صنف يطابق البحث }.
 */
export function filterInvoices(invoices, { query = '', type = '', from = null } = {}, { customerNames = new Map(), supplierNames = new Map(), productHits = new Set() } = {}) {
  const q = normalizeArabic(query);
  return invoices.filter((i) => {
    if (i.deleted) return false;
    if (type && i.type !== type) return false;
    if (from && i.created_at < from) return false;
    if (!q) return true;
    if (matchesInvoiceNumber(i.number, query)) return true;
    const party = normalizeArabic(customerNames.get(i.customer_id) || supplierNames.get(i.supplier_id) || '');
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
