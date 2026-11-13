// أدوات الأصناف: استيراد من Excel/CSV بمطابقة الأعمدة، تصدير، تحديث الأسعار جماعيًا (مع معاينة وتراجع)،
// ملصقات الباركود A4، والنسخة الاحتياطية.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, row, button, input, field, emptyState, money } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { readTable } from '../../domain/files.js';
import { IMPORT_FIELDS, guessMapping, hasHeaderRow, rowsToProducts, bulkPrice, eanModules, labelPages } from '../../domain/tools.js';
import { pdfFromJpegs } from '../../domain/invoice.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { parseDecimal } from '../../domain/money.js';
import { formatQty, QTY_SCALE } from '../../domain/units.js';
import { isInternalBarcode } from '../../domain/product.js';
import { uuid } from '../../core/ids.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { exportBackup, checkBackup, restoreBackup } from '../../core/backup.js';
import { sendFile } from '../invoices/share.js';

const cur = () => app.shop?.base_currency || 'ILS';
const today = () => new Date().toLocaleDateString('en-CA');
const FONT = '"Noto Naskh Arabic","Noto Sans Arabic",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif';

function pickFile(accept) {
  return new Promise((resolve) => {
    const f = h('input', { type: 'file', accept, style: { display: 'none' } });
    f.addEventListener('change', () => { const file = f.files && f.files[0]; f.remove(); resolve(file || null); });
    document.body.append(f);
    f.click();
  });
}
function loadXlsx() {
  return new Promise((resolve, reject) => {
    if (globalThis.Xlsx) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.js'; s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
}

// ============ القائمة ============
export function renderTools(el) {
  const go = (p) => () => navigate(p);
  el.append(header('أدوات', { back: true }), h('div', { class: 'page' },
    h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'الأصناف'), h('div', { class: 'list' },
      row({ icon: 'clipboard', title: 'استيراد أصناف من Excel', sub: 'ملف ‎.xlsx أو CSV — تختار أي عمود هو الاسم والسعر', onclick: go('/tools/import') }),
      row({ icon: 'tag', title: 'تحديث الأسعار', sub: 'رفع أو تخفيض بنسبة أو مبلغ، لتصنيف أو للكل', onclick: go('/tools/prices') }),
      app.feature('labels') ? row({ icon: 'scan', title: 'ملصقات الباركود', sub: 'ورقة A4 للطباعة للأصناف بلا باركود', onclick: go('/tools/labels') }) : null,
      row({ icon: 'receipt', title: 'تصدير الأصناف إلى Excel', sub: 'كل الأصناف بأسعارها ومخزونها', onclick: exportProducts }))),
    h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'النسخة الاحتياطية'), h('div', { class: 'list' },
      row({ icon: 'cloudUp', title: 'احفظ نسخة احتياطية', sub: 'ملف فيه كل بيانات المحل — أرسله لنفسك على واتساب', onclick: saveBackup }),
      row({ icon: 'undo', title: 'استعادة نسخة', sub: 'تستبدل كل ما على هذا الجوال بما في الملف', onclick: () => restoreFromFile() }))),
  ));
}

async function exportProducts() {
  try {
    const [ps, cats] = await Promise.all([app.products.list(), app.products.categories()]);
    const cn = new Map(cats.map((c) => [c.id, c.name]));
    const minor = 10 ** CURRENCIES[cur()].minor;
    const rows = [['الاسم', 'الباركود', 'سعر البيع', 'سعر التكلفة', 'الكمية', 'التصنيف'],
      ...ps.map((p) => [p.name, p.barcode || '', p.sell_price / minor, app.can('see_cost') ? p.cost_price / minor : '', p.qty / QTY_SCALE, cn.get(p.category_id) || ''])];
    await loadXlsx();
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    await sendFile({ blob: new Blob([globalThis.Xlsx.build([{ name: 'الأصناف', cols: [32, 18, 12, 12, 10, 16], rows }])], { type: mime }), name: `products-${today()}.xlsx`, mime }, '', 'أصناف المحل', { chooser: true });
  } catch (e) { console.error(e); feedback.error(); toast('تعذّر التصدير', { kind: 'error' }); }
}

