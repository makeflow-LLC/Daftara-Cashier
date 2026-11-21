// المخزون: الأفعال الأربعة (شراء، موردون، جرد، تالف) والتنبيهات (نفد، منخفض، ينتهي قريبًا، راكد)
// مع «اطلب من المورّد»: رسالة واتساب جاهزة بالأصناف والكميات.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, button, input, field, money, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { scanOnce } from '../../ui/scanner.js';
import { suggestedOrderQty, reorderText } from '../../domain/inventory.js';
import { searchProducts } from '../../domain/product.js';
import { formatQty, parseQty, unit as unitOf, QTY_SCALE } from '../../domain/units.js';
import { whatsappLink } from '../../domain/ledger.js';
import { stockValue } from '../../domain/stock.js';
import { formatMoney } from '../../domain/currency.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { productThumb } from '../products/thumb.js';
import { openLink } from '../customers/customers.js';
import { pickSupplier } from './suppliers.js';

const TABS = [
  { key: 'all', label: 'كل الأصناف', hint: '' },
  { key: 'out', label: 'نفد', hint: 'نفدت من المخزون' },
  { key: 'low', label: 'منخفض', hint: 'أوشكت على النفاد' },
  { key: 'expiring', label: 'ينتهي قريبًا', hint: 'تنتهي صلاحيتها خلال 30 يومًا', feature: 'expiry' },
  { key: 'dead', label: 'راكد', hint: 'لم يُبع منها شيء منذ 60 يومًا' },
];

/** اختيار صنف بالبحث أو المسح (للتالف). */
export function pickProduct({ title = 'اختر الصنف' } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    let all = [];
    const q = input({ type: 'search', placeholder: 'ابحث بالاسم', autocomplete: 'off' });
    const list = h('div', { class: 'list picker-list' });
    openSheet((close) => {
      const pick = (p) => { chosen = p; close(); };
      const paint = () => fill(list, ...searchProducts(all, q.value, 30).map((p) => h('button', { class: 'row row-tap', type: 'button', onclick: () => pick(p) },
        productThumb(p, 36), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name)), h('span', { class: 'muted small' }, num(formatQty(p.qty))))));
      q.addEventListener('input', paint);
      app.products.list().then((l) => { all = l; paint(); });
      return h('div', null,
        h('div', { class: 'input-row sheet-search' }, h('div', { class: 'search-row', style: { flex: '1' } }, icon('search', 20), q),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'امسح', onclick: async () => { const c = await scanOnce(); const hit = c && await app.products.findByCode(c); if (hit) pick({ ...hit.product, qty: (await app.db.stock.get(hit.product.id))?.qty ?? 0 }); else if (c) toast('باركود غير مسجّل', { kind: 'error' }); } }, icon('scan'))),
        list);
    }, { title, onClose: () => resolve(chosen) });
  });
}

// طلبية للمورّد: كل الأصناف محددة والكمية مقترحة؛ عدّل بسرعة ثم اختر المورّد وأرسل على واتساب.
// items: [{ p, qty }]
export function openReorder(list) {
  const items = list.map((x) => ({ p: x.p, on: true, qty: x.qty }));
  const rows = h('div', { class: 'list picker-list' });
  const paintRows = () => fill(rows, ...items.map((it) => h('div', { class: `row ${it.on ? '' : 'row-muted'}` },
    h('button', { class: `check ${it.on ? 'on' : ''}`, type: 'button', 'aria-label': 'تحديد', onclick: () => { it.on = !it.on; paintRows(); } }, it.on ? icon('check', 18) : null),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, it.p.name), h('span', { class: 'row-sub' }, 'عندك ', num(formatQty(it.p.qty)))),
    h('div', { class: 'stepper' },
      h('button', { type: 'button', 'aria-label': 'إنقاص', onclick: () => { it.qty = Math.max(QTY_SCALE, it.qty - QTY_SCALE); paintRows(); } }, icon('minus', 18)),
      h('span', { class: 'stepper-val num' }, formatQty(it.qty)),
      h('button', { type: 'button', 'aria-label': 'زيادة', onclick: () => { it.qty += QTY_SCALE; paintRows(); } }, icon('plus', 18))))));
  paintRows();
  openSheet((close) => h('div', null, rows, h('div', { class: 'rc-actions' }, button('اختر التاجر وأرسل', {
    block: true, size: 'lg', icon: 'truck',
    onclick: async () => {
      const chosen = items.filter((it) => it.on);
      if (!chosen.length) { feedback.error(); return; }
      const s = await pickSupplier({ title: 'أرسل الطلبية إلى…' });
      if (!s) return;
      close();
      openLink(whatsappLink(s.phone, reorderText({ shopName: app.shop.name, supplierName: s.name, items: chosen.map((it) => ({ name: it.p.name, unit: it.p.unit, qty: it.qty })) })));
    },
  }))), { title: 'طلبية للتاجر' });
}

