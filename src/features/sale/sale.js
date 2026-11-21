// شاشة البيع: الكاميرا في الأعلى والسلة تحتها، بحث بالاسم، أزرار الأصناف السريعة، خصم السطر والفاتورة،
// مؤشر الربح (لصاحب المحل)، تعليق السلة لخدمة زبون آخر، والدفع. السلة تُحفظ لحظيًا: لو انطفأ الجوال تعود.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, iconButton, money, emptyState, input, button, field } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { startInlineScanner } from '../../ui/scanner.js';
import { listenKeyScanner, isDesktop } from '../../ui/keyscan.js';
import { pageShortcuts, kbd } from '../../ui/shortcuts.js';
import { makeLine, makeCustomLine, addLine, lineTotal, cartTotals } from '../../domain/cart.js';
import { uuid } from '../../core/ids.js';
import { applyOffers, localDay } from '../../domain/offers.js';
import { searchProducts, normalizeBarcode } from '../../domain/product.js';
import { formatQty, parseQty, unit as unitOf, QTY_SCALE } from '../../domain/units.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal, parseDecimal } from '../../domain/money.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { productThumb } from '../products/thumb.js';
import { openPay } from './pay.js';
import { showReceipt, printReceipt } from './receipt.js';
import { unknownBarcode } from '../products/link.js';
import { printer } from '../../core/printer.js';
import { readPrefs } from '../settings/settings.js';

const PREF = 'cashier-sale-camera';

