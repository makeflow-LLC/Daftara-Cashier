// شاشة البيع: الكاميرا في الأعلى والسلة تحتها، بحث بالاسم، أزرار الأصناف السريعة، خصم السطر والفاتورة،
// مؤشر الربح (لصاحب المحل)، تعليق السلة لخدمة زبون آخر، والدفع. السلة تُحفظ لحظيًا: لو انطفأ الجوال تعود.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, iconButton, money, emptyState, input, button, field } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { startInlineScanner } from '../../ui/scanner.js';
import { makeLine, addLine, lineTotal, cartTotals } from '../../domain/cart.js';
import { searchProducts, normalizeBarcode } from '../../domain/product.js';
import { formatQty, parseQty, unit as unitOf, QTY_SCALE } from '../../domain/units.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal, parseDecimal } from '../../domain/money.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { productThumb } from '../products/thumb.js';
import { openPay } from './pay.js';

const PREF = 'cashier-sale-camera';

export function renderSale(el) {
  const t0 = performance.now();
  const base = app.shop?.base_currency || 'ILS';
  const showProfit = app.can('see_profit');
  let cart = { lines: [], discount: null, customer: null };
  let products = null;          // تُحمَّل بعد الرسم (لا تؤخر فتح الشاشة)
  let scanner = null;
  let cameraOn = readPref();

  // ---------- العناصر ----------
  const scanBox = h('div', { class: 'scan-box sale-cam' }, h('span', { class: 'scan-laser' }));
  const camStatus = h('div', { class: 'cam-status' });
  const search = input({ type: 'search', placeholder: 'ابحث بالاسم أو اكتب الباركود', enterkeyhint: 'search', autocomplete: 'off' });
  const results = h('div', { class: 'search-results', hidden: true });
  const quick = h('div', { class: 'quick-grid' });
  const custEl = h('div');
  const cartEl = h('div', { class: 'cart' });
  const totalEl = h('div', { class: 'paybar-total' });
  const heldBtn = iconButton('cart', 'السلال المعلّقة', openHeld);
  const camBtn = iconButton('scan', 'الكاميرا', toggleCamera);
  const torchBtn = iconButton('flash', 'الفلاش', () => scanner && scanner.toggleTorch());
  torchBtn.hidden = true;
  const payBtn = h('button', { class: 'btn btn-primary btn-lg paybtn', type: 'button', onclick: pay }, icon('check', 22), h('span', null, 'ادفع'));

  el.append(h('div', { class: 'sale' },
    header('بيع', { back: true, actions: [torchBtn, camBtn, heldBtn, iconButton('receipt', 'مرتجع', () => navigate('/sale/returns'))] }),
    scanBox, camStatus,
    h('div', { class: 'sale-search' }, h('div', { class: 'search-row' }, icon('search', 20), search), results),
    quick, custEl, cartEl,
    h('div', { class: 'paybar' }, totalEl,
      h('div', { class: 'paybar-actions' },
        iconButton('tag', 'خصم على الفاتورة', openDiscount, 'pb-icon'),
        iconButton('user', 'الزبون', chooseCustomer, 'pb-icon'),
        iconButton('clipboard', 'علّق السلة', holdCart, 'pb-icon'),
        payBtn)),
  ));

  // ---------- السلة ----------
  let saveTimer = null;
  function changed() {
    paint();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => app.sales.saveCurrent(serialize()), 300);
  }
  function serialize() {
    return { lines: cart.lines, discount: cart.discount, customer: cart.customer ? { id: cart.customer.id, name: cart.customer.name, phone: cart.customer.phone } : null };
  }

  function paint() {
    const t = cartTotals(cart.lines, cart.discount);
    if (!cart.lines.length) {
      fill(cartEl, emptyState('cart', 'السلة فارغة', cameraOn ? 'امسح باركود الصنف بالكاميرا أو ابحث باسمه.' : 'ابحث باسم الصنف أو اكتب الباركود.'));
    } else {
      fill(cartEl, h('div', { class: 'list cart-list' }, ...cart.lines.map((l, i) => lineRow(l, i))));
    }
    fill(custEl, cart.customer ? h('div', { class: 'cust-chip' }, icon('user', 16), h('span', null, cart.customer.name),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'إزالة الزبون', onclick: () => { cart.customer = null; changed(); } }, icon('x', 16))) : null);
    fill(totalEl,
      h('div', { class: 'pt-main' }, money(t.total)),
      h('div', { class: 'pt-sub' },
        h('span', null, `${t.count} صنف`),
        t.discount ? h('span', null, ' · خصم ', num(formatMoney(t.discount, base))) : null,
        showProfit && t.count ? h('span', { class: `pt-profit ${t.profit < 0 ? 'neg' : ''}` }, ' · ربح ', num(formatMoney(t.profit, base))) : null,
      ));
    payBtn.disabled = !cart.lines.length;
  }

  function lineRow(l, i) {
    const measured = unitOf(l.unit).measured && !l.unit_id;
    return h('div', { class: 'row cart-line' },
      h('button', { class: 'cl-main', type: 'button', onclick: () => editLine(i) },
        h('span', { class: 'row-title' }, l.name),
        h('span', { class: 'row-sub' }, num(formatQty(l.qty)), ` ${measured ? unitOf(l.unit).short : ''} × `, num(formatMoney(l.unit_price, base)),
          l.discount ? h('span', { class: 'cl-disc' }, ' − ', num(formatMoney(l.discount, base))) : null)),
      measured ? null : h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': 'إنقاص', onclick: () => step(i, -1) }, icon(l.qty <= QTY_SCALE ? 'trash' : 'minus', 18)),
        h('button', { type: 'button', 'aria-label': 'زيادة', onclick: () => step(i, +1) }, icon('plus', 18))),
      h('span', { class: 'cl-total' }, money(lineTotal(l), base)),
    );
  }

  function step(i, d) {
    const l = cart.lines[i];
    const q = l.qty + d * QTY_SCALE;
    feedback.tap();
    if (q <= 0) return removeLine(i);
    cart.lines = cart.lines.map((x, j) => (j === i ? { ...x, qty: q } : x));
    changed();
  }

  function removeLine(i) {
    const removed = cart.lines[i];
    cart.lines = cart.lines.filter((_, j) => j !== i);
    changed();
    toast(`أُزيل «${removed.name}»`, { undo: () => { cart.lines.splice(i, 0, removed); changed(); } });
  }

  function editLine(i) {
    const l = cart.lines[i];
    const minor = CURRENCIES[base].minor;
    const q = input({ value: formatQty(l.qty), dir: 'ltr', inputmode: 'decimal', class: 'input input-xl' });
    const p = input({ value: formatDecimal(l.unit_price, minor, { trim: true, group: false }), dir: 'ltr', inputmode: 'decimal' });
    const d = input({ value: l.discount ? formatDecimal(l.discount, minor, { trim: true, group: false }) : '', dir: 'ltr', inputmode: 'decimal', placeholder: '0' });
    openSheet((close) => h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const qty = parseQty(q.value);
        const price = parseMoney(p.value, base);
        const disc = d.value.trim() ? parseMoney(d.value, base) : 0;
        if (!qty || qty <= 0 || price === null || price < 0 || disc === null || disc < 0) { feedback.error(); toast('تحقق من الكمية والسعر', { kind: 'error' }); return; }
        cart.lines = cart.lines.map((x, j) => (j === i ? { ...x, qty, unit_price: price, discount: disc, key: price !== l.unit_price ? `${x.key}:custom` : x.key } : x));
        close(); changed();
      },
    },
      field(`الكمية${unitOf(l.unit).measured && !l.unit_id ? ` (${unitOf(l.unit).name})` : ''}`, q),
      h('div', { class: 'grid-2' }, field('السعر', p), field('خصم على السطر', d)),
      button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
      button('أزل من السلة', { kind: 'text', onclick: () => { close(); removeLine(i); } }),
    ), { title: l.name });
    setTimeout(() => { q.focus(); q.select(); }, 150);
  }

  // ---------- الإضافة ----------
  async function addProduct(product, pack = null) {
    const s = await app.db.stock.get(product.id);
    const line = makeLine(product, { pack, avgCost: s ? s.avgCost : null });
    if (unitOf(product.unit).measured && !pack) return askQty(line);
    cart.lines = addLine(cart.lines, line);
    changed();
    if (s && s.qty - (pack ? pack.factor : QTY_SCALE) < 0) toast(`تنبيه: مخزون «${product.name}» لا يكفي`, { kind: 'info' });
  }

  function askQty(line) {
    const u = unitOf(line.unit);
    const q = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0' });
    const presets = u.id === 'kg' ? ['0.25', '0.5', '1', '2'] : u.id === 'meter' ? ['0.5', '1', '1.5', '2', '3'] : ['0.5', '1', '2'];
    openSheet((close) => h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const qty = parseQty(q.value);
        if (!qty || qty <= 0) { feedback.error(); return; }
        cart.lines = addLine(cart.lines, { ...line, qty, key: `${line.key}:${Date.now()}` });
        close(); changed();
      },
    },
      h('p', { class: 'muted' }, `السعر: ${formatMoney(line.unit_price, base)} لكل ${u.name}`),
      field(`الكمية (${u.name})`, q),
      h('div', { class: 'chips' }, ...presets.map((v) => h('button', { class: 'chip', type: 'button', onclick: () => { q.value = v; } }, v))),
      button('أضف', { type: 'submit', block: true, size: 'lg', icon: 'plus' }),
    ), { title: line.name });
    setTimeout(() => q.focus(), 150);
  }

  async function onCode(raw) {
    const code = normalizeBarcode(raw);
    const hit = await app.products.findByCode(code);
    if (!hit) {
      feedback.error();
      toast('باركود غير مسجّل', { kind: 'error' });
      offerNew(code);
      return;
    }
    await addProduct(hit.product, hit.pack);
  }

  function offerNew(code) {
    openSheet((close) => h('div', null,
      h('p', null, 'هذا الباركود غير مسجّل: ', num(code)),
      button('أضفه كصنف جديد', { block: true, icon: 'plus', onclick: () => { close(); navigate(`/products/edit?barcode=${encodeURIComponent(code)}`); } }),
      button('تجاهل', { kind: 'text', onclick: close }),
    ), { title: 'صنف غير معروف' });
  }

  // ---------- البحث ----------
  function paintResults() {
    const q = search.value.trim();
    if (!q || !products) { results.hidden = true; return; }
    const hits = searchProducts(products, q, 8);
    results.hidden = false;
    fill(results, hits.length ? hits.map((p) => h('button', {
      class: 'row row-tap', type: 'button',
      onclick: () => { search.value = ''; results.hidden = true; addProduct(p); },
    }, productThumb(p, 36), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name)), money(p.sell_price, p.currency)))
      : h('div', { class: 'row muted' }, 'لا نتائج'));
  }
  search.addEventListener('input', paintResults);
  search.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = search.value.trim();
    if (!q) return;
    if (/^\d{4,}$/.test(normalizeBarcode(q))) { search.value = ''; results.hidden = true; return onCode(q); }
    const hits = products ? searchProducts(products, q, 1) : [];
    if (hits[0]) { search.value = ''; results.hidden = true; addProduct(hits[0]); }
  });
  search.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 200));
  search.addEventListener('focus', paintResults);

  async function loadProducts() {
    products = await app.products.list();
    const q = products.filter((p) => p.is_quick).sort((a, b) => (a.quick_sort - b.quick_sort) || a.name.localeCompare(b.name, 'ar'));
    if (!app.feature('quickItems') || !q.length) { quick.hidden = true; return; }
    quick.hidden = false;
    fill(quick, ...q.map((p) => h('button', { class: 'quick-item', type: 'button', onclick: () => { feedback.tap(); addProduct(p); } },
      productThumb(p, 44), h('span', { class: 'qi-name' }, p.name), h('span', { class: 'qi-price' }, money(p.sell_price, p.currency)))));
  }

  // ---------- الكاميرا ----------
  async function startCam() {
    scanBox.hidden = false;
    camStatus.textContent = '';
    scanner = await startInlineScanner({ box: scanBox, onCode, onStatus: (m) => { camStatus.textContent = m; } });
    if (!scanner) scanBox.hidden = true;
    torchBtn.hidden = !(scanner && scanner.torch);
    camBtn.classList.toggle('on', !!scanner);
  }
  async function stopCam() {
    if (scanner) await scanner.stop();
    scanner = null;
    scanBox.hidden = true;
    torchBtn.hidden = true;
    camBtn.classList.remove('on');
  }
  function toggleCamera() {
    cameraOn = !cameraOn;
    writePref(cameraOn);
    if (cameraOn) startCam(); else { stopCam(); camStatus.textContent = ''; }
  }

  // ---------- الخصم والزبون والتعليق ----------
  function openDiscount() {
    const t = cartTotals(cart.lines);
    if (!t.count) return;
    let type = cart.discount?.type || 'amount';
    const v = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', value: cart.discount ? (cart.discount.type === 'percent' ? formatDecimal(cart.discount.value, 2, { trim: true, group: false }) : formatDecimal(cart.discount.value, CURRENCIES[base].minor, { trim: true, group: false })) : '' });
    const chips = h('div', { class: 'chips' });
    const paintChips = () => fill(chips,
      h('button', { class: `chip ${type === 'amount' ? 'on' : ''}`, type: 'button', onclick: () => { type = 'amount'; paintChips(); } }, `مبلغ ${CURRENCIES[base].symbol}`),
      h('button', { class: `chip ${type === 'percent' ? 'on' : ''}`, type: 'button', onclick: () => { type = 'percent'; paintChips(); } }, 'نسبة %'),
      ...['5', '10'].map((p) => h('button', { class: 'chip', type: 'button', onclick: () => { type = 'percent'; v.value = p; paintChips(); } }, `${p}%`)));
    paintChips();
    openSheet((close) => h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (!v.value.trim()) { cart.discount = null; close(); return changed(); }
        const val = type === 'percent' ? parseDecimal(v.value, 2) : parseMoney(v.value, base);
        if (val === null || val < 0 || (type === 'percent' && val > 10000)) { feedback.error(); return; }
        cart.discount = val ? { type, value: val } : null;
        close(); changed();
      },
    }, h('p', { class: 'muted' }, 'الإجمالي قبل الخصم: ', num(formatMoney(t.subtotal, base))), chips, field('الخصم', v),
      button('طبّق الخصم', { type: 'submit', block: true, icon: 'check' }),
      cart.discount ? button('بلا خصم', { kind: 'text', onclick: () => { cart.discount = null; close(); changed(); } }) : null,
    ), { title: 'خصم على الفاتورة' });
    setTimeout(() => v.focus(), 150);
  }

  async function chooseCustomer() {
    const { pickCustomer } = await import('../customers/picker.js');
    const c = await pickCustomer({ title: 'زبون هذه الفاتورة' });
    if (c) { cart.customer = c; changed(); }
  }

  async function holdCart() {
    if (!cart.lines.length) { toast('السلة فارغة'); return; }
    const label = cart.customer ? cart.customer.name : null;
    await app.sales.hold(serialize(), label);
    cart = { lines: [], discount: null, customer: null };
    changed();
    paintHeld();
    feedback.ok();
    toast('عُلّقت السلة — خدم الزبون التالي');
  }

  async function paintHeld() {
    const n = (await app.sales.listHeld()).length;
    heldBtn.dataset.badge = n ? String(n) : '';
    heldBtn.classList.toggle('has-badge', !!n);
  }

  async function openHeld() {
    const held = await app.sales.listHeld();
    if (!held.length) { toast('لا سلال معلّقة'); return; }
    openSheet((close) => h('div', { class: 'list' }, ...held.map((hd) => {
      const t = cartTotals(hd.cart.lines, hd.cart.discount);
      return h('button', {
        class: 'row row-tap', type: 'button',
        onclick: async () => {
          if (cart.lines.length) await app.sales.hold(serialize(), cart.customer ? cart.customer.name : null);
          const c = await app.sales.takeHeld(hd.id);
          cart = { lines: c.lines, discount: c.discount, customer: c.customer };
          close(); changed(); paintHeld();
        },
      }, h('span', { class: 'row-ic' }, icon('cart', 20)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, hd.label || `${t.count} صنف`),
          h('span', { class: 'row-sub num' }, new Date(hd.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))),
        money(t.total, base));
    })), { title: 'السلال المعلّقة' });
  }

  // ---------- الدفع ----------
  function pay() {
    const t = cartTotals(cart.lines, cart.discount);
    if (!t.count) return;
    if (scanner) scanner.pause();
    openPay({
      total: t.total,
      customer: cart.customer,
      onConfirm: async ({ payments, customer }) => {
        const r = await app.sales.checkout({ lines: cart.lines, discount: cart.discount, payments, customerId: customer ? customer.id : null, currency: base });
        cart = { lines: [], discount: null, customer: null };
        changed();
        feedback.ok();
        done(r, customer);
      },
      onClose: () => { if (scanner) scanner.resume(); },
    });
  }

  function done(r, customer) {
    if (scanner) scanner.pause();
    openSheet((close) => h('div', { class: 'done' },
      h('div', { class: 'done-ic' }, icon('check', 40)),
      h('div', { class: 'done-title' }, 'تم البيع'),
      h('div', { class: 'done-num num' }, r.invoice.number),
      h('div', { class: 'done-total' }, money(r.invoice.total, base)),
      r.change ? h('div', { class: 'done-change' }, h('span', null, 'الباقي للزبون'), money(r.change, base)) : null,
      customer && r.invoice.paid < r.invoice.total ? h('div', { class: 'muted' }, `على حساب ${customer.name}: `, num(formatMoney(r.invoice.total - r.invoice.paid, base))) : null,
      showProfit ? h('div', { class: 'muted small' }, 'ربح هذه الفاتورة: ', num(formatMoney(r.profit, base))) : null,
      button('بيع جديد', { block: true, size: 'lg', icon: 'scan', onclick: close }),
    ), { title: null, onClose: () => { if (scanner) scanner.resume(); search.blur(); } });
  }

  // ---------- البدء ----------
  paint();
  paintHeld();
  app.sales.loadCurrent().then((c) => { if (c && c.lines.length && !cart.lines.length) { cart = { lines: c.lines, discount: c.discount, customer: c.customer }; paint(); } });
  setTimeout(loadProducts, 0);
  if (cameraOn) startCam(); else scanBox.hidden = true;
  const off = bus.on('data', (e) => { if (e.tables.includes('products') || e.tables.includes('movements')) loadProducts(); });
  el.dataset.openMs = String(Math.round(performance.now() - t0));
  return () => { off(); stopCam(); clearTimeout(saveTimer); app.sales.saveCurrent(serialize()); };
}

function readPref() {
  try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; }
}
function writePref(on) {
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* */ }
}