export function renderInventory(el, params) {
  let alerts = { all: [], out: [], low: [], expiring: [], dead: [] };
  // «كل الأصناف» أولًا: من أضاف بضاعة يجدها هنا بكميتها (لا في التنبيهات فقط). ?tab=alerts يفتح أول تنبيه فيه أصناف
  let tab = params.tab === 'alerts' || params.reorder ? 'out' : 'all';
  let query = '';
  let whQty = new Map();
  let whNames = new Map();
  const search = input({ type: 'search', placeholder: 'ابحث في المخزون بالاسم أو الباركود', autocomplete: 'off', oninput: (e) => { query = e.target.value; paint(); } });
  const searchRow = h('div', { class: 'search-row' }, icon('search', 20), search);
  const actions = h('div', { class: 'quick inv-actions' });
  const valueEl = h('div');
  const chips = h('div', { class: 'chips chips-scroll' });
  const body = h('div');
  const tabs = TABS.filter((t) => !t.feature || app.feature(t.feature));

  const helper = h('div');
  el.append(header('المخزون', { back: true }), h('div', { class: 'page' }, actions, helper, valueEl, h('h2', { class: 'section-title' }, 'البضاعة والتنبيهات'), chips, searchRow, body));
  const act = (ic, label, fn, tone = '') => h('button', { class: `quick-btn ${tone}`, type: 'button', onclick: fn }, icon(ic, 26), h('span', null, label));
  fill(actions,
    act('truck', 'شراء بضاعة', () => navigate('/inventory/purchase'), 'quick-brand'),
    act('users', 'ديون التجار', () => navigate('/suppliers')),
    app.feature('stockCount') ? act('clipboard', 'جرد', () => navigate('/inventory/count')) : null,
    act('trash', 'تالف', damage),
    act('warehouse', 'المخازن والنقل', () => navigate('/inventory/warehouses')));

  function paint() {
    fill(chips, ...tabs.map((t) => h('button', { class: `chip ${tab === t.key ? 'on' : ''}`, type: 'button', onclick: () => { tab = t.key; paint(); } }, t.label, ' ', num(String(alerts[t.key].length)))));
    searchRow.hidden = tab !== 'all';
    if (tab === 'all') { paintAll(); return; }
    const items = alerts[tab];
    const t = tabs.find((x) => x.key === tab);
    const canOrder = (tab === 'out' || tab === 'low') && items.length;
    fill(body,
      items.length ? h('p', { class: 'muted small' }, t.hint) : null,
      canOrder ? button('اطلب من التاجر عبر واتساب', { icon: 'truck', block: true, onclick: () => reorder([...alerts.out, ...alerts.low]) }) : null,
      items.length && isWide() ? stockTable(items, tab) : items.length ? h('div', { class: 'list section' }, ...items.map((p) => h('button', { class: 'row row-tap', type: 'button', onclick: () => navigate(`/products/edit?id=${p.id}`) },
        productThumb(p, 40),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name),
          tab === 'expiring' ? h('span', { class: 'row-sub' }, 'ينتهي ', num(p.expiry_date)) : null),
        h('span', { class: `stock-badge ${tab === 'out' ? 'stock-out' : tab === 'low' ? 'stock-low' : ''}` }, h('span', { class: 'num' }, formatQty(p.qty)), h('small', null, unitOf(p.unit).short)))))
        : emptyState('check', 'لا شيء هنا', 'كل شيء على ما يرام في هذا القسم.'));
  }

  // كل الأصناف بكمياتها في المحل (وما في المخازن الخارجية إن وُجد)، مع بحث
  // الحاسوب: جدول المخزون — في المحل، في المخازن، التكلفة وقيمة الموجود (لمن يرى الأرباح)
  function stockTable(items, kind) {
    const seeCost = app.can('see_profit');
    const whText = (p) => (whQty.get(p.id) || []).map((x) => `${whNames.get(x.branch_id) || 'مخزن'}: ${formatQty(x.qty)}`).join(' · ');
    const value = (p) => Math.round((Math.max(0, p.qty) * (p.avg_cost || 0)) / 1000);
    const lvl = (p) => (kind === 'low' ? 'low' : p.qty <= 0 ? 'out' : '');
    return h('div', { class: 'section' }, dataTable({
      rows: items,
      onRow: (p) => navigate(`/products/edit?id=${p.id}`),
      columns: [
        { key: 'name', label: 'الصنف', grow: true, by: (p) => p.name, cell: (p) => h('span', { class: 'dt-name' }, productThumb(p, 36), h('span', null, p.name)) },
        { key: 'barcode', label: 'الباركود', by: (p) => p.barcode || '', cell: (p) => (p.barcode ? num(p.barcode) : h('span', { class: 'muted' }, '—')) },
        kind === 'expiring' ? { key: 'exp', label: 'ينتهي', by: (p) => p.expiry_date || '', cell: (p) => num(p.expiry_date || '') } : null,
        whNames.size ? { key: 'wh', label: 'في المخازن', cell: (p) => whText(p) || h('span', { class: 'muted' }, '—') } : null,
        seeCost ? { key: 'cost', label: 'التكلفة', num: true, by: (p) => p.avg_cost || 0, cell: (p) => (p.avg_cost ? money(p.avg_cost, p.currency) : h('span', { class: 'muted' }, '—')) } : null,
        seeCost ? { key: 'value', label: 'قيمة الموجود', num: true, by: value, cell: (p) => (value(p) ? money(value(p), p.currency) : h('span', { class: 'muted' }, '—')) } : null,
        { key: 'qty', label: 'في المحل', num: true, by: (p) => p.qty, cell: (p) => h('span', { class: `stock-badge ${lvl(p) ? `stock-${lvl(p)}` : ''}` }, h('span', { class: 'num' }, formatQty(p.qty)), h('small', null, unitOf(p.unit).short)) },
      ].filter(Boolean),
    }));
  }

  function paintAll() {
    const items = searchProducts(alerts.all, query, isWide() ? 2000 : 150);
    if (isWide() && items.length) { fill(body, stockTable(items, 'all')); return; }
    fill(body, items.length ? h('div', { class: 'list section' }, ...items.map((p) => {
      const inWh = whQty.get(p.id) || [];
      const lvl = p.qty <= 0 ? 'out' : '';
      return h('button', { class: 'row row-tap', type: 'button', onclick: () => navigate(`/products/edit?id=${p.id}`) },
        productThumb(p, 40),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name),
          inWh.length ? h('span', { class: 'row-sub' }, inWh.map((x) => `${whNames.get(x.branch_id) || 'مخزن'}: ${formatQty(x.qty)}`).join(' · ')) : null),
        h('span', { class: `stock-badge ${lvl ? `stock-${lvl}` : ''}` }, h('span', { class: 'num' }, formatQty(p.qty)), h('small', null, unitOf(p.unit).short)));
    }), alerts.all.length > items.length && !query.trim() ? h('p', { class: 'muted small' }, `تظهر أول ${items.length} — ابحث لتجد الباقي.`) : null)
      : alerts.all.length ? emptyState('search', 'لا نتائج', `لا صنف يطابق «${query}»`)
        : emptyState('box', 'لا أصناف بعد', 'أضف أصنافك من «الأصناف»، أو استلم بضاعة من «شراء بضاعة».'));
  }

  // طلبية: الكمية من سرعة البيع إن عُرفت (المساعد)، وإلا ضعف حدّ التنبيه
  async function reorder(list) {
    const plan = new Map((await app.inventory.assistant()).soon.map((x) => [x.p.id, x.qty]));
    openReorder(list.map((p) => ({ p, qty: plan.get(p.id) || suggestedOrderQty(p) })));
  }

  async function damage() {
    const p = await pickProduct({ title: 'أي صنف تلف؟' });
    if (!p) return;
    const q = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '1' });
    const note = input({ maxlength: 80, placeholder: 'مكسور، منتهي… (اختياري)' });
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const qty = parseQty(q.value || '1');
        if (!qty || qty <= 0) { feedback.error(); return; }
        await app.inventory.damage(p.id, qty, note.value.trim() || null);
        feedback.ok(); close();
        toast(`سُجّل تالف: ${formatQty(qty)} من «${p.name}»`, { kind: 'ok' });
      },
    }, field(`الكمية التالفة (${unitOf(p.unit).name})`, q), field('السبب', note), button('سجّل التالف', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: p.name });
    setTimeout(() => q.focus(), 150);
  }

  async function load() {
    const products = await app.inventory.productsWithStock();
    alerts = { ...(await app.inventory.alerts({ expiry: app.feature('expiry') })), all: [...products].sort((a, b) => a.name.localeCompare(b.name, 'ar')) };
    const whs = await app.inventory.warehouses();
    whNames = new Map(whs.map((w) => [w.id, w.name]));
    whQty = whs.length ? await app.inventory.warehouseQty() : new Map();
    if (tab !== 'all' && !alerts[tab].length) tab = (tabs.find((t) => t.key !== 'all' && alerts[t.key].length) || tabs[0]).key;
    const cost = products.reduce((a, p) => a + stockValue(p.qty, p.avg_cost), 0);
    const sell = products.reduce((a, p) => a + stockValue(p.qty, p.sell_price), 0);
    fill(valueEl, app.can('see_cost') ? h('div', { class: 'stats inv-value' },
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'قيمة المخزون بالتكلفة'), h('div', { class: 'stat-value' }, money(cost))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'قيمته بسعر البيع'), h('div', { class: 'stat-value' }, money(sell)))) : null,
      whs.length ? h('button', { class: 'beta-banner helper-banner', type: 'button', onclick: () => navigate('/inventory/warehouses') },
        icon('warehouse', 26),
        h('span', { class: 'row-main' }, h('strong', null, whs.length === 1 ? whs[0].name : `${whs.length} مخازن`),
          h('span', null, app.can('see_cost') ? ['بضاعة بقيمة ', num(formatMoney(whs.reduce((a, w) => a + w.value, 0), app.shop?.base_currency || 'ILS')), ' — انقل منها إلى المحل'] : 'انقل منها إلى المحل')),
        icon('chevron', 20)) : null);
    const as = await app.inventory.assistant();
    fill(helper, as.soon.length || as.dead.length ? h('button', { class: 'beta-banner helper-banner', type: 'button', onclick: () => navigate('/inventory/assistant') },
      icon('bulb', 26),
      h('span', { class: 'row-main' }, h('strong', null, 'المساعد'),
        h('span', null, [as.soon.length ? `${as.soon.length} صنف يخلص خلال أسبوع` : '', as.dead.length ? `${as.dead.length} صنف راكد` : ''].filter(Boolean).join(' · '))),
      icon('chevron', 20)) : null);
    paint();
    if (params.reorder && (alerts.out.length || alerts.low.length)) { params.reorder = null; reorder([...alerts.out, ...alerts.low]); }
  }
  load();
  return bus.on('data', (e) => { if (e.tables.includes('movements') || e.tables.includes('products') || e.tables.includes('branches')) load(); });
}
