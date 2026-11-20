// طابعة الفواتير: أندرويد ← طابعة حرارية بلوتوث (ThermalPrinterPlugin)، والحاسوب والمتصفح ← نافذة الطباعة
// (طابعة USB أو أي طابعة معرّفة في ويندوز). الإعداد لكل جهاز (meta 'printer'): { address, name, paper, auto }.
import { PAPER, toMono, trimBottom, escposRaster, toBase64 } from '../domain/printer.js';
import { loadInvoiceData, renderInvoiceCanvas } from '../features/invoices/render.js';
import { app } from './app.js';

const native = () => globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins.ThermalPrinter || null : null;

export const printer = {
  /** هل على هذا الجهاز طباعة بلوتوث (أندرويد)؟ وإلا فنافذة طباعة النظام. */
  get bluetooth() { return !!native(); },
  async settings() {
    const s = (await app.meta.get('printer')) || {};
    return { address: s.address || null, name: s.name || null, paper: PAPER[s.paper] ? s.paper : 58, auto: !!s.auto };
  },
  async save(patch) { await app.meta.set('printer', { ...(await printer.settings()), ...patch }); },
  /** جاهزة للطباعة؟ (بلوتوث: طابعة مختارة. الحاسوب/المتصفح: دائمًا) */
  async ready() { return printer.bluetooth ? !!(await printer.settings()).address : true; },
  /** الطابعات المقترنة بالجوال. يرمي خطأ مفهومًا (البلوتوث مطفأ، بلا إذن…). */
  async paired() {
    try { return (await native().list()).devices || []; } catch (e) { throw friendly(e); }
  },
  async printInvoice(invoiceId) {
    const { model, logoUrl } = await loadInvoiceData(invoiceId);
    return printCanvas(await renderInvoiceCanvas(model, logoUrl));
  },
  /** يطبع أي نموذج بشكل الفاتورة (سند القبض مثلًا). */
  async printModel(model, logoUrl = null) {
    return printCanvas(await renderInvoiceCanvas(model, logoUrl));
  },
  async test() {
    const c = document.createElement('canvas');
    c.width = 720; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 720, 300);
    g.fillStyle = '#000'; g.textAlign = 'center'; g.direction = 'rtl';
    g.font = '700 46px system-ui, sans-serif'; g.fillText(app.shop?.name || 'دفترة كاشير', 360, 90);
    g.font = '400 34px system-ui, sans-serif'; g.fillText('تجربة الطابعة — الطباعة تعمل ✓', 360, 170);
    g.fillText(new Date().toLocaleString('en-GB'), 360, 240);
    return printCanvas(c);
  },
};

function friendly(e) {
  const code = e && (e.code || e.message);
  if (code === 'BT_OFF' || /off/.test(code)) return new Error('شغّل البلوتوث في الجوال ثم حاول');
  if (code === 'NO_BT') return new Error('هذا الجهاز بلا بلوتوث');
  if (code === 'PERMISSION' || /permission/i.test(code)) return new Error('اسمح للتطبيق بالاتصال بأجهزة بلوتوث القريبة');
  if (code === 'PRINT_FAILED' || /socket|connect|read failed|timeout/i.test(String(code))) return new Error('لم نصل إلى الطابعة — تأكد أنها مشغّلة وقريبة');
  return new Error('تعذّرت الطباعة');
}

async function printCanvas(src) {
  const s = await printer.settings();
  if (!native()) return systemPrint(src);
  if (!s.address) throw new Error('اختر الطابعة من الإعدادات أولًا');
  // نصغّر الصورة إلى عرض الورق بالنقاط ثم أبيض/أسود
  const width = PAPER[s.paper];
  const height = Math.round(src.height * (width / src.width));
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, width, height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, width, height);
  const mono = trimBottom(toMono(g.getImageData(0, 0, width, height).data, width, height, 170));
  try { await native().print({ address: s.address, data: toBase64(escposRaster(mono)) }); } catch (e) { throw friendly(e); }
}

/** الحاسوب والمتصفح: الفاتورة صورةً في إطار مخفي ثم نافذة الطباعة. */
function systemPrint(src) {
  return new Promise((resolve) => {
    const url = src.toDataURL('image/png');
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.append(f);
    const d = f.contentDocument;
    d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}html,body{margin:0}img{width:100%;display:block}</style></head><body><img src="${url}"></body></html>`);
    d.close();
    const img = d.querySelector('img');
    const go = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } finally { setTimeout(() => { f.remove(); resolve(); }, 1000); } }, 50); };
    if (img.complete) go(); else img.onload = go;
  });
}
