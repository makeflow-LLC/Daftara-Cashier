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
import { parseQty, formatQty, UNITS, unit as unitOf, QTY_SCALE, mainPack, splitByPack, lineAmount } from '../../domain/units.js';
import { linkSheet, mergeFrom } from './link.js';
import { marginBp, normalizeBarcode, isInternalBarcode, packToPiece, upsertPack, packEntry } from '../../domain/product.js';
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
    is_quick: params.quick === '1', note: null, qty: 0, units: [], images: [], scale_code: null,
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
  const scaleOn = !!app.shop?.settings?.scale?.enabled;
  const scaleCode = input({ value: p.scale_code || '', dir: 'ltr', inputmode: 'numeric', maxlength: 6, placeholder: 'مثال: 123' });
  const margin = h('div', { class: 'field-hint margin-hint' });
  const catalogHint = h('div', { class: 'field-hint' });
  let isQuick = !!p.is_quick;

  // ---------- السعر لـ: قطعة أو عبوة (التاجر يفكر غالبًا بسعر الكرتونة) ----------
  const PACK_MODES = [
    { id: 'piece', name: 'قطعة' },
    { id: 'كرتونة', name: 'كرتونة', count: '' },
    { id: 'دستة', name: 'دستة', count: '12' },
    { id: 'ربطة', name: 'ربطة', count: '' },
    { id: 'other', name: 'أخرى' },
  ];
  let mode = 'piece';
  let initialPackCost = null;
  const modeChips = h('div', { class: 'chips price-mode' });
  const countIn = input({ dir: 'ltr', inputmode: 'numeric', placeholder: 'مثال: 24' });
  const otherName = input({ maxlength: 30, placeholder: 'مثال: شوال، صندوق، علبة' });
  const countLabel = h('span', { class: 'field-label' });
  // القطعة المنفردة داخل العبوة: لها باركود غير باركود الكرتونة، وقد يختلف سعرها عن سعر الكرتونة ÷ العدد.
  // تظهر فور كتابة عدد القطع، فيُعرف الصنف سواء مُسحت كرتونته أو قطعة منه.
  const pieceCode = input({ dir: 'ltr', inputmode: 'numeric', placeholder: 'امسح قطعة واحدة' });
  const pieceSell = input({ dir: 'ltr', inputmode: 'decimal', placeholder: 'يُحسب وحده' });
  const pieceTitle = h('span', { class: 'field-label' });
  const pieceNote = h('div', { class: 'field-hint' });
  const pieceSellLabel = h('span', { class: 'field-label' });
  const pieceBox = h('div', { class: 'pack-piece', hidden: true },
    h('div', { class: 'field' }, pieceTitle,
      h('div', { class: 'input-row' }, pieceCode,
        iconButton('scan', 'امسح باركود القطعة المنفردة', async () => { const c = await scanOnce('امسح باركود القطعة المنفردة'); if (c) { pieceCode.value = c; paintMode(); } })),
      pieceNote),
    h('label', { class: 'field' }, pieceSellLabel, pieceSell));
  const packBox = h('div', { class: 'pack-box', hidden: true },
    h('label', { class: 'field pack-other', hidden: true }, h('span', { class: 'field-label' }, 'اسم العبوة'), otherName),
    h('label', { class: 'field' }, countLabel, countIn),
    pieceBox);
  const barcodeLabel = h('span', { class: 'field-label' }, 'الباركود');
  let packCodeStash = ''; // باركود العبوة حين يعود التاجر إلى «قطعة» ثم يرجع
  const pieceHint = h('div', { class: 'field-hint piece-hint' });
  const sellLabel = h('span', { class: 'field-label' });
  const costLabel = h('span', { class: 'field-label' });
  const qtyLabel = h('span', { class: 'field-label' });
  // بالكرتونة: «كم كرتونة؟» و«وكم قطعة زيادة؟» — 46 قطعة = 1 كرتونة و22 قطعة، لا «1.917 كرتونة»
  const loose = input({ dir: 'ltr', inputmode: 'decimal', placeholder: '0' });
  const looseLabel = h('span', { class: 'field-label' });
  const looseField = h('div', { hidden: true }, h('label', { class: 'field' }, looseLabel, loose));
  const packName = () => (mode === 'other' ? otherName.value.trim() : mode);
  const packCount = () => { const c = parseQty(countIn.value || ''); return c && c > QTY_SCALE ? c : null; };
  function paintMode() {
    fill(modeChips, ...PACK_MODES.map((m) => h('button', {
      class: `chip ${mode === m.id ? 'on' : ''}`, type: 'button',
      onclick: () => {
        const was = mode;
        // عند التعديل: نحوّل الأرقام المكتوبة بين الكرتونة والقطعة (80 للكرتونة لا تصير 80 للقطعة)
        if (editing && m.id !== mode) convertFields(mode, m.id);
        mode = m.id;
        // الأرقام المكتوبة تبقى كما هي: نفهمها الآن سعر العبوة (هكذا كتبها التاجر أصلًا)
        const existing = (packs || []).find((x) => x.name === packName());
        // والباركود كذلك: الممسوح يُفهم باركود العبوة، وباركود القطعة المنفردة يُمسح في خانته
        if (!editing && was === 'piece' && m.id !== 'piece') {
          const known = existing?.barcode || packCodeStash;
          if (known && known !== normalizeBarcode(barcode.value)) {
            if (!pieceCode.value.trim()) pieceCode.value = barcode.value;
            barcode.value = known;
          }
        } else if (!editing && was !== 'piece' && m.id === 'piece') {
          packCodeStash = '';
          if (pieceCode.value.trim()) { packCodeStash = normalizeBarcode(barcode.value); barcode.value = pieceCode.value; pieceCode.value = ''; }
        }
        if (m.id !== 'piece') countIn.value = existing ? formatQty(existing.factor) : (m.count || countIn.value);
        paintMode();
        if (m.id === 'other') otherName.focus(); else if (m.id !== 'piece' && !countIn.value) countIn.focus();
      },
    }, m.name)));
    const u = unitOf(unitId);
    const pk = mode !== 'piece';
    const nm = packName() || 'العبوة';
    const the = nm.startsWith('ال') ? nm : `ال${nm}`;
    packBox.hidden = !pk;
    packBox.querySelector('.pack-other').hidden = mode !== 'other';
    const one = u.name === 'قطعة' ? 'القطعة' : `ال${u.name}`;
    // خانة باركود القطعة المنفردة للصنف الجديد فقط؛ عند التعديل يبقى الباركود كما سُجّل
    pieceBox.hidden = !!editing || !pk || !packCount();
    barcodeLabel.textContent = pk && !editing ? `باركود ${the}` : 'الباركود';
    pieceTitle.textContent = `باركود ${one} المنفردة`;
    pieceSellLabel.textContent = `سعر بيع ${one} المنفردة (اختياري)`;
    const same = pk && normalizeBarcode(pieceCode.value) && normalizeBarcode(pieceCode.value) === normalizeBarcode(barcode.value);
    pieceNote.className = `field-hint ${same ? 'bad' : ''}`;
    pieceNote.textContent = same ? `هذا باركود ${the} نفسه — امسح قطعة واحدة من داخلها` : `امسح قطعة واحدة من داخل ${the}: فيعرفها التطبيق عند بيعها مفردة ولا يحسبها صنفًا جديدًا`;
    countLabel.textContent = `كم ${u.name} في ${the}؟`;
    sellLabel.textContent = pk ? `سعر بيع ${the}` : `سعر البيع${unitId !== 'piece' ? ` لكل ${u.name}` : ''}`;
    costLabel.textContent = pk ? `تكلفة ${the}` : 'سعر التكلفة';
    qtyLabel.textContent = pk ? `كم ${nm} كاملة عندك؟` : (editing ? 'الكمية الموجودة الآن' : 'الكمية الموجودة (اختياري)');
    looseField.hidden = !pk;
    if (looseField.parentElement) looseField.parentElement.classList.toggle('grid-2', pk);
    looseLabel.textContent = `و${u.id === 'piece' ? 'كم قطعة' : `كم ${u.name}`} زيادة؟`;
    paintMargin();
  }
  function convertFields(from, to) {
    const n = from !== 'piece' ? packCount() : null;
    const s = parseMoney(sell.value || '', currency), c = parseMoney(cost.value || '', currency);
    if (from !== 'piece' && to === 'piece' && n) {
      const r = packToPiece({ count: n, sell: s, cost: c || 0, qty: parseQty(qty.value || '0') || 0 });
      if (s !== null) sell.value = moneyText(r.sell, currency);
      if (c) cost.value = moneyText(r.cost, currency);
      qty.value = formatQty(r.qty + (parseQty(loose.value || '0') || 0));
      loose.value = '';
    } else if (from === 'piece' && to !== 'piece') {
      const existing = (packs || []).find((x) => x.name === (to === 'other' ? otherName.value.trim() : to));
      const f = existing ? existing.factor : null;
      if (!f) return; // عبوة جديدة: التاجر يكتب سعرها بنفسه
      if (s !== null) sell.value = moneyText(Number.isSafeInteger(existing.sell_price) ? existing.sell_price : lineAmount(s, f), currency);
      if (c) cost.value = moneyText(lineAmount(c, f), currency);
      const sp = splitByPack(parseQty(qty.value || '0') || 0, f);
      qty.value = String(sp.packs);
      loose.value = sp.rest ? formatQty(sp.rest) : '';
    }
    initialPackCost = null;
  }
  countIn.addEventListener('input', () => paintMode());
  pieceCode.addEventListener('input', () => paintMode());
  barcode.addEventListener('input', () => { if (mode !== 'piece') paintMode(); });
  pieceSell.addEventListener('input', () => paintMargin());
  otherName.addEventListener('input', () => paintMode());

  function errorEl(key) {
    return errs[key] || (errs[key] = h('span', { class: 'field-error', role: 'alert', hidden: true }));
  }
  function showErrors(map) {
    for (const [k, e] of Object.entries(errs)) { e.hidden = !map[k]; e.textContent = map[k] || ''; }
  }

  function paintMargin() {
    const s = parseMoney(sell.value || '0', currency);
    const c = parseMoney(cost.value || '0', currency);
    if (mode !== 'piece') {
      const n = packCount();
      const r0 = n && s !== null && c !== null ? packToPiece({ count: n, sell: s, cost: c, qty: parseQty(qty.value || '0') || 0 }) : null;
      const r = r0 ? { ...r0, qty: r0.qty + (parseQty(loose.value || '0') || 0) } : null;
      const own = !editing && pieceSell.value.trim() ? parseMoney(pieceSell.value, currency) : null;
      if (r && own !== null) r.sell = own;
      const u = unitOf(unitId);
      pieceHint.textContent = r ? `يعني ${u.name === 'قطعة' ? 'القطعة' : `ال${u.name}`}: بيع ${formatMoney(r.sell, currency)}${app.can('see_cost') && c ? ` — تكلفة ${formatMoney(r.cost, currency)}` : ''}${r.qty ? ` — المخزون ${formatQty(r.qty)} ${u.short}` : ''}` : 'اكتب كم قطعة فيها، والتطبيق يحسب سعر القطعة وحده';
    } else pieceHint.textContent = '';
    const m = marginBp(c, s);
    if (m === null || !app.can('see_profit')) { margin.textContent = ''; return; }
    margin.className = `field-hint margin-hint ${m < 0 ? 'bad' : 'ok'}`;
    margin.textContent = `الربح في ${mode === 'piece' ? 'القطعة' : (packName() || 'العبوة').replace(/^(?!ال)/, 'ال')} ${formatMoney(s - c, currency)} — هامش ${formatDecimal(m, 2, { trim: true })}%`;
  }
  sell.addEventListener('input', paintMargin);
  cost.addEventListener('input', paintMargin);
  qty.addEventListener('input', paintMargin);
  loose.addEventListener('input', paintMargin);

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
      class: `chip ${unitId === u.id ? 'on' : ''}`, type: 'button', onclick: () => { unitId = u.id; paintUnits(); paintPacks(); paintMode(); },
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
    let sellP = sellV, costP = costV, qtyP = qtyV, packsOut = f.units ? packs : null;
    let codeP = normalizeBarcode(barcode.value) || null;
    if (mode !== 'piece' && !Object.keys(local).length) {
      const n = packCount();
      const own = !editing && pieceSell.value.trim() ? parseMoney(pieceSell.value, currency) : null;
      if (!packName()) local.sell_price = 'اكتب اسم العبوة';
      else if (!n) local.sell_price = `اكتب كم قطعة في ${packName()} (أكثر من 1)`;
      else if (!editing && pieceSell.value.trim() && own === null) local.sell_price = 'سعر القطعة المنفردة غير صحيح';
      else {
        const looseV = parseQty(loose.value || '0');
        if (looseV === null || looseV < 0) local.qty = 'عدد القطع الزائدة غير صحيح';
        if (editing) {
          // التعديل: الباركود يبقى كما سُجّل (باركود القطعة يُضاف من «امسح باركود الحبة» أدناه)
          const r = packToPiece({ count: n, sell: sellV, cost: costV, qty: qtyV });
          sellP = r.sell; costP = r.cost; qtyP = r.qty + (looseV || 0);
          // التكلفة كما هي إن لم يغيّرها (لا فرق أغورة من التحويل ذهابًا وإيابًا)
          if (cost.value === initialPackCost) costP = editing.cost_price;
          // العبوة تُحفظ بسعرها: بيع كرتونة في شاشة البيع = 80 بالضبط، لا 24 × 3.33
          packsOut = upsertPack(packs, { name: packName(), count: n, sell: sellV, makeId: uuid });
        } else {
          // صنف جديد بعبوته: الممسوح باركود الكرتونة فيُحفظ لها (مسحها = كرتونة بـ 80 بالضبط)، وباركود القطعة
          // المنفردة للصنف نفسه — فلا تُحسب القطعة صنفًا جديدًا عند بيعها
          const r = packEntry({ packs, name: packName(), count: n, sell: sellV, cost: costV, qty: qtyV, packBarcode: barcode.value, pieceBarcode: pieceCode.value, pieceSell: own, makeId: uuid });
          if (r.error) local.barcode = r.error;
          else { sellP = r.sell; costP = r.cost; qtyP = r.qty + (looseV || 0); packsOut = r.packs; codeP = r.barcode; }
        }
      }
    }
    if (Object.keys(local).length) { showErrors(local); feedback.error(); toast(Object.values(local)[0], { kind: 'error' }); return; }
    saving = true;
    try {
      const { product, warnings } = await app.products.save({
        ...(editing ? stripDerived(editing) : {}),
        id: editing?.id || undefined,
        name: name.value, barcode: codeP,
        internal_code: !!codeP && isInternalBarcode(codeP),
        sell_price: sellP, cost_price: costP, currency, unit: unitId, category_id: catId,
        low_stock: lowV, track_expiry: !!(f.expiry && expiry.value), expiry_date: f.expiry && expiry.value ? expiry.value : null,
        is_quick: isQuick, note: note.value.trim() || null,
        ...(scaleOn || editing?.scale_code ? { scale_code: scaleCode.value.trim() || null } : {}),
      }, { qty: qtyP, packs: packsOut });
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
  const hasAdvanced = params.quick === '1' || !!(editing && (editing.scale_code || editing.category_id || editing.units.length || editing.expiry_date || editing.is_quick || editing.note || editing.unit !== 'piece' || editing.low_stock !== null));
  const adv = h('div', { class: 'adv', hidden: !hasAdvanced },
    f.multiCurrency ? currencyPicker(() => currency, (c) => { currency = c; paintMargin(); }) : null,
    f.units ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'يُباع بـ'), unitChips) : null,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'التصنيف'), catChips),
    scaleOn || editing?.scale_code ? h('div', null, field('رقم الصنف في الميزان', scaleCode, 'نفس الرقم (PLU) المبرمج في الميزان: ملصق الميزان يُقرأ بوزنه أو سعره'), errorEl('scale_code')) : null,
    field('نبّهني عندما تقل الكمية عن', low),
    f.units ? section('العبوات', packList, h('p', { class: 'muted small' }, 'المخزون يبقى بالقطعة: بيع كرتونة ينقص 24 قطعة تلقائيًا.'), errorEl('packs')) : null,
    f.expiry ? field('تاريخ انتهاء الصلاحية', expiry, 'ننبهك قبل الانتهاء بـ 30 يومًا') : null,
    f.quickItems ? h('div', { class: 'list' }, switchRow({ title: 'زر في شاشة البيع', sub: 'للأصناف بلا باركود: خبز، أكياس، فكّة…', checked: isQuick, onchange: (v) => { isQuick = v; } })) : null,
    field('ملاحظة', note));
  // الحبة والكرتونة صنف واحد: ربط باركود الحبة، أو دمج صنف مكرر (أُدخلت الكرتونة والحبة صنفين)
  const linkBox = editing && unitId === 'piece' ? h('div', { class: 'list section link-box' },
    h('button', { class: 'row row-tap', type: 'button', onclick: async () => { const code = await scanOnce('امسح باركود الحبة التي داخل الكرتونة'); if (code) linkSheet({ carton: editing, pieceBarcode: code, onDone: () => history.back() }); } },
      h('span', { class: 'row-ic' }, icon('scan', 20)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'هذا كرتونة؟ اربط باركود الحبة التي بداخلها'), h('span', { class: 'row-sub' }, 'فيُباع بالحبة وبالكرتونة من صنف واحد')), icon('chevron', 20)),
    h('button', { class: 'row row-tap', type: 'button', onclick: () => mergeFrom(editing, () => history.back()) },
      h('span', { class: 'row-ic' }, icon('copy', 20)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'مكرر؟ ادمج الحبة والكرتونة'), h('span', { class: 'row-sub' }, 'أُدخلت الكرتونة صنفًا والحبة صنفًا آخر')), icon('chevron', 20))) : null;
  const advToggle = h('button', { class: 'adv-toggle', type: 'button', onclick: () => { adv.hidden = !adv.hidden; advToggle.classList.toggle('open', !adv.hidden); } },
    icon('sliders', 20), h('span', null, 'خيارات إضافية'), h('small', null, [f.units ? 'الوحدة والعبوات' : null, 'التصنيف', f.expiry ? 'الصلاحية' : null, 'التنبيه'].filter(Boolean).join('، ')), icon('chevron', 18));
  if (hasAdvanced) advToggle.classList.add('open');

  // ---------- الرسم ----------
  el.append(
    header(editing ? 'تعديل الصنف' : 'صنف جديد', { back: true, actions: editing ? [iconButton('trash', 'حذف الصنف', remove)] : [] }),
    h('form', { class: 'page product-form', onsubmit: save },
      f.images ? section(null, imgRow) : null,
      field('اسم الصنف', name, null), errorEl('name'), catalogHint,
      h('div', { class: 'field' }, barcodeLabel,
        h('div', { class: 'input-row' }, barcode,
          iconButton('scan', 'امسح الباركود', async () => { const c = await scanOnce(); if (c) { barcode.value = c; suggestName(c); } }),
        ),
        errorEl('barcode'),
        h('button', { class: 'link-btn', type: 'button', onclick: async () => { barcode.value = await app.products.nextInternalBarcode(); } }, 'لا باركود له؟ ولّد باركودًا داخليًا'),
      ),
      h('div', { class: 'field price-for' }, h('span', { class: 'field-label' }, 'السعر الذي ستكتبه لـ'), modeChips),
      packBox,
      h('div', { class: 'grid-2' },
        h('div', null, h('label', { class: 'field' }, sellLabel, sell), errorEl('sell_price')),
        app.can('see_cost') ? h('div', null, h('label', { class: 'field' }, costLabel, cost), errorEl('cost_price')) : null,
      ),
      margin,
      h('div', { class: 'qty-pair' }, h('div', null, h('label', { class: 'field' }, qtyLabel, qty), errorEl('qty')), looseField),
      pieceHint,
      linkBox,
      advToggle,
      adv,
      h('div', { class: 'sticky-save' }, button(editing ? 'حفظ التعديل' : 'حفظ الصنف', { type: 'submit', block: true, size: 'lg', icon: 'check' })),
    ),
  );
  // صنف سعّره التاجر بالكرتونة: يُفتح كما أدخله (سعر الكرتونة، وكم كرتونة وكم قطعة)، لا بسعر القطعة 3.33 وكمية 22
  if (editing) {
    const pk0 = mainPack(p.units);
    if (pk0 && Number.isSafeInteger(pk0.sell_price) && unitId === 'piece') {
      const known = PACK_MODES.find((m) => m.id === pk0.name);
      mode = known ? known.id : 'other';
      if (!known) otherName.value = pk0.name;
      countIn.value = formatQty(pk0.factor);
      sell.value = moneyText(pk0.sell_price, currency);
      cost.value = p.cost_price ? moneyText(lineAmount(p.cost_price, pk0.factor), currency) : '';
      initialPackCost = cost.value;
      const sp = splitByPack(Math.max(0, p.qty || 0), pk0.factor);
      qty.value = String(sp.packs);
      loose.value = sp.rest ? formatQty(sp.rest) : '';
    }
  }
  paintUnits();
  paintCats();
  paintPacks();
  paintMode();
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
