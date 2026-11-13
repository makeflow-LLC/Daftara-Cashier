// قائمة الأصناف: بحث فوري بالعربية أو بالباركود، تصفية بالتصنيف، المخزون والسعر، والإضافة السريعة بالمسح.
// تُرسم على دفعات (50 صنفًا) حتى تبقى سريعة مع مئات الأصناف على جوال رخيص.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, iconButton, emptyState, syncBadge, button, money } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { scanOnce } from '../../ui/scanner.js';
import { searchProducts } from '../../domain/product.js';
import { formatQty, unit } from '../../domain/units.js';
import { stockLevel } from '../../domain/stock.js';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '../../domain/features.js';
import { QTY_SCALE } from '../../domain/units.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { productThumb } from './thumb.js';

const PAGE = 50;

export function renderProducts(el) {
  let all = [];
  let cats = [];
  let query = '';
  let cat = '';
  let shown = 0;
  let filtered = [];

  const search = h('input', { class: 'input', type: 'search', placeholder: 'ابحث بالاسم أو الباركود', autocomplete: 'off', oninput: (e) => { query = e.target.value; apply(); } });
  const chips = h('div', { class: 'chips chips-scroll' });
  const count = h('div', { class: 'list-count muted small' });
  const list = h('div', { class: 'list' });
  const sentinel = h('div', { class: 'sentinel' });
  const body = h('div');

  el.append(
    header('الأصناف', { actions: [iconButton('sliders', 'أدوات: استيراد، أسعار، ملصقات', () => navigate('/tools')), iconButton('scan', 'ابحث بالمسح', findByScan), syncBadge()] }),
    h('div', { class: 'page' },
      h('div', { class: 'search-row' }, icon('search', 20), search),
      h('div', { class: 'product-actions' },
        button('إضافة سريعة بالمسح', { icon: 'scan', onclick: () => navigate('/products/rapid') }),
        button('صنف جديد', { kind: 'outline', icon: 'plus', onclick: () => navigate('/products/edit') }),
      ),
      chips,
      body,
    ),
  );

  async function load() {
    [all, cats] = await Promise.all([app.products.list(), app.products.categories()]);
    paintChips();
    apply();
  }

  function paintChips() {
    if (!cats.length) { fill(chips); chips.hidden = true; return; }
    chips.hidden = false;
    const chip = (id, label) => h('button', { class: `chip ${cat === id ? 'on' : ''}`, type: 'button', onclick: () => { cat = id; paintChips(); apply(); } }, label);
    fill(chips, chip('', 'الكل'), ...cats.map((c) => chip(c.id, c.name)),
      h('button', { class: 'chip chip-ghost', type: 'button', onclick: () => navigate('/settings/categories') }, icon('edit', 16), 'التصنيفات'));
  }

  function apply() {
    const base = cat ? all.filter((p) => p.category_id === cat) : all;
    filtered = searchProducts(base, query);
    shown = 0;
    fill(list);
    if (!all.length) {
      fill(body, emptyState('box', 'لا أصناف بعد', 'أسرع طريقة: «إضافة سريعة بالمسح» — امسح الباركود، اكتب الاسم والسعر، وانتقل للتالي.'));
      return;
    }
    if (!filtered.length) {
      fill(body, emptyState('search', 'لا نتائج', query ? `لا صنف يطابق «${query}»` : 'لا أصناف في هذا التصنيف'));
      return;
    }
    count.textContent = `${filtered.length} صنف`;
    fill(body, count, list, sentinel);
    more();
  }

  function more() {
    const next = filtered.slice(shown, shown + PAGE);
    list.append(...next.map(rowFor));
    shown += next.length;
    sentinel.hidden = shown >= filtered.length;
  }

  function rowFor(p) {
    const u = unit(p.unit);
    const lvl = stockLevel(p.qty, p.low_stock ?? DEFAULT_LOW_STOCK_THRESHOLD * QTY_SCALE);
    return h('button', { class: 'row row-tap product-row', type: 'button', onclick: () => navigate(`/products/edit?id=${p.id}`) },
      productThumb(p, 48),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, p.name),
        h('span', { class: 'row-sub' }, money(p.sell_price, p.currency), u.id !== 'piece' ? ` / ${u.short}` : ''),
      ),
      h('span', { class: `stock-badge ${lvl ? `stock-${lvl}` : ''}` },
        h('span', { class: 'num' }, formatQty(p.qty)), h('small', null, u.short)),
    );
  }

  async function findByScan() {
    const code = await scanOnce('امسح لتجد الصنف');
    if (!code) return;
    const hit = await app.products.findByCode(code);
    if (hit) navigate(`/products/edit?id=${hit.product.id}`);
    else {
      toast('باركود غير مسجّل — أضفه الآن', { kind: 'info' });
      navigate(`/products/edit?barcode=${encodeURIComponent(code)}`);
    }
  }

  const io = 'IntersectionObserver' in window ? new IntersectionObserver((e) => { if (e[0].isIntersecting && shown < filtered.length) more(); }, { rootMargin: '400px' }) : null;
  if (io) io.observe(sentinel);

  load();
  const off = bus.on('data', (e) => {
    if (e.tables.some((t) => ['products', 'movements', 'categories', 'product_images'].includes(t))) load();
  });
  return () => { off(); if (io) io.disconnect(); };
}