async function saveBackup() {
  try {
    const data = await exportBackup(app.db);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    await sendFile({ blob, name: `cashier-backup-${today()}.json`, mime: 'application/json' }, '', `نسخة احتياطية — ${app.shop.name}`, { chooser: true });
    await app.meta.set('lastBackupAt', new Date().toISOString());
  } catch (e) { console.error(e); feedback.error(); toast('تعذّر حفظ النسخة', { kind: 'error' }); }
}

/** يُستعمل من الأدوات ومن شاشة الإعداد الأول. */
export async function restoreFromFile() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let data, info;
  try { data = JSON.parse(await file.text()); info = checkBackup(data); }
  catch (e) { feedback.error(); toast(/نسخة|تالف|ناقص|أحدث/.test(e.message) ? e.message : 'الملف غير مقروء — اختر ملف cashier-backup-….json', { kind: 'error', ms: 5000 }); return; }
  const c = info.counts;
  openSheet((close) => h('div', null,
    h('div', { class: 'debt-card' }, h('div', { class: 'hero-label' }, 'نسخة محل'), h('div', { class: 'hero-value', style: { fontSize: '28px' } }, info.shopName),
      h('div', { class: 'hero-mini-label' }, `${c.products || 0} صنف · ${c.customers || 0} زبون · ${c.invoices || 0} فاتورة`)),
    h('p', null, h('strong', null, 'تنبيه: '), 'كل البيانات الموجودة الآن على هذا الجوال ستُستبدل بما في الملف.'),
    button('استعد هذه النسخة', { kind: 'danger', block: true, size: 'lg', icon: 'undo', onclick: async () => {
      try { await restoreBackup(app.db, data); feedback.ok(); close(); location.hash = '#/'; location.reload(); }
      catch (e) { console.error(e); feedback.error(); toast('تعذّرت الاستعادة — لم يتغيّر شيء', { kind: 'error' }); }
    } }),
    button('إلغاء', { kind: 'text', onclick: close }),
  ), { title: 'استعادة نسخة' });
}

