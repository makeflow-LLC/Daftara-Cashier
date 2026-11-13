// المخزون: الأفعال الأربعة (شراء، موردون، جرد، تالف) والتنبيهات (نفد، منخفض، ينتهي قريبًا، راكد)
// مع «اطلب من المورّد»: رسالة واتساب جاهزة بالأصناف والكميات.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, button, input, field, money } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { scanOnce } from '../../ui/scanner.js';
import { suggestedOrderQty, reorderText } from '../../domain/inventory.js';
import { searchProducts } from '../../domain/product.js';
import { formatQty, parseQty, unit as unitOf, QTY_SCALE } from '../../domain/units.js';
import { whatsappLink } from '../../domain/ledger.js';
import { stockValue } from '../../domain/stock.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { productThumb } from '../products/thumb.js';
import { openLink } from '../customers/customers.js';
import { pickSupplier } from './suppliers.js';

const TABS = [
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

export function renderInventory(el, params) {
  let alerts = { out: [], low: [], expiring: [], dead: [] };
  let tab = 'out';
  const actions = h('div', { class: 'quick inv-actions' });
  const valueEl = h('div');
  const chips = h('div', { class: 'chips chips-scroll' });
  const body = h('div');
  const tabs = TABS.filter((t) => !t.feature || app.feature(t.feature));

  el.append(header('المخزون', { back: true }), h('div', { class: 'page' }, actions, valueEl, h('h2', { class: 'section-title' }, 'التنبيهات'), chips, body));
  const act = (ic, label, fn, tone = '') => h('button', { class: `quick-btn ${tone}`, type: 'button', onclick: fn }, icon(ic, 26), h('span', null, label));
  fill(actions,
    act('truck', 'شراء بضاعة', () => navigate('/inventory/purchase'), 'quick-brand'),
    act('users', 'الموردون', () => navigate('/suppliers')),
    app.feature('stockCount') ? act('clipboard', 'جرد', () => navigate('/inventory/count')) : null,
    act('trash', 'تالف', damage));

  function paint() {
    fill(chips, ...tabs.map((t) => h('button', { class: `chip ${tab === t.key ? 'on' : ''}`, type: 'button', onclick: () => { tab = t.key; paint(); } }, t.label, ' ', num(String(alerts[t.key].length)))));
    const items = alerts[tab];
    const t = tabs.find((x) => x.key === tab);
    const canOrder = (tab === 'out' || tab === 'low') && items.length;
    fill(body,
      items.length ? h('p', { class: 'muted small' }, t.hint) : null,
      canOrder ? button('اطلب من المورّد عبر واتساب', { icon: 'truck', block: true, onclick: () => reorder([...alerts.out, ...alerts.low]) }) : null,
      items.length ? h('div', { class: 'list section' }, ...items.map((p) => h('button', { class: 'row row-tap', type: 'button', onclick: () => navigate(`/products/edit?id=${p.id}`) },
        productThumb(p, 40),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name),
          tab === 'expiring' ? h('span', { class: 'row-sub' }, 'ينتهي ', num(p.expiry_date)) : null),
        h('span', { class: `stock-badge ${tab === 'out' ? 'stock-out' : tab === 'low' ? 'stock-low' : ''}` }, h('span', { class: 'num' }, formatQty(p.qty)), h('small', null, unitOf(p.unit).short)))))
        : emptyState('check', 'لا شيء هنا', 'كل شيء على ما يرام في هذا القسم.'));
  }

  // طلبية: كل الأصناف محددة والكمية مقترحة؛ عدّل بسرعة ثم أرسل
  function reorder(list) {
    const items = list.map((p) => ({ p, on: true, qty: suggestedOrderQty(p) }));
    const rows = h('div', { class: 'list picker-list' });
    const paintRows = () => fill(rows, ...items.map((it) => h('div', { class: `row ${it.on ? '' : 'row-muted'}` },
      h('button', { class: `check ${it.on ? 'on' : ''}`, type: 'button', 'aria-label': 'تحديد', onclick: () => { it.on = !it.on; paintRows(); } }, it.on ? icon('check', 18) : null),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, it.p.name), h('span', { class: 'row-sub' }, 'عندك ', num(formatQty(it.p.qty)))),
      h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': 'إنقاص', onclick: () => { it.qty = Math.max(QTY_SCALE, it.qty - QTY_SCALE); paintRows(); } }, icon('minus', 18)),
        h('span', { class: 'stepper-val num' }, formatQty(it.qty)),
        h('button', { type: 'button', 'aria-label': 'زيادة', onclick: () => { it.qty += QTY_SCALE; paintRows(); } }, icon('plus', 18))))));
    paintRows();
    openSheet((close) => h('div', null, rows, h('div', { class: 'rc-actions' }, button('اختر المورّد وأرسل', {
      block: true, size: 'lg', icon: 'truck',
      onclick: async () => {
        const chosen = items.filter((it) => it.on);
        if (!chosen.length) { feedback.error(); return; }
        const s = await pickSupplier({ title: 'أرسل الطلبية إلى…' });
        if (!s) return;
        close();
        openLink(whatsappLink(s.phone, reorderText({ shopName: app.shop.name, supplierName: s.name, items: chosen.map((it) => ({ name: it.p.name, unit: it.p.unit, qty: it.qty })) })));
      },
    }))), { title: 'طلبية للمورّد' });
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
    alerts = await app.inventory.alerts({ expiry: app.feature('expiry') });
    if (!alerts[tab].length) tab = (tabs.find((t) => alerts[t.key].length) || tabs[0]).key;
    const cost = products.reduce((a, p) => a + stockValue(p.qty, p.avg_cost), 0);
    const sell = products.reduce((a, p) => a + stockValue(p.qty, p.sell_price), 0);
    fill(valueEl, app.can('see_cost') ? h('div', { class: 'stats inv-value' },
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'قيمة المخزون بالتكلفة'), h('div', { class: 'stat-value' }, money(cost))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'قيمته بسعر البيع'), h('div', { class: 'stat-value' }, money(sell)))) : null);
    paint();
    if (params.reorder && (alerts.out.length || alerts.low.length)) { params.reorder = null; reorder([...alerts.out, ...alerts.low]); }
  }
  load();
  return bus.on('data', (e) => { if (e.tables.includes('movements') || e.tables.includes('products')) load(); });
}
