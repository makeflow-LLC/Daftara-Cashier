// بطاقة الصنف: إضافة وتعديل. الحقول الاختيارية (الوحدات، الصلاحية، الصور، الأزرار السريعة، العملة)
// تظهر فقط إن كانت ميزتها مفعّلة. الكمية تُحفظ كحركة مخزون، وتغيير السعر يُسجَّل في سجل الأسعار.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, field, input, button, switchRow, section, iconButton } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { scanOnce } from '../../ui/scanner.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import { parseQty, formatQty, UNITS, unit as unitOf, QTY_SCALE } from '../../domain/units.js';
import { marginBp, normalizeBarcode, isInternalBarcode } from '../../domain/product.js';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '../../domain/features.js';
import { uuid } from '../../core/ids.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { compressImage, pickImage } from '../../core/media.js';

const moneyText = (minor, code = 'ILS') => (minor === null || minor === undefined ? '' : formatDecimal(minor, CURRENCIES[code].minor, { trim: true, group: false }));

export async function renderProductForm(el, params) {
  const editing = params.id ? await app.products.get(params.id) : null;
  if (params.id && !editing) { toast('الصنف غير موجود', { kind: 'error' }); navigate('/products', { replace: true }); return; }
  const f = app.features;
  const base = app.shop?.base_currency || 'ILS';
  const p = editing || {
    id: null, name: params.name || '', barcode: params.barcode || null, category_id: params.category || null, unit: 'piece',
    cost_price: 0, sell_price: null, currency: base, low_stock: null, track_expiry: false, expiry_date: null,
    is_quick: false, note: null, qty: 0, units: [], images: [],
  };
  let unitId = p.unit;
  let catId = p.category_id;
  let currency = p.currency || base;
  let packs = (p.units || []).map((u) => ({ ...u }));
  const newImages = [];     // صور صنف جديد تُحفظ بعد إنشائه
  const errs = {};

  // ---------- الحقول ----------
  const name = input({ value: p.name, maxlength: 120, placeholder: 'مثال: حليب نيدو 400 غ', enterkeyhint: 'next' });
  const barcode = input({ value: p.barcode || '', dir: 'ltr', inputmode: 'numeric', placeholder: 'اختياري' });
  const sell = input({ value: moneyText(p.sell_price, currency), dir: 'ltr', inputmode: 'decimal', placeholder: '0.00' });
  const cost = input({ value: p.cost_price ? moneyText(p.cost_price, currency) : '', dir: 'ltr', inputmode: 'decimal', placeholder: '0.00' });
  const qty = input({ value: formatQty(p.qty || 0), dir: 'ltr', inputmode: 'decimal' });
  const low = input({ value: formatQty(p.low_stock ?? DEFAULT_LOW_STOCK_THRESHOLD * QTY_SCALE), dir: 'ltr', inputmode: 'decimal' });
  const expiry = input({ type: 'date', value: p.expiry_date || '', dir: 'ltr' });
  const note = input({ value: p.note || '', maxlength: 200 });
  const margin = h('div', { class: 'field-hint margin-hint' });
  const catalogHint = h('div', { class: 'field-hint' });
  let isQuick = !!p.is_quick;

  function errorEl(key) {
    return errs[key] || (errs[key] = h('span', { class: 'field-error', role: 'alert', hidden: true }));
  }
  function showErrors(map) {
    for (const [k, e] of Object.entries(errs)) { e.hidden = !map[k]; e.textContent = map[k] || ''; }
  }

  function paintMargin() {
    const s = parseMoney(sell.value || '0', currency);
    const c = parseMoney(cost.value || '0', currency);
    const m = marginBp(c, s);
    if (m === null || !app.can('see_profit')) { margin.textContent = ''; return; }
    margin.className = `field-hint margin-hint ${m < 0 ? 'bad' : 'ok'}`;
    margin.textContent = `الربح في القطعة ${formatMoney(s - c, currency)} — هامش ${formatDecimal(m, 2, { trim: true })}%`;
  }
  sell.addEventListener('input', paintMargin);
  cost.addEventListener('input', paintMargin);

  // اسم مقترح من الكتالوج المشترك لباركود جديد
  async function suggestName(code) {
    if (!code || name.value.trim()) return;
    catalogHint.textContent = 'نبحث عن اسم هذا الباركود…';
    const n = await app.catalogLookup(code);
    if (n && !name.value.trim()) {
      name.value = n;
      catalogHint.textContent = 'الاسم من الكتالوج المشترك — عدّله إن شئت';
    } else catalogHint.textContent = '';
  }

  // ---------- الوحدة ----------
  const unitChips = h('div', { class: 'chips' });
  function paintUnits() {
    fill(unitChips, ...Object.values(UNITS).map((u) => h('button', {
      class: `chip ${unitId === u.id ? 'on' : ''}`, type: 'button', onclick: () => { unitId = u.id; paintUnits(); paintPacks(); },
    }, u.name)));
  }

  // ---------- التصنيف ----------
  const catChips = h('div', { class: 'chips' });
  async function paintCats() {
    const cats = await app.products.categories();
    fill(catChips,
      h('button', { class: `chip ${!catId ? 'on' : ''}`, type: 'button', onclick: () => { catId = null; paintCats(); } }, 'بلا تصنيف'),
      ...cats.map((c) => h('button', { class: `chip ${catId === c.id ? 'on' : ''}`, type: 'button', onclick: () => { catId = c.id; paintCats(); } }, c.name)),
      h('button', { class: 'chip chip-ghost', type: 'button', onclick: addCategory }, icon('plus', 16), 'تصنيف'),
    );
  }
  function addCategory() {
    const inp = input({ maxlength: 40, placeholder: 'مثال: ألبان' });
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { const c = await app.products.addCategory(inp.value); catId = c.id; close(); paintCats(); }
        catch (err) { feedback.error(); toast(err.errors?.name || 'تعذّر الحفظ', { kind: 'error' }); }
      },
    }, field('اسم التصنيف', inp), button('أضف', { type: 'submit', block: true, icon: 'check' })), { title: 'تصنيف جديد' });
    setTimeout(() => inp.focus(), 200);
  }

  // ---------- العبوات ----------
  const packList = h('div', { class: 'list' });
  function paintPacks() {
    const u = unitOf(unitId);
    fill(packList, ...packs.map((pk, i) => h('button', { class: 'row row-tap', type: 'button', onclick: () => editPack(i) },
      h('span', { class: 'row-ic' }, icon('box', 20)),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, pk.name),
        h('span', { class: 'row-sub' }, `= ${formatQty(pk.factor)} ${u.short}`, pk.sell_price ? ` — ${formatMoney(pk.sell_price, currency)}` : '', pk.barcode ? ` — ${pk.barcode}` : ''),
      ),
    )), h('button', { class: 'row row-tap row-add', type: 'button', onclick: () => editPack(-1) }, h('span', { class: 'row-ic' }, icon('plus', 20)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'أضف عبوة (كرتونة، علبة، دزينة…)'))));
  }
  function editPack(i) {
    const pk = i >= 0 ? packs[i] : { id: uuid(), name: 'كرتونة', factor: 12000, barcode: null, sell_price: null };
    const pn = input({ value: pk.name, maxlength: 30 });
    const pf = input({ value: formatQty(pk.factor), dir: 'ltr', inputmode: 'decimal' });
    const pb = input({ value: pk.barcode || '', dir: 'ltr', inputmode: 'numeric', placeholder: 'اختياري' });
    const ps = input({ value: moneyText(pk.sell_price, currency), dir: 'ltr', inputmode: 'decimal', placeholder: 'اختياري' });
    openSheet((close) => h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const factor = parseQty(pf.value);
        const next = { ...pk, name: pn.value.trim(), factor: factor ?? 0, barcode: normalizeBarcode(pb.value) || null, sell_price: ps.value.trim() ? parseMoney(ps.value, currency) : null };
        if (!next.name || !(next.factor > QTY_SCALE)) { feedback.error(); toast('اكتب اسم العبوة وعدد القطع فيها (أكثر من 1)', { kind: 'error' }); return; }
        if (i >= 0) packs[i] = next; else packs.push(next);
        close(); paintPacks();
      },
    },
      field('اسم العبوة', pn),
      field(`كم ${unitOf(unitId).name} فيها؟`, pf),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'باركود العبوة'),
        h('div', { class: 'input-row' }, pb, iconButton('scan', 'امسح', async () => { const c = await scanOnce('امسح باركود العبوة'); if (c) pb.value = c; }))),
      field('سعر بيع العبوة', ps, 'اتركه فارغًا ليُحسب من سعر القطعة'),
      button('حفظ العبوة', { type: 'submit', block: true, icon: 'check' }),
      i >= 0 ? button('حذف العبوة', { kind: 'text', onclick: () => { packs.splice(i, 1); close(); paintPacks(); } }) : null,
    ), { title: i >= 0 ? 'تعديل العبوة' : 'عبوة جديدة' });
  }

  // ---------- الصور ----------
  const imgRow = h('div', { class: 'img-row' });
  async function paintImages() {
    const tiles = [];
    const current = editing ? (await app.products.get(editing.id)).images : [];
    for (const img of current) {
      const url = (await app.media.url(img.id, { full: true })) || (app.mediaSync && (await app.mediaSync.fetch(img, { full: true })) && (await app.media.url(img.id, { full: true })));
      tiles.push(imgTile(url, async () => {
        await app.media.removeProductImage(img.id);
        paintImages();
        toast('حُذفت الصورة');
      }));
    }
    newImages.forEach((c, i) => tiles.push(imgTile(URL.createObjectURL(c.thumb), () => { newImages.splice(i, 1); paintImages(); })));
    if (current.length + newImages.length < 3) {
      tiles.push(h('button', { class: 'img-tile img-add', type: 'button', onclick: addImage }, icon('camera', 26), h('span', null, 'صورة')));
    }
    fill(imgRow, ...tiles);
  }
  function imgTile(url, onRemove) {
    return h('div', { class: 'img-tile', style: url ? { backgroundImage: `url("${url}")` } : null },
      h('button', { class: 'img-remove', type: 'button', 'aria-label': 'حذف الصورة', onclick: onRemove }, icon('x', 16)));
  }
  function addImage() {
    openSheet((close) => h('div', null,
      button('الكاميرا', { icon: 'camera', block: true, onclick: () => { close(); takeImage(true); } }),
      button('من المعرض', { kind: 'outline', icon: 'box', block: true, onclick: () => { close(); takeImage(false); } }),
    ), { title: 'صورة الصنف' });
  }
  async function takeImage(camera) {
    const file = await pickImage({ camera });
    if (!file) return;
    try {
      if (editing) await app.media.addProductImage(editing.id, file);
      else newImages.push(await compressImage(file));
      paintImages();
    } catch (e) {
      feedback.error();
      toast(e.message || 'تعذّرت إضافة الصورة', { kind: 'error' });
    }
  }

  // ---------- الحفظ ----------
  let saving = false;
  async function save(e) {
    e?.preventDefault();
    if (saving) return;
    const sellV = sell.value.trim() === '' ? null : parseMoney(sell.value, currency);
    const costV = cost.value.trim() === '' ? 0 : parseMoney(cost.value, currency);
    const qtyV = parseQty(qty.value || '0');
    const lowV = parseQty(low.value || '0');
    const local = {};
    if (sellV === null) local.sell_price = 'اكتب سعر البيع';
    if (costV === null) local.cost_price = 'سعر التكلفة غير صحيح';
    if (qtyV === null) local.qty = 'الكمية غير صحيحة';
    if (Object.keys(local).length) { showErrors(local); feedback.error(); return; }
    saving = true;
    try {
      const { product, warnings } = await app.products.save({
        ...(editing ? stripDerived(editing) : {}),
        id: editing?.id || undefined,
        name: name.value, barcode: normalizeBarcode(barcode.value) || null,
        internal_code: isInternalBarcode(normalizeBarcode(barcode.value)),
        sell_price: sellV, cost_price: costV, currency, unit: unitId, category_id: catId,
        low_stock: lowV, track_expiry: !!(f.expiry && expiry.value), expiry_date: f.expiry && expiry.value ? expiry.value : null,
        is_quick: isQuick, note: note.value.trim() || null,
      }, { qty: qtyV, packs: f.units ? packs : null });
      for (const c of newImages) await app.media.addProductImage(product.id, c);
      feedback.ok();
      toast(editing ? 'حُفظ الصنف' : `أُضيف «${product.name}»`, { kind: 'ok' });
      if (warnings[0]) setTimeout(() => toast(warnings[0], { kind: 'error' }), 2700);
      history.back();
    } catch (err) {
      saving = false;
      feedback.error();
      if (err.errors) { showErrors(err.errors); toast(Object.values(err.errors)[0], { kind: 'error' }); }
      else { console.error(err); toast('تعذّر الحفظ', { kind: 'error' }); }
    }
  }

  async function remove() {
    await app.products.remove(editing.id);
    history.back();
    toast(`حُذف «${editing.name}»`, { undo: () => app.products.restore(editing.id) });
  }

  // ---------- خيارات إضافية (مطوية للصنف الجديد: الأساس اسم وسعر فقط) ----------
  const hasAdvanced = !!(editing && (editing.category_id || editing.units.length || editing.expiry_date || editing.is_quick || editing.note || editing.unit !== 'piece' || editing.low_stock !== null));
  const adv = h('div', { class: 'adv', hidden: !hasAdvanced },
    f.multiCurrency ? currencyPicker(() => currency, (c) => { currency = c; paintMargin(); }) : null,
    f.units ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'يُباع بـ'), unitChips) : null,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'التصنيف'), catChips),
    field('نبّهني عندما تقل الكمية عن', low),
    f.units ? section('العبوات', packList, h('p', { class: 'muted small' }, 'المخزون يبقى بالقطعة: بيع كرتونة ينقص 24 قطعة تلقائيًا.'), errorEl('packs')) : null,
    f.expiry ? field('تاريخ انتهاء الصلاحية', expiry, 'ننبهك قبل الانتهاء بـ 30 يومًا') : null,
    f.quickItems ? h('div', { class: 'list' }, switchRow({ title: 'زر في شاشة البيع', sub: 'للأصناف بلا باركود: خبز، أكياس، فكّة…', checked: isQuick, onchange: (v) => { isQuick = v; } })) : null,
    field('ملاحظة', note));
  const advToggle = h('button', { class: 'adv-toggle', type: 'button', onclick: () => { adv.hidden = !adv.hidden; advToggle.classList.toggle('open', !adv.hidden); } },
    icon('sliders', 20), h('span', null, 'خيارات إضافية'), h('small', null, [f.units ? 'الوحدة والعبوات' : null, 'التصنيف', f.expiry ? 'الصلاحية' : null, 'التنبيه'].filter(Boolean).join('، ')), icon('chevron', 18));
  if (hasAdvanced) advToggle.classList.add('open');

  // ---------- الرسم ----------
  el.append(
    header(editing ? 'تعديل الصنف' : 'صنف جديد', { back: true, actions: editing ? [iconButton('trash', 'حذف الصنف', remove)] : [] }),
    h('form', { class: 'page product-form', onsubmit: save },
      f.images ? section(null, imgRow) : null,
      field('اسم الصنف', name, null), errorEl('name'), catalogHint,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'الباركود'),
        h('div', { class: 'input-row' }, barcode,
          iconButton('scan', 'امسح الباركود', async () => { const c = await scanOnce(); if (c) { barcode.value = c; suggestName(c); } }),
        ),
        errorEl('barcode'),
        h('button', { class: 'link-btn', type: 'button', onclick: async () => { barcode.value = await app.products.nextInternalBarcode(); } }, 'لا باركود له؟ ولّد باركودًا داخليًا'),
      ),
      h('div', { class: 'grid-2' },
        h('div', null, field(`سعر البيع${f.units && unitId !== 'piece' ? ` لكل ${unitOf(unitId).name}` : ''}`, sell), errorEl('sell_price')),
        app.can('see_cost') ? h('div', null, field('سعر التكلفة', cost), errorEl('cost_price')) : null,
      ),
      margin,
      h('div', null, field(editing ? 'الكمية الموجودة الآن' : 'الكمية الموجودة (اختياري)', qty), errorEl('qty')),
      advToggle,
      adv,
      h('div', { class: 'sticky-save' }, button(editing ? 'حفظ التعديل' : 'حفظ الصنف', { type: 'submit', block: true, size: 'lg', icon: 'check' })),
    ),
  );
  paintUnits();
  paintCats();
  paintPacks();
  paintMargin();
  if (f.images) paintImages();
  if (!editing && p.barcode) suggestName(p.barcode);
  if (!editing) setTimeout(() => (p.name ? sell : name).focus(), 80);
}

function currencyPicker(get, set) {
  const chips = h('div', { class: 'chips' });
  const paint = () => fill(chips, ...Object.values(CURRENCIES).map((c) => h('button', { class: `chip ${get() === c.code ? 'on' : ''}`, type: 'button', onclick: () => { set(c.code); paint(); } }, `${c.name} ${c.symbol}`)));
  paint();
  return h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'عملة السعر'), chips);
}

function stripDerived(p) {
  const { qty, avg_cost, units, images, ...rest } = p;
  return rest;
}
