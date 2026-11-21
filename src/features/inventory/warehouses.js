// المخازن الخارجية: مخزن كبير فيه بضاعة غير المحل. بضاعة المخزن لا تُباع من شاشة البيع حتى تُنقل إلى المحل.
// الشاشات: قائمة المخازن وسجل النقل، صفحة المخزن (أصنافه وكمياتها)، وشاشة النقل (مخزن ← محل أو العكس).
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, button, input, field, money, iconButton, helpButton, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { listenKeyScanner } from '../../ui/keyscan.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { scanOnce } from '../../ui/scanner.js';
import { searchProducts } from '../../domain/product.js';
import { formatQty, parseQty, unit as unitOf, QTY_SCALE } from '../../domain/units.js';
import { formatDecimal } from '../../domain/money.js';
import { dateTimeText } from '../../domain/invoice.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { productThumb } from '../products/thumb.js';
import { pickProduct } from './hub.js';

const SHOP = 'المحل';
// الكمية في حقل الإدخال: بلا فواصل آلاف
const plainQty = (v) => formatDecimal(v, 3, { trim: true, group: false });

/** ورقة كمية: رقم واحد، مع «الكل» إن عُرف الحد الأقصى. onSave(qtyMilli). */
function qtySheet({ title, label, value = null, max = null, onSave }) {
  const q = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0', value: value === null ? '' : plainQty(value) });
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const qty = q.value.trim() === '' ? null : parseQty(q.value);
      if (qty === null || qty < 0 || (max !== null && qty > max)) { feedback.error(); toast(max !== null && qty > max ? `الموجود ${formatQty(max)} فقط` : 'اكتب الكمية', { kind: 'error' }); q.focus(); return; }
      try { await onSave(qty); feedback.ok(); close(); } catch (err) { feedback.error(); toast(err.message || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  }, field(label, q),
    max !== null ? h('div', { class: 'chips pay-quick' }, h('button', { class: 'chip', type: 'button', onclick: () => { q.value = plainQty(max); } }, 'الكل ', num(formatQty(max)))) : null,
    button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title });
  setTimeout(() => { q.focus(); q.select(); }, 150);
}

function warehouseSheet(w, onDone) {
  const name = input({ maxlength: 40, placeholder: 'مثال: المخزن الكبير', value: w ? w.name : '' });
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try { const saved = await app.inventory.saveWarehouse({ id: w ? w.id : null, name: name.value }); feedback.ok(); close(); if (onDone) onDone(saved); }
      catch (err) { feedback.error(); toast(err.message || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  }, field('اسم المخزن', name), button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    w ? button('حذف المخزن', { kind: 'text', onclick: async () => {
      try { await app.inventory.removeWarehouse(w.id); close(); toast(`حُذف «${w.name}»`); navigate('/inventory/warehouses', { replace: true }); }
      catch (err) { feedback.error(); toast(err.message, { kind: 'error', ms: 4000 }); }
    } }) : null), { title: w ? 'تعديل المخزن' : 'مخزن جديد' });
  setTimeout(() => { if (!w) name.focus(); }, 150);
}

