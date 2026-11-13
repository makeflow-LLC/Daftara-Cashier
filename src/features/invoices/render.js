// يرسم الفاتورة صورةً على canvas من نموذجها (domain/invoice.js): الجهاز نفسه يشكّل الحروف العربية،
// فلا خطوط ولا مكتبات. منها صورة واتساب (JPEG) وملف PDF.
import { receiptModel, pdfFromJpeg } from '../../domain/invoice.js';
import { app } from '../../core/app.js';

const W = 720;
const PAD = 40;
const FONT = '"Noto Naskh Arabic","Noto Sans Arabic",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif';

/** يجلب كل ما تحتاجه الفاتورة من قاعدة الجهاز. */
export async function loadInvoiceData(invoiceId) {
  const { invoice, lines } = await app.sales.invoice(invoiceId);
  const [payments, methods, customer, supplier, logoUrl] = await Promise.all([
    app.db.payments.where('invoice_id').equals(invoiceId).toArray(),
    app.db.payment_methods.toArray(),
    invoice.customer_id ? app.db.customers.get(invoice.customer_id) : null,
    invoice.supplier_id ? app.db.suppliers.get(invoice.supplier_id) : null,
    app.media.logoUrl(),
  ]);
  const data = { invoice, lines, payments, methodNames: new Map(methods.map((m) => [m.id, m.name])), customer, supplier, shop: app.shop || {} };
  return { ...data, model: receiptModel(data), logoUrl };
}

function wrap(g, text, max) {
  const words = String(text).split(' ');
  const out = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (line && g.measureText(t).width > max) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function loadImg(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** يرسم الفاتورة ويرجع canvas. */
export async function renderInvoiceCanvas(model, logoUrl = null) {
  const logo = await loadImg(logoUrl);
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d');
  // نحسب الارتفاع أولًا (الأسماء الطويلة تنكسر على سطرين)
  g0.font = `600 30px ${FONT}`;
  const nameLines = model.rows.map((r) => wrap(g0, r.name, W - PAD * 2));
  let H = PAD + (logo ? 110 : 0) + 56 + (model.shopPhone ? 36 : 0) + (model.shopAddress ? 36 : 0) + 30 + 50 + (model.party ? 44 : 0) + 20;
  nameLines.forEach((ls) => { H += ls.length * 40 + 40 + 14; });
  H += 20 + model.totals.reduce((a, t) => a + (t.strong ? 64 : 42), 0) + (model.foot ? 70 : 20) + PAD;
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'top';
  const R = W - PAD, L = PAD;
  const text = (s, x, y, { size = 28, weight = 400, color = '#201e1d', align = 'right', dir = 'rtl' } = {}) => {
    g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.direction = dir; g.fillText(s, x, y);
  };
  const dash = (y) => { g.strokeStyle = '#bab6b6'; g.lineWidth = 2; g.setLineDash([8, 6]); g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.setLineDash([]); };
  let y = PAD;
  if (logo) { const s = Math.min(96 / logo.width, 96 / logo.height); g.drawImage(logo, (W - logo.width * s) / 2, y, logo.width * s, logo.height * s); y += 110; }
  text(model.shopName, W / 2, y, { size: 40, weight: 700, align: 'center' }); y += 56;
  if (model.shopPhone) { text(model.shopPhone, W / 2, y, { size: 26, color: '#605d5d', align: 'center', dir: 'ltr' }); y += 36; }
  if (model.shopAddress) { text(model.shopAddress, W / 2, y, { size: 26, color: '#605d5d', align: 'center' }); y += 36; }
  y += 10; dash(y); y += 20;
  text(`${model.title} ${model.number}`, R, y, { size: 28, weight: 700 });
  text(model.date, L, y, { size: 26, weight: 600, align: 'left', dir: 'ltr' }); y += 50;
  if (model.party) { text(model.party, R, y, { size: 28 }); y += 44; }
  dash(y); y += 20;
  model.rows.forEach((r, i) => {
    for (const ln of nameLines[i]) { text(ln, R, y, { size: 30, weight: 600 }); y += 40; }
    text(r.calc, R, y, { size: 26, color: '#605d5d', dir: 'ltr', align: 'right' });
    text(r.total, L, y, { size: 28, weight: 700, align: 'left', dir: 'ltr' }); y += 40 + 14;
  });
  dash(y); y += 20;
  for (const t of model.totals) {
    const size = t.strong ? 40 : 28;
    text(t.label, R, y, { size, weight: t.strong ? 700 : 400, color: t.strong ? '#201e1d' : '#605d5d' });
    text(t.value, L, y, { size, weight: 700, align: 'left', dir: 'ltr', color: t.strong ? '#0e7a51' : '#201e1d' });
    y += t.strong ? 64 : 42;
  }
  if (model.foot) { y += 16; text(model.foot, W / 2, y, { size: 26, color: '#605d5d', align: 'center' }); }
  return c;
}

function canvasBlob(canvas, type, q) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, q));
}

/** الفاتورة كملف: 'image' (JPEG) أو 'pdf'. يرجع { blob, name, mime, model }. */
export async function invoiceFile(invoiceId, kind = 'image') {
  const { model, logoUrl } = await loadInvoiceData(invoiceId);
  const canvas = await renderInvoiceCanvas(model, logoUrl);
  const jpeg = await canvasBlob(canvas, 'image/jpeg', 0.9);
  const base = `invoice-${model.number}`;
  if (kind === 'pdf') {
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    return { blob: new Blob([pdfFromJpeg(bytes, canvas.width, canvas.height)], { type: 'application/pdf' }), name: `${base}.pdf`, mime: 'application/pdf', model };
  }
  return { blob: jpeg, name: `${base}.jpg`, mime: 'image/jpeg', model };
}
