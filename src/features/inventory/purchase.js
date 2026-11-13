// شراء بضاعة: امسح أو ابحث ← الكمية والتكلفة ← «دفعت نقدًا» أو «على الحساب». المخزون ومتوسط التكلفة يتحدّثان وحدهما.
// باركود جديد أثناء الشراء يُضاف كصنف بسطرين ويدخل الفاتورة مباشرة. المسودة تُحفظ لو أُغلق التطبيق.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, iconButton, money, emptyState, input, button, field } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { startInlineScanner } from '../../ui/scanner.js';
import { purchaseLine, purchaseTotal } from '../../domain/inventory.js';
import { searchProducts, normalizeBarcode } from '../../domain/product.js';
import { formatQty, parseQty, lineAmount, QTY_SCALE } from '../../domain/units.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import { app } from '../../core/app.js';
import { compressImage, pickImage } from '../../core/media.js';
import { uuid } from '../../core/ids.js';
import { productThumb } from '../products/thumb.js';
import { pickSupplier } from './suppliers.js';
import { showReceipt } from '../sale/receipt.js';

export async function renderPurchase(el, params) {
  const base = app.shop?.base_currency || 'ILS';
  const minor = CURRENCIES[base].minor;
  let draft = { lines: [], supplier: null };
  let products = [];
  let scanner = null;
  let photo = null;

  const scanBox = h('div', { class: 'scan-box sale-cam' }, h('span', { class: 'scan-laser' }));
  const camStatus = h('div', { class: 'cam-status' });
  const search = input({ type: 'search', placeholder: 'ابحث بالاسم أو اكتب الباركود', enterkeyhint: 'search', autocomplete: 'off' });
  const results = h('div', { class: 'search-results', hidden: true });
  const supEl = h('div');
  const listEl = h('div', { class: 'cart' });
  const totalEl = h('div', { class: 'paybar-total' });
  const saveBtn = h('button', { class: 'btn btn-primary btn-lg paybtn', type: 'button', onclick: finish }, icon('check', 22), h('span', null, 'حفظ'));
  const photoBtn = iconButton('camera', 'صورة فاتورة المورّد', takePhoto, 'pb-icon');

  el.append(h('div', { class: 'sale' },
    header('شراء بضاعة', { back: true }),
    scanBox, camStatus,
    h('div', { class: 'sale-search' }, h('div', { class: 'search-row' }, icon('search', 20), search), results),
    supEl, listEl,
    h('div', { class: 'paybar' }, totalEl, h('div', { class: 'paybar-actions' }, photoBtn, iconButton('truck', 'المورّد', chooseSupplier, 'pb-icon'), saveBtn))));

  function changed() { paint(); app.inventory.saveDraft({ lines: draft.lines, supplier: draft.supplier }); }

  function paint() {
    fill(supEl, draft.supplier ? h('div', { class: 'cust-chip' }, icon('truck', 16), h('span', null, draft.supplier.name),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'إزالة المورّد', onclick: () => { draft.supplier = null; changed(); } }, icon('x', 16))) : null);
    fill(listEl, draft.lines.length ? h('div', { class: 'list cart-list' }, ...draft.lines.map((l, i) => h('button', { class: 'row row-tap cart-line', type: 'button', onclick: () => editLine(i) },
      h('span', { class: 'cl-main' }, h('span', { class: 'row-title' }, l.name),
        h('span', { class: 'row-sub' }, num(formatQty(l.qty)), ' × ', num(formatMoney(l.unit_cost, base)))),
      h('span', { class: 'cl-total' }, money(lineAmount(l.unit_cost, l.qty), base)))))
      : emptyState('truck', 'امسح البضاعة التي وصلت', 'لكل صنف: الكمية وتكلفة الشراء. المخزون يزيد تلقائيًا.'));
    fill(totalEl, h('div', { class: 'pt-main' }, money(purchaseTotal(draft.lines), base)), h('div', { class: 'pt-sub' }, `${draft.lines.length} صنف`));
    saveBtn.disabled = !draft.lines.length;
    photoBtn.classList.toggle('on', !!photo);
  }

  function editLine(i, isNew = false) {
    const l = draft.lines[i];
    const q = input({ value: isNew ? '' : formatQty(l.qty), dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '1' });
    const c = input({ value: l.unit_cost ? formatDecimal(l.unit_cost, minor, { trim: true, group: false }) : '', dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0.00' });
    if (scanner) scanner.pause();
    openSheet((close) => h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const qty = parseQty(q.value || '1');
        const cost = parseMoney(c.value || '0', base);
        if (!qty || qty <= 0 || cost === null || cost < 0) { feedback.error(); toast('تحقق من الكمية والتكلفة', { kind: 'error' }); return; }
        draft.lines = draft.lines.map((x, j) => (j === i ? { ...x, qty, unit_cost: cost } : x));
        close(); changed();
      },
    },
      h('div', { class: 'grid-2' }, field(`الكمية (${l.unit_id ? l.unit : 'بالوحدة'})`, q), field('تكلفة الواحدة', c)),
      button('تم', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
      button('أزل من الفاتورة', { kind: 'text', onclick: () => { draft.lines = draft.lines.filter((_, j) => j !== i); close(); changed(); } }),
    ), { title: l.name, onClose: () => { if (scanner) scanner.resume(); } });
    setTimeout(() => q.focus(), 150);
  }

  function addProduct(product, pack = null) {
    const line = purchaseLine(product, { pack });
    const i = draft.lines.findIndex((l) => l.key === line.key);
    if (i >= 0) { editLine(i); return; }
    draft.lines = [...draft.lines, line];
    changed();
    editLine(draft.lines.length - 1, true);
  }

  async function onCode(raw) {
    const code = normalizeBarcode(raw);
    const hit = await app.products.findByCode(code);
    if (hit) return addProduct(hit.product, hit.pack);
    // صنف جديد وصل مع البضاعة: اسم وسعر بيع، ثم يدخل الفاتورة
    const name = input({ maxlength: 120, placeholder: 'اسم الصنف' });
    const sell = input({ dir: 'ltr', inputmode: 'decimal', placeholder: '0.00' });
    if (scanner) scanner.pause();
    let added = false;
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const price = parseMoney(sell.value || '', base);
        if (!name.value.trim() || price === null) { feedback.error(); toast('اكتب الاسم وسعر البيع', { kind: 'error' }); return; }
        try {
          const { product } = await app.products.save({ name: name.value, barcode: code, sell_price: price, cost_price: 0 });
          products = await app.products.list();
          added = true; close(); addProduct(product);
        } catch (err) { feedback.error(); toast(err.errors ? Object.values(err.errors)[0] : 'تعذّر الحفظ', { kind: 'error' }); }
      },
    }, h('div', { class: 'rapid-code' }, icon('scan', 18), num(code)), field('اسم الصنف الجديد', name), field('سعر البيع', sell),
      button('أضف للفاتورة', { type: 'submit', block: true, size: 'lg', icon: 'plus' })), { title: 'صنف جديد', onClose: () => { if (!added && scanner) scanner.resume(); } });
    setTimeout(() => name.focus(), 150);
    app.catalogLookup(code).then((n) => { if (n && !name.value.trim()) name.value = n; });
  }

  function paintResults() {
    const q = search.value.trim();
    if (!q) { results.hidden = true; return; }
    const hits = searchProducts(products, q, 8);
    results.hidden = false;
    fill(results, hits.length ? hits.map((p) => h('button', { class: 'row row-tap', type: 'button', onclick: () => { search.value = ''; results.hidden = true; addProduct(p); } },
      productThumb(p, 36), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name)), h('span', { class: 'muted small' }, 'مخزون ', num(formatQty(p.qty)))))
      : h('div', { class: 'row muted' }, 'لا نتائج — امسح الباركود لإضافته كصنف جديد'));
  }
  search.addEventListener('input', paintResults);
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = search.value.trim();
    if (/^\d{4,}$/.test(normalizeBarcode(q))) { search.value = ''; results.hidden = true; onCode(q); }
  });
  search.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 200));

  async function chooseSupplier() {
    const s = await pickSupplier();
    if (s) { draft.supplier = { id: s.id, name: s.name }; changed(); }
  }

  async function takePhoto() {
    if (scanner) await scanner.stop();
    scanner = null; scanBox.hidden = true;
    const file = await pickImage({ camera: true });
    if (file) { try { photo = await compressImage(file); toast('أُرفقت صورة الفاتورة', { kind: 'ok' }); } catch { toast('تعذّرت قراءة الصورة', { kind: 'error' }); } }
    paint();
    startCam();
  }

  function finish() {
    if (!draft.lines.length) return;
    const total = purchaseTotal(draft.lines);
    if (scanner) scanner.pause();
    let busy = false;
    openSheet((close) => {
      async function save(paid) {
        if (busy) return;
        if (paid === 'credit' && !draft.supplier) { const s = await pickSupplier({ title: 'على حساب أي مورّد؟' }); if (!s) return; draft.supplier = { id: s.id, name: s.name }; }
        busy = true;
        try {
          let attachmentPath = null;
          if (photo) {
            const id = uuid();
            attachmentPath = `${app.ctx.shopId}/purchases/${id}.webp`;
            await app.db.files.put({ id, kind: 'purchase', path: attachmentPath, blob: photo.blob, thumb: photo.thumb, state: 'pending' });
          }
          const r = await app.inventory.savePurchase({ lines: draft.lines, supplierId: draft.supplier ? draft.supplier.id : null, paid, attachmentPath });
          draft = { lines: [], supplier: null }; photo = null;
          feedback.ok(); close(); paint();
          showReceipt(r.invoice.id, { doneLabel: 'تم', doneIcon: 'check', onClose: () => history.back() });
        } catch (e) { busy = false; feedback.error(); toast(e.message || 'تعذّر الحفظ', { kind: 'error' }); }
      }
      return h('div', null,
        h('div', { class: 'pay-total' }, h('span', null, 'إجمالي الشراء'), money(total, base)),
        draft.supplier ? h('div', { class: 'pay-cust' }, icon('truck', 18), h('span', null, draft.supplier.name)) : null,
        h('div', { class: 'pay-methods' },
          h('button', { class: 'pay-method pay-cash', type: 'button', onclick: () => save('cash') }, icon('cash', 26), h('span', null, 'دفعت نقدًا')),
          h('button', { class: 'pay-method pay-credit', type: 'button', onclick: () => save('credit') }, icon('truck', 26), h('span', null, 'على الحساب'))));
    }, { title: 'كيف دفعت؟', onClose: () => { if (scanner) scanner.resume(); } });
  }

  async function startCam() {
    scanBox.hidden = false;
    scanner = await startInlineScanner({ box: scanBox, onCode, onStatus: (m) => { camStatus.textContent = m; } });
    if (!scanner) scanBox.hidden = true;
  }

  const saved = await app.inventory.loadDraft();
  if (saved && saved.lines.length) draft = { lines: saved.lines, supplier: saved.supplier || null };
  if (params.supplier) { const s = await app.inventory.supplier(params.supplier); if (s) draft.supplier = { id: s.id, name: s.name }; }
  products = await app.products.list();
  paint();
  startCam();
  return () => { if (scanner) scanner.stop(); };
}