// ============ قائمة المخازن ============
export function renderWarehouses(el) {
  const body = h('div');
  el.append(header('المخازن', { back: true }), h('div', { class: 'page' }, body));

  async function load() {
    const [list, transfers] = await Promise.all([app.inventory.warehouses(), app.inventory.transfers(20)]);
    const names = new Map(list.map((w) => [w.id, w.name]));
    const place = (id) => (id ? names.get(id) || 'مخزن محذوف' : SHOP);
    fill(body,
      h('p', { class: 'muted' }, 'عندك مخزن فيه بضاعة غير المحل؟ أضفه هنا. بضاعة المخزن محفوظة فيه، وحين تنقل منها إلى المحل تزيد في مخزون المحل وتُباع.'),
      list.length ? h('div', { class: 'list' }, ...list.map((w) => h('button', { class: 'row row-tap', type: 'button', onclick: () => navigate(`/inventory/warehouse?id=${w.id}`) },
        h('span', { class: 'row-ic' }, icon('warehouse', 22)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, w.name), h('span', { class: 'row-sub' }, w.items ? `${w.items} صنف` : 'فارغ')),
        app.can('see_cost') && w.value ? h('span', { class: 'row-end' }, money(w.value)) : null)))
        : emptyState('warehouse', 'لا مخازن بعد', 'أضف مخزنك الخارجي، ثم سجّل ما فيه من بضاعة وانقل منه إلى المحل متى شئت.'),
      button('مخزن جديد', { block: true, size: 'lg', icon: 'plus', onclick: () => warehouseSheet(null, (w) => navigate(`/inventory/warehouse?id=${w.id}`)) }),
      list.length ? button('انقل بضاعة بين المخزن والمحل', { kind: 'outline', block: true, icon: 'swap', onclick: () => navigate(`/inventory/transfer?from=${list[0].id}`) }) : null,
      transfers.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'آخر عمليات النقل'),
        h('div', { class: 'list' }, ...transfers.map((t) => h('div', { class: 'row' },
          h('span', { class: 'row-ic' }, icon('swap', 20)),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, `${place(t.from)} ← ${place(t.to)}`),
            h('span', { class: 'row-sub' }, num(dateTimeText(t.at)), ' · ', t.items.slice(0, 3).map((i) => `${i.name} ${formatQty(i.qty)}`).join('، '), t.items.length > 3 ? ` +${t.items.length - 3}` : '')),
          h('span', { class: 'row-end muted small' }, `${t.items.length} صنف`))))) : null,
    );
  }
  load();
  return bus.on('data', (e) => { if (e.tables.includes('branches') || e.tables.includes('movements')) load(); });
}

// ============ صفحة المخزن ============
export async function renderWarehouse(el, params) {
  const find = async () => (await app.inventory.warehouses()).find((w) => w.id === params.id) || null;
  let w = await find();
  if (!w) { navigate('/inventory/warehouses', { replace: true }); return undefined; }
  let items = [];
  let query = '';
  const titleEl = h('h1', null, w.name);
  const top = h('div');
  const list = h('div');
  const search = input({ type: 'search', placeholder: 'ابحث في المخزن', autocomplete: 'off', oninput: (e) => { query = e.target.value; paintList(); } });

  el.append(
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'رجوع', onclick: () => history.back() }, icon('back')),
      h('div', { class: 'topbar-title' }, titleEl),
      h('div', { class: 'topbar-actions' }, iconButton('edit', 'تعديل المخزن', () => warehouseSheet(w, load)), helpButton())),
    h('div', { class: 'page' }, top, h('div', { class: 'search-row' }, icon('search', 20), search), list));

  function setQty(p) {
    qtySheet({
      title: p.name, label: `الكمية الموجودة في المخزن الآن (${unitOf(p.unit).name})`, value: p.qty || null,
      onSave: async (qty) => { await app.inventory.setWarehouseQty(w.id, p.id, qty); toast(`«${p.name}» في المخزن: ${formatQty(qty)}`, { kind: 'ok' }); },
    });
  }

  function paintList() {
    const has = items.filter((p) => p.qty !== 0);
    const shown = searchProducts(has, query, 200);
    fill(list, shown.length && isWide() ? dataTable({
      rows: shown,
      onRow: (p) => setQty(p),
      columns: [
        { key: 'name', label: 'الصنف', grow: true, by: (p) => p.name, cell: (p) => h('span', { class: 'dt-name' }, productThumb(p, 36), h('span', null, p.name)) },
        { key: 'barcode', label: 'الباركود', by: (p) => p.barcode || '', cell: (p) => (p.barcode ? h('span', { class: 'num' }, p.barcode) : h('span', { class: 'muted' }, '—')) },
        { key: 'qty', label: 'في المخزن', num: true, by: (p) => p.qty, cell: (p) => h('span', { class: 'stock-badge' }, h('span', { class: 'num' }, formatQty(p.qty)), h('small', null, unitOf(p.unit).short)) },
      ],
    }) : shown.length ? h('div', { class: 'list' }, ...shown.map((p) => h('button', { class: 'row row-tap', type: 'button', onclick: () => setQty(p) },
      productThumb(p, 40),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name)),
      h('span', { class: 'stock-badge' }, h('span', { class: 'num' }, formatQty(p.qty)), h('small', null, unitOf(p.unit).short)))))
      : has.length ? emptyState('search', 'لا نتائج', `لا صنف في المخزن يطابق «${query}»`)
        : emptyState('box', 'المخزن فارغ', 'سجّل ما فيه الآن من «أضف بضاعة موجودة»، أو استلم فيه بضاعة جديدة من «شراء إلى المخزن».'));
  }

  async function load() {
    w = (await find()) || w;
    titleEl.textContent = w.name;
    items = await app.inventory.stockAt(w.id);
    fill(top,
      app.can('see_cost') ? h('div', { class: 'balance-card clear' },
        h('div', { class: 'hero-label' }, 'قيمة بضاعة المخزن بالتكلفة'), h('div', { class: 'hero-value' }, money(w.value)),
        h('div', { class: 'hero-mini-label' }, `${w.items} صنف`)) : null,
      button('انقل إلى المحل', { block: true, size: 'lg', icon: 'swap', onclick: () => navigate(`/inventory/transfer?from=${w.id}`) }),
      h('div', { class: 'product-actions' },
        button('شراء إلى المخزن', { kind: 'outline', icon: 'truck', onclick: () => navigate(`/inventory/purchase?to=${w.id}`) }),
        button('أضف بضاعة موجودة', { kind: 'outline', icon: 'plus', onclick: async () => { const p = await pickProduct({ title: 'أي صنف في المخزن؟' }); if (p) setQty({ ...p, qty: items.find((x) => x.id === p.id)?.qty || 0 }); } })),
    );
    paintList();
  }
  load();
  return bus.on('data', (e) => { if (e.tables.includes('branches') || e.tables.includes('movements') || e.tables.includes('products')) load(); });
}

