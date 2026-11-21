// التقارير: اختر المدة (اليوم، 7 أيام، هذا الشهر، مخصص) ← كل شيء في صفحة واحدة:
// المبيعات والربح، أعمدة الأيام، طرق الدفع، التصنيفات، الأكثر والأقل مبيعًا، والوضع الآن (مخزون وديون).
// زرّان للتصدير: PDF و Excel.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, button, input, money, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { buildReport, periodRange, reportSections, reportSheets } from '../../domain/reports.js';
import { pdfFromJpeg } from '../../domain/invoice.js';
import { stockValue } from '../../domain/stock.js';
import { formatMoney } from '../../domain/currency.js';
import { app } from '../../core/app.js';
import { sendFile } from '../invoices/share.js';
import { staffName } from '../../domain/staff.js';
import { navigate } from '../../core/router.js';

const KINDS = [['today', 'اليوم'], ['week', '7 أيام'], ['month', 'هذا الشهر'], ['lastMonth', 'الشهر الماضي'], ['year', 'هذه السنة'], ['lastYear', 'السنة الماضية'], ['custom', 'مخصص']];
// أقسام تظهر حتى بلا مبيعات (مصاريف شهر بلا بيع خسارة يجب أن تُرى)
const ALWAYS = new Set(['الوضع الآن', 'الأرباح والخسائر', 'المصاريف حسب البند', 'شهرًا بشهر']);
const FONT = '"Noto Naskh Arabic","Noto Sans Arabic",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif';

export async function loadData(range) {
  const db = app.db;
  const invoices = await db.invoices.where('created_at').between(range.from, range.to, true, false).toArray();
  const ids = new Set(invoices.map((i) => i.id));
  const [lines, payments, products, categories, methods, expenses, movements] = await Promise.all([
    db.invoice_lines.toArray().then((ls) => ls.filter((l) => ids.has(l.invoice_id))),
    db.payments.where('created_at').between(range.from, range.to, true, false).toArray(),
    db.products.toArray(), db.categories.toArray(), db.payment_methods.toArray(),
    db.expenses.where('spent_at').between(range.from, range.to, true, false).toArray(),
    db.movements.where('created_at').between(range.from, range.to, true, false).toArray(),
  ]);
  return { invoices, lines, payments, products, categories, methods, expenses, movements, from: range.from, to: range.to };
}

async function snapshot() {
  const [ps, c, s] = await Promise.all([app.inventory.productsWithStock(), app.customers.totals(), app.inventory.supplierTotals()]);
  return {
    stockCost: ps.reduce((a, p) => a + stockValue(p.qty, p.avg_cost), 0), stockSell: ps.reduce((a, p) => a + stockValue(p.qty, p.sell_price), 0),
    customerDebts: c.total, supplierBalances: s.total,
  };
}

/** يرسم التقرير صفحة واحدة طويلة (للـ PDF). */
function renderDoc(title, sub, sections) {
  const W = 800, PAD = 40, ROW = 44;
  let H = PAD + 60 + 44 + 20;
  for (const s of sections) H += 64 + ROW + s.rows.length * ROW + 24;
  H += PAD;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';
  const t = (s, x, y, { size = 24, weight = 400, color = '#201e1d', align = 'right', dir = 'rtl' } = {}) => { g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.direction = dir; g.fillText(String(s), x, y); };
  let y = PAD + 24;
  t(title, W / 2, y, { size: 36, weight: 700, align: 'center' }); y += 52;
  t(sub, W / 2, y, { size: 24, color: '#605d5d', align: 'center' }); y += 40;
  for (const s of sections) {
    y += 20;
    t(s.title, W - PAD, y + 16, { size: 28, weight: 700, color: '#0e7a51' }); y += 44;
    const n = s.head.length;
    const first = n === 2 ? 0.6 : 0.4;
    const colW = (i) => (W - PAD * 2) * (i === 0 ? first : (1 - first) / (n - 1));
    const colX = (i) => { let x = W - PAD; for (let k = 0; k < i; k++) x -= colW(k); return x; };
    g.fillStyle = '#e8f5ee'; g.fillRect(PAD, y, W - PAD * 2, ROW);
    s.head.forEach((hd, i) => t(hd, i === 0 ? colX(0) - 10 : colX(i) - colW(i) + 10, y + ROW / 2, { size: 22, weight: 700, align: i === 0 ? 'right' : 'left' }));
    y += ROW;
    s.rows.forEach((r, ri) => {
      if (ri % 2) { g.fillStyle = '#f8f4f4'; g.fillRect(PAD, y, W - PAD * 2, ROW); }
      r.forEach((cell, i) => {
        let text = String(cell);
        if (i === 0) { g.font = `400 24px ${FONT}`; while (g.measureText(text).width > colW(0) - 20 && text.length > 4) text = `${text.slice(0, -2)}…`; }
        t(text, i === 0 ? colX(0) - 10 : colX(i) - colW(i) + 10, y + ROW / 2, { align: i === 0 ? 'right' : 'left', dir: i === 0 ? 'rtl' : 'ltr', weight: i === 0 ? 400 : 600 });
      });
      y += ROW;
    });
    y += 4;
  }
  return c;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (globalThis.Xlsx) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
}