// ============ الاستيراد ============
export function renderImport(el) {
  const body = h('div');
  el.append(header('استيراد أصناف', { back: true }), h('div', { class: 'page' }, body));
  let rows = [];
  let mapping = {};
  let header1 = true;

  function start() {
    fill(body, emptyState('clipboard', 'اختر ملف الأصناف', 'ملف Excel (‎.xlsx) أو CSV، كل صنف في سطر. يكفي عمود الاسم وعمود سعر البيع.',
      button('اختر الملف', { icon: 'clipboard', onclick: choose })));
  }
  async function choose() {
    const file = await pickFile('.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (!file) return;
    try {
      rows = readTable(new Uint8Array(await file.arrayBuffer()), file.name);
      if (!rows.length) throw new Error('الملف فارغ');
      header1 = hasHeaderRow(rows);
      mapping = header1 ? guessMapping(rows[0]) : { name: 0, sell_price: rows[0].length > 1 ? 1 : -1, barcode: -1, cost_price: -1, qty: -1, category: -1 };
      map();
    } catch (e) { feedback.error(); toast(e.message || 'الملف غير مقروء', { kind: 'error', ms: 5000 }); }
  }
  function map() {
    const width = Math.max(...rows.slice(0, 20).map((r) => r.length));
    const sample = rows[header1 ? 1 : 0] || [];
    const colLabel = (i) => (header1 && rows[0][i] ? rows[0][i] : `العمود ${i + 1}`) + (sample[i] ? ` (مثال: ${String(sample[i]).slice(0, 18)})` : '');
    const data = () => rowsToProducts(header1 ? rows.slice(1) : rows, mapping, { currency: cur() });
    const summary = h('div');
    const paintSummary = () => {
      const ok = mapping.name >= 0 && mapping.sell_price >= 0;
      const r = ok ? data() : null;
      fill(summary,
        ok ? h('div', { class: 'pay-remaining ok' }, h('span', null, 'جاهز للاستيراد'), h('span', null, num(String(r.items.length)), ' صنف')) : h('div', { class: 'pay-remaining bad' }, h('span', null, 'اختر عمود الاسم وعمود سعر البيع')),
        r && r.skipped.length ? h('p', { class: 'muted small' }, `سيُتخطّى ${r.skipped.length} سطر: ${r.skipped.slice(0, 3).map((s) => s.reason).join('، ')}${r.skipped.length > 3 ? '…' : ''}`) : null,
        r && r.items.length ? h('div', { class: 'list' }, ...r.items.slice(0, 3).map((it) => h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, it.name),
          h('span', { class: 'row-sub' }, it.barcode ? num(it.barcode) : 'بلا باركود', it.qty ? [' · الكمية ', num(formatQty(it.qty))] : null)), money(it.sell_price)))) : null,
        ok && r.items.length ? button(`استورد ${r.items.length} صنف`, { block: true, size: 'lg', icon: 'check', onclick: () => run(r.items) }) : null);
    };
    fill(body,
      h('p', { class: 'muted' }, `في الملف ${rows.length - (header1 ? 1 : 0)} سطر. تأكد أن كل حقل يشير إلى عموده الصحيح:`),
      ...IMPORT_FIELDS.map((f) => {
        const sel = h('select', { class: 'input', onchange: (e) => { mapping[f.key] = Number(e.target.value); paintSummary(); } },
          h('option', { value: '-1' }, f.required ? '— اختر —' : '— غير موجود —'),
          ...Array.from({ length: width }, (_, i) => h('option', { value: String(i), selected: mapping[f.key] === i }, colLabel(i))));
        return field(f.label + (f.required ? ' *' : ''), sel);
      }),
      summary,
      button('ملف آخر', { kind: 'text', onclick: choose }));
    paintSummary();
  }
  async function run(items) {
    fill(body, emptyState('refresh', 'جارٍ الاستيراد…', 'لا تغلق التطبيق.'));
    let added = 0, exists = 0, failed = 0;
    const cats = new Map();
    for (const it of items) {
      try {
        if (it.barcode && await app.products.findByCode(it.barcode)) { exists++; continue; }
        let category_id = null;
        if (it.category) { if (!cats.has(it.category)) cats.set(it.category, (await app.products.addCategory(it.category)).id); category_id = cats.get(it.category); }
        await app.products.save({ name: it.name, barcode: it.barcode, sell_price: it.sell_price, cost_price: it.cost_price, category_id }, { qty: it.qty || null });
        added++;
      } catch { failed++; }
    }
    feedback.ok();
    fill(body, emptyState('check', `أُضيف ${added} صنف`, [exists ? `${exists} موجود من قبل (نفس الباركود). ` : '', failed ? `${failed} لم يُحفظ.` : ''].join('') || 'كل شيء تمام.',
      button('إلى الأصناف', { icon: 'box', onclick: () => navigate('/products', { replace: true }) })));
  }
  start();
}