// ============ النقل ============
export async function renderTransfer(el, params) {
  const warehouses = await app.inventory.warehouses();
  if (!warehouses.length) { navigate('/inventory/warehouses', { replace: true }); return undefined; }
  const places = [{ id: null, name: SHOP }, ...warehouses.map((w) => ({ id: w.id, name: w.name }))];
  const has = (id) => places.some((p) => p.id === (id || null));
  let from = params.from && has(params.from) ? params.from : (params.to ? null : warehouses[0].id);
  let to = params.to && has(params.to) && params.to !== from ? params.to : (from ? null : warehouses[0].id);
  let source = [];
  let lines = [];          // [{ p, qty }]
  let query = '';
  let busy = false;
  const head = h('div');
  const linesEl = h('div');
  const results = h('div');
  const search = input({ type: 'search', placeholder: 'ابحث عن صنف لتنقله', autocomplete: 'off', oninput: (e) => { query = e.target.value; paintResults(); } });
  const footer = h('div', { class: 'rc-actions' });

  el.append(header('نقل بضاعة', { back: true }), h('div', { class: 'page' }, head,
    h('div', { class: 'input-row' }, h('div', { class: 'search-row', style: { flex: '1' } }, icon('search', 20), search),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'امسح الباركود', onclick: scan }, icon('scan'))),
    results, linesEl, footer));

  const nameOf = (id) => places.find((p) => p.id === (id || null)).name;

  function paintHead() {
    const chips = (cur, other, set) => h('div', { class: 'chips' }, ...places.map((p) => h('button', {
      class: `chip ${cur === p.id ? 'on' : ''}`, type: 'button', disabled: p.id === other,
      onclick: () => { set(p.id); },
    }, p.id ? icon('warehouse', 16) : icon('store', 16), p.name)));
    fill(head,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'من'), chips(from, null, async (id) => {
        if (id === from) return;
        if (id === to) to = from;   // تبديل الاتجاه بضغطة
        from = id; lines = []; await loadSource();
      })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'إلى'), chips(to, from, (id) => { to = id; paintHead(); })));
  }

  function add(p) {
    if (!(p.qty > 0)) { feedback.error(); toast(`لا شيء من «${p.name}» في ${nameOf(from)}`, { kind: 'error' }); return; }
    const hit = lines.find((l) => l.p.id === p.id);
    if (hit) hit.qty = Math.min(p.qty, hit.qty + QTY_SCALE);
    else lines.push({ p, qty: Math.min(p.qty, QTY_SCALE) });
    query = ''; search.value = '';
    feedback.tap();
    paintResults(); paintLines();
  }

  function paintResults() {
    const hits = query.trim() ? searchProducts(source.filter((p) => p.qty > 0), query, 8) : [];
    fill(results, query.trim() ? (hits.length ? h('div', { class: 'list search-results' }, ...hits.map((p) => h('button', { class: 'row row-tap', type: 'button', onclick: () => add(p) },
      productThumb(p, 36), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name)),
      h('span', { class: 'muted small' }, 'الموجود ', num(formatQty(p.qty))))))
      : h('p', { class: 'muted small' }, `لا صنف بهذا الاسم في ${nameOf(from)}`)) : null);
  }

  function paintLines() {
    fill(linesEl, lines.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'ما ستنقله'),
      h('div', { class: 'list' }, ...lines.map((l, i) => h('div', { class: 'row' },
        h('button', { class: 'row-main row-tap', type: 'button', onclick: () => qtySheet({
          title: l.p.name, label: `الكمية المنقولة (${unitOf(l.p.unit).name})`, value: l.qty, max: l.p.qty,
          onSave: (q) => { if (q > 0) l.qty = q; else lines.splice(i, 1); paintLines(); },
        }) }, h('span', { class: 'row-title' }, l.p.name), h('span', { class: 'row-sub' }, 'الموجود ', num(formatQty(l.p.qty)))),
        h('div', { class: 'stepper' },
          h('button', { type: 'button', 'aria-label': 'إنقاص', onclick: () => { l.qty -= QTY_SCALE; if (l.qty <= 0) lines.splice(i, 1); paintLines(); } }, icon('minus', 18)),
          h('span', { class: 'stepper-val num' }, formatQty(l.qty)),
          h('button', { type: 'button', 'aria-label': 'زيادة', onclick: () => { l.qty = Math.min(l.p.qty, l.qty + QTY_SCALE); paintLines(); } }, icon('plus', 18)))))))
      : emptyState('swap', 'اختر ما تنقله', `ابحث عن الصنف أو امسح باركوده. تظهر أصناف «${nameOf(from)}» التي فيها كمية.`));
    fill(footer, lines.length ? button(`انقل ${lines.length} صنف إلى ${nameOf(to)}`, { block: true, size: 'lg', icon: 'check', onclick: save }) : null);
  }

  async function scan() {
    const code = await scanOnce('امسح الصنف لتنقله');
    if (code) addByCode(code);
  }

  async function addByCode(code) {
    const hit = await app.products.findByCode(code);
    const p = hit && source.find((x) => x.id === hit.product.id);
    if (p) add(p); else { feedback.error(); toast(hit ? `«${hit.product.name}» غير موجود في ${nameOf(from)}` : 'باركود غير مسجّل', { kind: 'error' }); }
  }

  async function save() {
    if (busy) return;
    busy = true;
    try {
      const r = await app.inventory.transfer({ from, to, lines: lines.map((l) => ({ product_id: l.p.id, name: l.p.name, qty: l.qty })) });
      feedback.ok();
      toast(`نُقل ${r.count} صنف من ${nameOf(from)} إلى ${nameOf(to)}`, { kind: 'ok', ms: 3500 });
      history.back();
    } catch (err) { busy = false; feedback.error(); toast(err.message || 'تعذّر النقل', { kind: 'error', ms: 4000 }); }
  }

  async function loadSource() {
    source = await app.inventory.stockAt(from);
    paintHead(); paintResults(); paintLines();
  }
  await loadSource();
  return listenKeyScanner(addByCode); // القارئ الخارجي يضيف الصنف لقائمة النقل
}