export function renderSale(el, params = {}) {
  const t0 = performance.now();
  const base = app.shop?.base_currency || 'ILS';
  // الربح خاص بصاحب المحل: لا يظهر في شاشة البيع إلا إن فعّله من الإعدادات (الزبون قد يرى الشاشة)
  const showProfit = app.can('see_profit') && readPrefs().saleProfit === true;
  // exchange: تبديل — { amount, number } رصيد مرتجع يُخصم مما يدفعه الزبون في هذه الفاتورة
  let cart = { lines: [], discount: null, customer: null, exchange: null };
  let products = null;          // تُحمَّل بعد الرسم (لا تؤخر فتح الشاشة)
  let byId = new Map();         // للعروض على التصنيفات
  let scanner = null;
  let cameraOn = readPref();

  // ---------- العناصر ----------
  const scanBox = h('div', { class: 'scan-box sale-cam' }, h('span', { class: 'scan-laser' }));
  const camStatus = h('div', { class: 'cam-status' });
  const search = input({ type: 'search', placeholder: 'ابحث بالاسم أو اكتب الباركود', enterkeyhint: 'search', autocomplete: 'off' });
  const results = h('div', { class: 'search-results', hidden: true });
  const quick = h('div', { class: 'quick-grid' });
  const quickCats = h('div', { class: 'chips quick-cats', hidden: true });
  const quickWrap = h('div', { class: 'quick-wrap' }, quickCats, quick);
  let quickCat = null;          // تصنيف أزرار البيع السريع المختار (الشاشة العريضة)
  const custEl = h('div', { class: 'sale-cust' });
  const cartEl = h('div', { class: 'cart' });
  const totalEl = h('div', { class: 'paybar-total' });
  // أزرار بأيقونة واسم ظاهر: لا تخمين
  const labeled = (ic, short, aria, fn, cls = '', key = null) => h('button', { class: `lbl-btn ${cls}`.trim(), type: 'button', 'aria-label': aria, onclick: fn }, icon(ic, 22), h('span', null, short), key ? kbd(key) : null);
  const heldBtn = labeled('cart', 'معلّقة', 'السلال المعلّقة', openHeld, '', 'F9');
  const camBtn = labeled('scan', 'الكاميرا', 'الكاميرا', toggleCamera);
  const torchBtn = labeled('flash', 'فلاش', 'الفلاش', () => scanner && scanner.toggleTorch());
  torchBtn.hidden = true;
  const payBtn = h('button', { class: 'btn btn-primary btn-lg paybtn', type: 'button', onclick: pay }, icon('check', 22), h('span', null, 'ادفع'), kbd('F10'));

  el.append(h('div', { class: 'sale' },
    header('بيع', { back: true, actions: [torchBtn, camBtn, heldBtn, app.can('returns') ? labeled('undo', 'مرتجع', 'مرتجع', () => navigate('/sale/returns')) : null].filter(Boolean) }),
    scanBox, camStatus,
    h('div', { class: 'sale-search' }, h('div', { class: 'search-row' }, icon('search', 20), search), results),
    quickWrap, custEl, cartEl,
    h('div', { class: 'paybar paybar-2' },
      h('div', { class: 'paybar-tools' },
        // مبلغ حر = سعر يكتبه البائع: لمن يملك صلاحية «يعطي خصمًا ويغيّر السعر» (وصاحب المحل والمحل بلا موظفين)
        app.can('discount') ? labeled('coins', 'مبلغ', 'مبلغ بلا صنف', openCustom, 'pill', 'F7') : null,
        app.can('discount') ? labeled('tag', 'خصم', 'خصم على الفاتورة', openDiscount, 'pill', 'F4') : null,
        labeled('user', 'زبون', 'الزبون', chooseCustomer, 'pill', 'F6'),
        labeled('clipboard', 'علّق', 'علّق السلة', holdCart, 'pill', 'F8')),
      h('div', { class: 'paybar-main' }, totalEl, payBtn)),
  ));

  // ---------- السلة ----------
  let saveTimer = null;
  function changed() {
    paint();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => app.sales.saveCurrent(serialize()), 300);
  }
  function serialize() {
    return { lines: cart.lines, discount: cart.discount, exchange: cart.exchange || null, customer: cart.customer ? { id: cart.customer.id, name: cart.customer.name, phone: cart.customer.phone } : null };
  }

  // العروض تُحسب من جديد مع كل تغيير: السطور كما في السلة + خصم العرض (domain/offers.js)
  function priced() {
    return applyOffers(cart.lines, app.shop?.settings?.offers, { today: localDay(), categoryOf: (id) => byId.get(id)?.category_id || null, currency: base });
  }

  function paint() {
    const pr = priced();
    const t = cartTotals(pr.lines, cart.discount);
    if (!cart.lines.length) {
      fill(cartEl, emptyState('cart', 'السلة فارغة', cameraOn ? 'امسح باركود الصنف بالكاميرا أو ابحث باسمه.' : 'ابحث باسم الصنف أو اكتب الباركود.'));
    } else {
      fill(cartEl, h('div', { class: 'list cart-list' }, ...pr.lines.map((l, i) => lineRow(l, i))));
    }
    fill(custEl, cart.customer ? h('div', { class: 'cust-chip' }, icon('user', 16), h('span', null, cart.customer.name),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'إزالة الزبون', onclick: () => { cart.customer = null; customerDiscount(); changed(); } }, icon('x', 16))) : null,
      // تبديل: رصيد المرتجع ظاهر حتى تُدفع الفاتورة (الإلغاء = رُدّ له المبلغ نقدًا كما في فاتورة المرتجع)
      cart.exchange ? h('div', { class: 'cust-chip exchange-chip' }, icon('swap', 16),
        h('span', null, 'تبديل: للزبون ', money(cart.exchange.amount), cart.exchange.number ? [' من المرتجع ', num(cart.exchange.number)] : null),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'إلغاء التبديل', onclick: () => { cart.exchange = null; changed(); toast('أُلغي التبديل — رُدّ للزبون مبلغ المرتجع نقدًا', { kind: 'info', ms: 4000 }); } }, icon('x', 16))) : null);
    fill(totalEl,
      h('div', { class: 'pt-main' }, money(t.total)),
      h('div', { class: 'pt-sub' },
        h('span', null, `${t.count} صنف`),
        t.discount ? h('span', null, ' · خصم ', num(formatMoney(t.discount, base))) : null,
        pr.saved ? h('span', { class: 'pt-saved' }, ' · العروض وفّرت ', num(formatMoney(pr.saved, base))) : null,
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
          l.discount ? h('span', { class: 'cl-disc' }, ' − ', num(formatMoney(l.discount, base))) : null,
          l.offer ? h('span', { class: 'offer-badge' }, icon('tag', 13), l.offer) : null)),
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
      app.can('discount') ? h('div', { class: 'grid-2' }, field('السعر', p), field('خصم على السطر', d)) : null,
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
    const hit = await app.products.resolveScan(code, app.shop?.settings?.scale);
    if (hit && hit.scale) return addScaled(hit, code);
    if (!hit) {
      feedback.error();
      offerNew(code); // الورقة نفسها تقول «غير مسجّل» وتسأل ما هو
      return;
    }
    await addProduct(hit.product, hit.pack);
  }

  // ملصق الميزان: الوزن (أو السعر) من الباركود نفسه، سطر مستقل لكل ملصق
  async function addScaled(hit, code) {
    if (!hit.product) {
      feedback.error();
      toast(`ملصق ميزان: لا صنف برقم ${hit.scale.code}`, { kind: 'error', ms: 4000 });
      return;
    }
    if (hit.invalid) {
      feedback.error();
      toast(`«${hit.product.name}» بلا سعر بيع — اكتب سعره في بطاقة الصنف`, { kind: 'error', ms: 4000 });
      return;
    }
    const s = await app.db.stock.get(hit.product.id);
    const line = makeLine(hit.product, { qty: hit.qty, avgCost: s ? s.avgCost : null, key: `${hit.product.id}:scale:${code}:${Date.now()}` });
    cart.lines = addLine(cart.lines, { ...line, discount: hit.discount || 0 });
    changed();
  }

  // باركود غير مسجّل: قد يكون حبة من كرتونة مسجّلة — نسأل بدل إنشاء صنف مكرر
  function offerNew(code) {
    if (!app.can('products')) { toast('باركود غير مسجّل — اطلب من صاحب المحل إضافته', { kind: 'error', ms: 4000 }); return; }
    unknownBarcode(code, {
      context: 'sale',
      onNew: () => navigate(`/products/edit?barcode=${encodeURIComponent(code)}`),
      onDone: async () => { await loadProducts(); onCode(code); },
    });
  }

  // ---------- البحث ----------
  function paintResults() {
    const q = search.value.trim();
    if (!q || !products) { results.hidden = true; return; }
    const hits = searchProducts(products, q, 8);
    results.hidden = false;
    const pick = (p, pack = null) => { search.value = ''; results.hidden = true; addProduct(p, pack); };
    // صنف بكرتونة: زرّان واضحان — قطعة أو كرتونة كاملة
    fill(results, hits.length ? hits.map((p) => (p.pack && Number.isSafeInteger(p.pack.sell_price)
      ? h('div', { class: 'row pick-row' }, productThumb(p, 36), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name)),
        h('button', { class: 'pick-btn', type: 'button', onclick: () => pick(p) }, h('small', null, unitOf(p.unit).name), money(p.sell_price, p.currency)),
        h('button', { class: 'pick-btn pick-pack', type: 'button', onclick: () => pick(p, p.pack) }, h('small', null, p.pack.name), money(p.pack.sell_price, p.currency)))
      : h('button', { class: 'row row-tap', type: 'button', onclick: () => pick(p) },
        productThumb(p, 36), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name)), money(p.sell_price, p.currency))))
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
    byId = new Map(products.map((p) => [p.id, p]));
    paintQuick();
    paint();
  }

  // أزرار البيع السريع: الأصناف بلا باركود (خبز، أكياس، فلافل…) بضغطة. على الحاسوب والشاشة العريضة
  // تصير شبكة كبيرة بجانب السلة، مع تصنيفات للتصفية. الزر الأخير يضيف زرًا جديدًا.
  async function paintQuick() {
    if (!app.feature('quickItems') || !products) { quickWrap.hidden = true; return; }
    const all = products.filter((p) => p.is_quick).sort((a, b) => (a.quick_sort - b.quick_sort) || a.name.localeCompare(b.name, 'ar'));
    const catIds = [...new Set(all.map((p) => p.category_id).filter(Boolean))];
    const cats = catIds.length ? (await app.products.categories()).filter((c) => catIds.includes(c.id)) : [];
    if (quickCat && !cats.some((c) => c.id === quickCat)) quickCat = null;
    const shown = quickCat ? all.filter((p) => p.category_id === quickCat) : all;
    quickWrap.hidden = false;
    quickWrap.classList.toggle('empty', !all.length);
    quickCats.hidden = cats.length < 1 || all.length < 6;
    const chip = (id, label) => h('button', { class: `chip ${quickCat === id ? 'on' : ''}`, type: 'button', onclick: () => { quickCat = id; paintQuick(); } }, label);
    fill(quickCats, chip(null, 'الكل'), ...cats.map((c) => chip(c.id, c.name)));
    fill(quick, ...shown.map((p) => h('button', { class: 'quick-item', type: 'button', title: p.name, onclick: () => { feedback.tap(); addProduct(p); } },
      productThumb(p, 44), h('span', { class: 'qi-name' }, p.name), h('span', { class: 'qi-price' }, money(p.sell_price, p.currency)))),
    h('button', { class: 'quick-item quick-add', type: 'button', title: 'زر بيع سريع لصنف بلا باركود', onclick: () => navigate('/products/edit?quick=1') },
      icon('plus', 26), h('span', { class: 'qi-name' }, all.length ? 'زر جديد' : 'أضف زرًا لصنف بلا باركود')));
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

  // ---------- مبلغ بلا صنف ----------
  // بيع فوري لخدمة أو شيء غير مسجّل (طباعة، تصوير، تغليف…): المبلغ ثم Enter. الوصف اختياري،
  // وآخر ما كُتب يبقى أزرارًا على هذا الجهاز لضغطة واحدة في المرة القادمة.
  async function openCustom() {
    const recent = (await app.meta.get('sale:customNames', [])) || [];
    const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0' });
    const name = input({ maxlength: 60, placeholder: 'مثال: طباعة ورق (اختياري)' });
    if (scanner) scanner.pause();
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const v = parseMoney(amt.value || '', base);
        if (!v || v <= 0) { feedback.error(); toast('اكتب المبلغ', { kind: 'error' }); amt.focus(); return; }
        const line = makeCustomLine({ name: name.value, amount: v, key: uuid() });
        cart.lines = [...cart.lines, line];
        const typed = name.value.trim();
        if (typed) await app.meta.set('sale:customNames', [typed, ...recent.filter((x) => x !== typed)].slice(0, 6));
        feedback.ok(); close(); changed();
      },
    },
      field('المبلغ', amt),
      field('ما هو؟', name, 'يظهر في الفاتورة والتقارير. بلا وصف يُكتب «مبيعات متنوعة».'),
      recent.length ? h('div', { class: 'chips pay-quick' }, ...recent.map((n) => h('button', { class: 'chip', type: 'button', onclick: () => { name.value = n; amt.focus(); } }, n))) : null,
      button('أضف إلى الفاتورة', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
      h('p', { class: 'muted small' }, 'لا يغيّر المخزون. شيء تبيعه كثيرًا بسعر ثابت؟ اجعله زرًّا من «زر جديد» فتبيعه بضغطة.'),
    ), { title: 'مبلغ بلا صنف', onClose: () => { if (scanner) scanner.resume(); } });
    setTimeout(() => amt.focus(), 150);
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
    if (c) { cart.customer = c; customerDiscount(); changed(); }
  }

  // خصم دائم للزبون (من بطاقته): يُطبَّق على الفاتورة حين يُختار، ولا يغيّر خصمًا كتبه الكاشير
  function customerDiscount() {
    const bp = cart.customer ? (app.shop?.settings?.customerDiscounts || {})[cart.customer.id] : 0;
    if (bp > 0 && (!cart.discount || cart.discount.auto)) cart.discount = { type: 'percent', value: bp, auto: true };
    else if (!bp && cart.discount && cart.discount.auto) cart.discount = null;
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
          cart = { lines: c.lines, discount: c.discount, customer: c.customer, exchange: c.exchange || null };
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
    const pr = priced();
    const t = cartTotals(pr.lines, cart.discount);
    if (!t.count) return;
    if (scanner) scanner.pause();
    openPay({
      total: t.total,
      credit: cart.exchange ? cart.exchange.amount : 0,
      customer: cart.customer,
      onConfirm: async ({ payments, customer }) => {
        const r = await app.sales.checkout({ lines: pr.lines, discount: cart.discount, payments, customerId: customer ? customer.id : null, currency: base });
        if (customer) {
          // بيع بالآجل: رسالة SMS للزبون إن شغّلها صاحب المحل
          const credit = (await app.db.customer_entries.where('customer_id').equals(customer.id).toArray())
            .filter((e) => e.invoice_id === r.invoice.id).reduce((t, e) => t + e.amount, 0);
          if (credit > 0) app.sms.notify('sale_credit', customer, credit);
        }
        cart = { lines: [], discount: null, customer: null };
        changed();
        feedback.ok();
        done(r);
      },
      onClose: () => { if (scanner) scanner.resume(); },
    });
  }

  // بعد الدفع: الفاتورة نفسها (بلا ربح — قد يراها الزبون)، وزر واحد لبيع جديد
  function done(r) {
    if (scanner) scanner.pause();
    // الطباعة التلقائية إن فعّلها صاحب المحل لهذا الجهاز
    printer.settings().then(async (s) => { if (s.auto && (await printer.ready())) printReceipt(r.invoice.id); });
    showReceipt(r.invoice.id, { onClose: () => { if (scanner) scanner.resume(); search.blur(); } });
  }

  // ---------- البدء ----------
  paint();
  paintHeld();
  app.sales.loadCurrent().then(async (c) => {
    if (c && c.lines.length && !cart.lines.length) cart = { lines: c.lines, discount: c.discount, customer: c.customer, exchange: c.exchange || null };
    // قادم من «بدّل ببضاعة أخرى» في المرتجع: رصيد المرتجع وزبونه. نمسحهما من العنوان حتى لا يتكررا عند إعادة الفتح
    const amount = Number(params.exchange);
    if (Number.isSafeInteger(amount) && amount > 0) cart.exchange = { amount, number: params.ref || null };
    if (params.customer) { const cu = await app.db.customers.get(params.customer); if (cu && !cu.deleted) cart.customer = { id: cu.id, name: cu.name, phone: cu.phone }; }
    if (params.exchange || params.customer) { history.replaceState(null, '', '#/sale'); app.sales.saveCurrent(serialize()); }
    paint();
  });
  setTimeout(async () => {
    await loadProducts();
    // قادم من مسح القارئ في شاشة أخرى («بِعه الآن»): الصنف يدخل السلة مباشرة
    if (params.scan) { history.replaceState(null, '', '#/sale'); onCode(params.scan); }
  }, 0);
  // الحاسوب: قارئ باركود USB بدل الكاميرا، والمؤشر في البحث جاهز للكتابة
  if (isDesktop()) { cameraOn = false; camBtn.hidden = true; setTimeout(() => search.focus(), 50); }
  if (cameraOn) startCam(); else scanBox.hidden = true;
  const offKeys = listenKeyScanner(onCode);
  // لوحة المفاتيح (الحاسوب): البيع كله بلا فأرة
  const offShortcuts = pageShortcuts([
    { key: 'F10', label: 'ادفع', run: pay },
    ...(app.can('discount') ? [{ key: 'F4', label: 'خصم على الفاتورة', run: openDiscount }] : []),
    { key: 'F6', label: 'اختر الزبون', run: chooseCustomer },
    ...(app.can('discount') ? [{ key: 'F7', label: 'مبلغ بلا صنف', run: openCustom }] : []),
    { key: 'F8', label: 'علّق السلة', run: holdCart },
    { key: 'F9', label: 'السلال المعلّقة', run: openHeld },
    { key: 'Escape', run: () => { if (search.value) { search.value = ''; search.dispatchEvent(new Event('input')); } search.focus(); } },
  ]);
  const off = bus.on('data', (e) => { if (e.tables.includes('products') || e.tables.includes('movements')) loadProducts(); });
  el.dataset.openMs = String(Math.round(performance.now() - t0));
  return () => { off(); offKeys(); offShortcuts(); stopCam(); clearTimeout(saveTimer); app.sales.saveCurrent(serialize()); };
}

function readPref() {
  // نسخة الويب على حاسوب (فأرة): الكاميرا مطفأة حتى يشغّلها، فالقارئ USB هو المعتاد
  const pc = (globalThis.CASHIER_CONFIG || {}).flavor === 'web' && globalThis.matchMedia?.('(pointer:fine)').matches;
  try { const v = localStorage.getItem(PREF); return v ? v !== 'off' : !pc; } catch { return !pc; }
}
function writePref(on) {
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* */ }
}