// ============ تحديث الأسعار ============
export async function renderPrices(el) {
  const [all, cats] = await Promise.all([app.products.list(), app.products.categories()]);
  let cat = '';
  let mode = 'percent';
  let dir = 1;
  let roundTo = 0;
  const val = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0' });
  const catChips = h('div', { class: 'chips chips-scroll' });
  const modeChips = h('div', { class: 'chips' });
  const roundChips = h('div', { class: 'chips' });
  const preview = h('div');
  const chip = (on, label, fn) => h('button', { class: `chip ${on ? 'on' : ''}`, type: 'button', onclick: fn }, label);

  function changes() {
    const v = mode === 'percent' ? parseDecimal(val.value || '', 2) : parseMoney(val.value || '', cur());
    if (!v || v <= 0) return [];
    return bulkPrice(cat ? all.filter((p) => p.category_id === cat) : all, { mode, value: dir * v, roundTo });
  }
  function paint() {
    fill(catChips, chip(!cat, `كل الأصناف (${all.length})`, () => { cat = ''; paint(); }), ...cats.map((c) => chip(cat === c.id, c.name, () => { cat = c.id; paint(); })));
    fill(modeChips, chip(dir === 1, 'رفع ⬆', () => { dir = 1; paint(); }), chip(dir === -1, 'تخفيض ⬇', () => { dir = -1; paint(); }),
      chip(mode === 'percent', 'نسبة %', () => { mode = 'percent'; paint(); }), chip(mode === 'amount', `مبلغ ${CURRENCIES[cur()].symbol}`, () => { mode = 'amount'; paint(); }));
    fill(roundChips, ...[[0, 'بلا تقريب'], [10, 'أقرب 0.10'], [50, 'أقرب 0.50'], [100, 'أقرب 1.00']].map(([r, l]) => chip(roundTo === r, l, () => { roundTo = r; paint(); })));
    const ch = changes();
    fill(preview, ch.length ? h('div', null,
      h('h2', { class: 'section-title' }, `المعاينة: ${ch.length} صنف يتغيّر سعره`),
      h('div', { class: 'list' }, ...ch.slice(0, 30).map((c) => h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.name)),
        h('span', { class: 'muted small' }, num(formatMoney(c.old, cur(), { symbol: false }))), icon('chevron', 16), h('strong', null, money(c.next))))),
      ch.length > 30 ? h('p', { class: 'muted small' }, `و ${ch.length - 30} صنف آخر…`) : null,
      h('div', { class: 'sticky-save' }, button(`طبّق على ${ch.length} صنف`, { block: true, size: 'lg', icon: 'check', onclick: () => apply(ch) })))
      : h('p', { class: 'muted' }, val.value.trim() ? 'لا صنف يتغيّر سعره بهذه القيمة.' : 'اكتب القيمة لترى الأسعار الجديدة قبل التطبيق.'));
  }
  async function write(list, pick) {
    const batch = uuid();
    await app.store.write(async (w) => {
      for (const c of list) {
        const p = await app.db.products.get(c.id);
        if (!p) continue;
        await w.put('products', { ...p, sell_price: pick(c) });
        await w.append('price_history', { product_id: p.id, old_sell: p.sell_price, new_sell: pick(c), old_cost: p.cost_price, new_cost: p.cost_price, reason: 'bulk', batch_id: batch });
      }
    });
  }
  async function apply(ch) {
    await write(ch, (c) => c.next);
    feedback.ok();
    history.back();
    toast(`تغيّر سعر ${ch.length} صنف`, { kind: 'ok', ms: 8000, undo: async () => { await write(ch, (c) => c.old); toast('أُعيدت الأسعار السابقة', { kind: 'ok' }); } });
  }
  val.addEventListener('input', paint);
  el.append(header('تحديث الأسعار', { back: true }), h('div', { class: 'page product-form' },
    all.length ? h('div', null, catChips, modeChips, field('القيمة', val), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'تقريب السعر الجديد'), roundChips), preview)
      : emptyState('tag', 'لا أصناف بعد', 'أضف أصنافًا أولًا.')));
  paint();
}

// ============ ملصقات الباركود ============
function drawLabelPage(labels) {
  const W = 1240, H = 1754, COLS = 3, ROWS = 8, MX = 40, MY = 50;
  const cw = (W - MX * 2) / COLS, chh = (H - MY * 2) / ROWS;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'top';
  labels.forEach((lb, i) => {
    const x0 = MX + (i % COLS) * cw, y0 = MY + Math.floor(i / COLS) * chh;
    g.strokeStyle = '#d7d3d3'; g.lineWidth = 1; g.setLineDash([6, 6]); g.strokeRect(x0 + 4, y0 + 4, cw - 8, chh - 8); g.setLineDash([]);
    g.fillStyle = '#000'; g.textAlign = 'center'; g.direction = 'rtl'; g.font = `700 26px ${FONT}`;
    let name = lb.name;
    while (g.measureText(name).width > cw - 40 && name.length > 4) name = `${name.slice(0, -2)}…`;
    g.fillText(name, x0 + cw / 2, y0 + 20);
    const m = eanModules(lb.barcode);
    const mw = 3, bw = m.length * mw, bx = x0 + (cw - bw) / 2, by = y0 + 62, bh = 78;
    for (let k = 0; k < m.length; k++) if (m[k] === '1') g.fillRect(bx + k * mw, by, mw, bh);
    g.direction = 'ltr'; g.font = '600 22px monospace';
    g.fillText(lb.barcode, x0 + cw / 2, by + bh + 4);
    g.font = `700 26px ${FONT}`;
    g.fillText(lb.price, x0 + cw / 2, by + bh + 32);
  });
  return c;
}