export function renderReports(el) {
  let kind = 'today';
  const today = new Date().toLocaleDateString('en-CA');
  const fromIn = input({ type: 'date', dir: 'ltr', value: today });
  const toIn = input({ type: 'date', dir: 'ltr', value: today });
  const chips = h('div', { class: 'chips chips-scroll' });
  const customRow = h('div', { class: 'grid-2', hidden: true }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'من'), fromIn), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'إلى'), toIn));
  const body = h('div');
  let current = null;
  const showProfit = app.can('see_profit');
  const cur = app.shop?.base_currency || 'ILS';

  el.append(header('التقارير', { back: true }), h('div', { class: 'page' }, chips, customRow, body));

  function range() {
    return periodRange(kind, new Date(), kind === 'custom' ? { from: fromIn.value <= toIn.value ? fromIn.value : toIn.value, to: toIn.value >= fromIn.value ? toIn.value : fromIn.value } : null);
  }

  async function load() {
    fill(chips, ...KINDS.map(([k, l]) => h('button', { class: `chip ${kind === k ? 'on' : ''}`, type: 'button', onclick: () => { kind = k; load(); } }, l)));
    customRow.hidden = kind !== 'custom';
    const rg = range();
    const [r, snap] = await Promise.all([loadData(rg).then(buildReport), snapshot()]);
    const st = app.shop?.settings?.staff;
    const sections = reportSections(r, snap, { currency: cur, showProfit, staffName: st && st.members?.length ? (id) => staffName(st, id) : null });
    current = { r, sections, label: rg.label };
    // مدة طويلة (سنة): أعمدة الشهور بدل مئات الأيام
    const monthly = r.byDay.length > 62;
    const barsData = monthly ? r.byMonth.map((x) => ({ key: x.month, sales: x.sales, label: String(Number(x.month.slice(5))) })) : r.byDay.map((d) => ({ key: d.day, sales: d.sales, label: d.day.slice(8) }));
    const maxDay = Math.max(1, ...barsData.map((d) => d.sales));
    const loss = r.netProfit < 0;
    const any = r.invoiceCount || r.returnCount || r.expensesTotal || r.damageTotal;
    // الحاسوب: كل قسم جدول يُرتَّب بأي عمود (الأرقام تُقرأ من نصها المنسّق)
    const asNumber = (v) => { const t = String(v).replace(/[^0-9.\-−]/g, '').replace('−', '-'); return t && !Number.isNaN(Number(t)) ? Number(t) : String(v); };
    const wideTable = (s) => {
      const cols = Math.max(...s.rows.map((r) => r.length), s.head.length);
      const head = s.head.length >= cols ? s.head : ['البند', 'القيمة', ...Array(Math.max(0, cols - 2)).fill('')];
      return h('div', { class: 'section' }, h('h2', { class: 'section-title' }, s.title), dataTable({
        rows: s.rows,
        pageSize: 15,
        columns: Array.from({ length: cols }, (_, i) => ({
          key: `c${i}`, label: head[i] || '', grow: i === 0, num: i > 0,
          by: cols > 2 ? (row) => (i === 0 ? String(row[0]) : asNumber(row[i] ?? '')) : null,
          cell: (row) => (i === 0 ? h('strong', null, row[0]) : num(row[i] ?? '')),
        })),
      }));
    };
    const table = (s) => (isWide() ? wideTable(s) : narrowTable(s));
    const narrowTable = (s) => h('div', { class: 'section' }, h('h2', { class: 'section-title' }, s.title),
      h('div', { class: 'list rep-table' },
        s.head.length > 2 ? h('div', { class: 'row rep-row rep-head' }, h('span', { class: 'row-main' }, s.head[0]), ...s.head.slice(1).map((c) => h('span', { class: 'rep-cell' }, c))) : null,
        ...s.rows.map((row) => h('div', { class: 'row rep-row' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, row[0])),
        ...row.slice(1).map((c) => h('span', { class: `rep-cell ${row.length === 2 ? 'strong' : ''}` }, num(c)))))));
    fill(body,
      h('div', { class: 'rep-top' },
      h('div', { class: 'hero-card rep-hero' },
        h('div', { class: 'hero-label' }, `صافي المبيعات — ${rg.label}`),
        h('div', { class: 'hero-value' }, money(r.net)),
        h('div', { class: 'hero-row' },
          showProfit ? h('div', null, h('span', { class: 'hero-mini-label' }, 'ربح البضاعة'), money(r.profit, undefined, r.profit < 0 ? 'neg' : '')) : null,
          h('div', null, h('span', { class: 'hero-mini-label' }, 'الفواتير'), num(String(r.invoiceCount))),
          h('div', null, h('span', { class: 'hero-mini-label' }, 'متوسط الفاتورة'), money(r.avgInvoice)))),
      // صافي الربح أو الخسارة: ربح البضاعة − المصاريف − التالف («شو ربحت وشو خسرت»)
      showProfit ? h('button', { class: `balance-card pnl-card ${loss ? 'owed' : 'clear'}`, type: 'button', onclick: () => navigate('/expenses') },
        h('div', { class: 'hero-label' }, `${loss ? 'صافي الخسارة' : 'صافي الربح'} — ${rg.label}`),
        h('div', { class: 'hero-value' }, money(Math.abs(r.netProfit))),
        h('div', { class: 'hero-mini-label' }, 'ربح البضاعة ', num(formatMoney(r.profit, cur)), ' − المصاريف ', num(formatMoney(r.expensesTotal, cur)),
          r.damageTotal ? [' − تالف ', num(formatMoney(r.damageTotal, cur))] : null),
        r.expensesTotal ? null : h('div', { class: 'hero-mini-label' }, 'لم تسجّل مصاريف في هذه المدة — اضغط لتسجيل الكهرباء والإيجار والرواتب')) : null),
      h('button', { class: 'beta-banner daily-banner', type: 'button', onclick: () => navigate('/reports/daily') },
        icon('chart', 26), h('span', { class: 'row-main' }, h('strong', null, 'تقرير اليوم بالرسوم البيانية'), h('span', null, 'ملف PDF ملوّن: مقارنة بأمس والأسبوع الماضي، الساعات، الأكثر مبيعًا')), icon('chevron', 20)),
      h('div', { class: 'product-actions' },
        button('PDF', { kind: 'outline', icon: 'receipt', onclick: () => exportFile('pdf') }),
        button('Excel', { kind: 'outline', icon: 'clipboard', onclick: () => exportFile('xlsx') })),
      barsData.length > 1 ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, monthly ? 'المبيعات شهرًا بشهر' : 'المبيعات يومًا بيوم'),
        h('div', { class: 'card bars' }, ...barsData.map((d) => h('div', { class: 'bar-col', title: formatMoney(d.sales, cur) },
          h('div', { class: 'bar', style: { height: `${Math.max(3, Math.round((Math.max(0, d.sales) / maxDay) * 100))}%` } }),
          h('span', { class: 'bar-label num' }, d.label))))) : null,
      r.invoiceCount || r.returnCount ? null : emptyState('chart', 'لا مبيعات في هذه المدة', 'اختر مدة أخرى من الأعلى.'),
      h('div', { class: 'rep-grid' }, ...sections.filter((s) => s.title !== 'حسب اليوم' && (r.invoiceCount || (ALWAYS.has(s.title) && (any || s.title === 'الوضع الآن')))).map(table)),
    );
  }

  async function exportFile(type) {
    if (!current) return;
    const name = `report-${new Date().toLocaleDateString('en-CA')}`;
    const sub = `${app.shop.name} — ${current.label}`;
    try {
      let file;
      if (type === 'pdf') {
        const canvas = renderDoc('تقرير المبيعات', sub, current.sections);
        const jpeg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
        const bytes = new Uint8Array(await jpeg.arrayBuffer());
        file = { blob: new Blob([pdfFromJpeg(bytes, canvas.width, canvas.height)], { type: 'application/pdf' }), name: `${name}.pdf`, mime: 'application/pdf' };
      } else {
        await loadScript('vendor/xlsx.js');
        const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        file = { blob: new Blob([globalThis.Xlsx.build(reportSheets(current.sections))], { type: mime }), name: `${name}.xlsx`, mime };
      }
      await sendFile(file, '', `تقرير ${sub}`, { chooser: true });
    } catch (e) { console.error(e); feedback.error(); toast('تعذّر التصدير', { kind: 'error' }); }
  }

  fromIn.addEventListener('change', load);
  toIn.addEventListener('change', load);
  load();
}