export async function renderLabels(el) {
  const body = h('div');
  let onlyInternal = true;
  let rows = [];
  el.append(header('ملصقات الباركود', { back: true }), h('div', { class: 'page product-form' }, body));

  async function load() {
    const all = await app.products.list();
    const none = all.filter((p) => !p.barcode);
    const printable = all.filter((p) => p.barcode && eanModules(p.barcode));
    const prev = new Map(rows.map((r) => [r.p.id, r]));
    rows = printable.map((p) => prev.get(p.id) || { p, on: isInternalBarcode(p.barcode), copies: 1 });
    paint(none);
  }
  function paint(none) {
    const list = rows.filter((r) => !onlyInternal || isInternalBarcode(r.p.barcode));
    const chosen = rows.filter((r) => r.on && (!onlyInternal || isInternalBarcode(r.p.barcode)));
    const total = chosen.reduce((a, r) => a + r.copies, 0);
    fill(body,
      none.length ? h('div', { class: 'card' }, h('p', null, num(String(none.length)), ' صنف بلا باركود.'),
        button('ولّد لها باركودًا داخليًا', { kind: 'outline', icon: 'scan', block: true, onclick: async () => {
          for (const p of none) { const full = await app.db.products.get(p.id); await app.products.save({ ...full, barcode: await app.products.nextInternalBarcode(), internal_code: true }); }
          feedback.ok(); toast(`وُلّد باركود لـ ${none.length} صنف`, { kind: 'ok' }); load();
        } })) : null,
      h('div', { class: 'chips' },
        h('button', { class: `chip ${onlyInternal ? 'on' : ''}`, type: 'button', onclick: () => { onlyInternal = true; paint(none); } }, 'الباركود الداخلي فقط'),
        h('button', { class: `chip ${!onlyInternal ? 'on' : ''}`, type: 'button', onclick: () => { onlyInternal = false; paint(none); } }, 'كل الأصناف')),
      list.length ? h('div', { class: 'list section' }, ...list.map((r) => h('div', { class: `row ${r.on ? '' : 'row-muted'}` },
        h('button', { class: `check ${r.on ? 'on' : ''}`, type: 'button', 'aria-label': 'تحديد', onclick: () => { r.on = !r.on; paint(none); } }, r.on ? icon('check', 18) : null),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.p.name), h('span', { class: 'row-sub num' }, r.p.barcode)),
        h('div', { class: 'stepper' },
          h('button', { type: 'button', 'aria-label': 'إنقاص', onclick: () => { r.copies = Math.max(1, r.copies - 1); paint(none); } }, icon('minus', 18)),
          h('span', { class: 'stepper-val num' }, String(r.copies)),
          h('button', { type: 'button', 'aria-label': 'زيادة', onclick: () => { r.copies += 1; r.on = true; paint(none); } }, icon('plus', 18))))))
        : emptyState('scan', 'لا ملصقات هنا', onlyInternal ? 'لا أصناف بباركود داخلي بعد. ولّد باركودًا للأصناف بلا باركود، أو اختر «كل الأصناف».' : 'لا أصناف بباركود قابل للطباعة.'),
      total ? h('div', { class: 'sticky-save' }, button(`ملف PDF — ${total} ملصق (${Math.ceil(total / 24)} صفحة)`, { block: true, size: 'lg', icon: 'receipt', onclick: () => make(chosen) })) : null);
  }
  async function make(chosen) {
    try {
      const pages = labelPages(chosen.map((r) => ({ name: r.p.name, barcode: r.p.barcode, price: formatMoney(r.p.sell_price, r.p.currency || cur()), copies: r.copies })));
      const out = [];
      for (const pg of pages) {
        const canvas = drawLabelPage(pg);
        const jpeg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
        out.push({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height });
        canvas.width = canvas.height = 0;
      }
      const blob = new Blob([pdfFromJpegs(out, 1240 / 595)], { type: 'application/pdf' });
      await sendFile({ blob, name: `labels-${today()}.pdf`, mime: 'application/pdf' }, '', 'ملصقات الباركود', { chooser: true });
    } catch (e) { console.error(e); feedback.error(); toast('تعذّر إنشاء الملف', { kind: 'error' }); }
  }
  load();
}
