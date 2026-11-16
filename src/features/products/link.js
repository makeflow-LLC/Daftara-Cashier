// الحبة والكرتونة صنف واحد: حين يُمسح باركود غير مسجّل نسأل «ما هذا؟» بدل إنشاء صنف مكرر:
//   صنف جديد · حبة من كرتونة مسجّلة (أدخلت الكرتونة وهذه حبتها) · كرتونة لصنف مسجّل (أدخلت الحبة وهذه كرتونتها)
// ودمج صنفين مكررين (حبة وكرتونة) من بطاقة الصنف. المنطق في domain/link.js و products/repo.js.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, input, field, money } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal, normalizeDigits } from '../../domain/money.js';
import { QTY_SCALE, mainPack, packQtyText } from '../../domain/units.js';
import { app } from '../../core/app.js';
import { pickProduct } from '../inventory/hub.js';

const cur = () => app.shop?.base_currency || 'ILS';
const mt = (v) => formatDecimal(v, CURRENCIES[cur()].minor, { trim: true, group: false });
const intOf = (el) => { const v = parseInt(normalizeDigits(el.value || ''), 10); return Number.isFinite(v) ? v : null; };

/**
 * باركود غير مسجّل: ما هو؟ onNew() صنف جديد، onDone() بعد الربط (ليُمسح من جديد فيُضاف).
 * context: 'sale' (غالبًا حبة) أو 'purchase' (غالبًا كرتونة) — يحدد ترتيب الخيارات.
 */
export function unknownBarcode(code, { context = 'sale', onNew, onDone }) {
  openSheet((close) => {
    const opt = (ic, title, sub, fn, cls = '') => h('button', { class: `row row-tap link-opt ${cls}`, type: 'button', onclick: () => { close(); fn(); } },
      h('span', { class: 'row-ic' }, icon(ic, 22)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), h('span', { class: 'row-sub' }, sub)), icon('chevron', 20));
    const piece = opt('box', 'حبة من كرتونة مسجّلة', 'أدخلت الكرتونة (مثل كرتونة النسكافيه) وهذه الحبة التي بداخلها', () => linkFlow(code, onDone));
    const box = opt('truck', 'كرتونة لصنف مسجّل', 'أدخلت الحبة، وهذه كرتونتها (24 حبة مثلًا)', () => packFlow(code, onDone));
    const fresh = opt('plus', 'صنف جديد', 'لم أُدخله من قبل بأي شكل', onNew);
    return h('div', null,
      h('p', { class: 'muted' }, 'الباركود ', h('b', { class: 'num' }, code), ' غير مسجّل. ما هو؟'),
      h('div', { class: 'list' }, ...(context === 'purchase' ? [box, piece, fresh] : [piece, box, fresh])),
      h('p', { class: 'muted small' }, 'الحبة والكرتونة صنف واحد: المخزون بالحبة، وبيع كرتونة ينقص 24 حبة وحده.'));
  }, { title: 'باركود جديد' });
}

async function linkFlow(code, onDone) {
  const carton = await pickProduct({ title: 'أي صنف هو الكرتونة؟' });
  if (carton) linkSheet({ carton, pieceBarcode: code, onDone });
}

async function packFlow(code, onDone) {
  const product = await pickProduct({ title: 'كرتونة أي صنف؟' });
  if (product) packSheet({ product, barcode: code, onDone });
}

/** الربط/الدمج: كم حبة في الكرتونة وسعر الحبة، مع معاينة ما سيصير. */
export async function linkSheet({ carton, piece = null, pieceBarcode = null, onDone = null }) {
  const full = await app.products.get(carton.id);
  const pk = mainPack(full.units);
  const count = input({ dir: 'ltr', inputmode: 'numeric', class: 'input input-xl', placeholder: '24', value: pk ? String(pk.factor / QTY_SCALE) : '' });
  const price = input({ dir: 'ltr', inputmode: 'decimal', placeholder: '0.00', value: piece ? mt(piece.sell_price) : pk ? mt(full.sell_price) : '' });
  const preview = h('div', { class: 'offer-preview link-preview' });
  const pieceStock = piece ? ((await app.db.stock.get(piece.id))?.qty ?? 0) : 0;
  function paint() {
    const n = intOf(count);
    if (!n || n < 2) { fill(preview, h('span', { class: 'muted' }, 'اكتب كم حبة في الكرتونة')); return; }
    const piecePrice = price.value.trim() ? parseMoney(price.value, cur()) : null;
    const pp = piecePrice ?? (pk ? full.sell_price : Math.round((full.sell_price || 0) / n));
    const boxPrice = pk ? pk.sell_price : full.sell_price;
    const qty = (pk ? full.qty : full.qty * n) + pieceStock;
    const pack = { name: pk ? pk.name : 'كرتونة', factor: n * QTY_SCALE };
    fill(preview,
      h('div', null, h('strong', null, `«${full.name}» صنف واحد:`)),
      h('div', null, 'الحبة ', money(pp), ` · ${pack.name} (${n} حبة) `, boxPrice != null ? money(boxPrice) : '—'),
      h('div', null, 'المخزون: ', packQtyText(qty, pack, 'piece'), qty !== (pk ? full.qty : full.qty * n) ? ' (مع مخزون الحبة المكررة)' : ''),
      piece ? h('div', { class: 'muted small' }, `«${piece.name}» المكرر يُحذف، وفواتيره القديمة تبقى كما هي.`) : null);
  }
  count.addEventListener('input', paint);
  price.addEventListener('input', paint);
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const n = intOf(count);
      if (!n || n < 2) { feedback.error(); toast('اكتب كم حبة في الكرتونة (2 أو أكثر)', { kind: 'error' }); return; }
      const piecePrice = price.value.trim() ? parseMoney(price.value, cur()) : null;
      if (price.value.trim() && (piecePrice === null || piecePrice < 0)) { feedback.error(); toast('سعر الحبة غير صحيح', { kind: 'error' }); return; }
      try {
        await app.products.linkPiece({ cartonId: full.id, pieceId: piece ? piece.id : null, pieceBarcode, count: n * QTY_SCALE, piecePrice });
        feedback.ok(); close();
        toast(`صار «${full.name}» صنفًا واحدًا: يُباع بالحبة وبالكرتونة`, { kind: 'ok', ms: 4000 });
        if (onDone) onDone();
      } catch (err) { feedback.error(); toast(err.message || 'تعذّر الربط', { kind: 'error', ms: 4500 }); }
    },
  },
    h('div', { class: 'link-pair' },
      h('div', { class: 'link-side' }, h('small', null, 'الكرتونة'), h('b', null, full.name), h('span', null, pk ? `${pk.name} ${formatMoney(pk.sell_price ?? 0, cur())}` : formatMoney(full.sell_price || 0, cur()))),
      icon('back', 20),
      h('div', { class: 'link-side' }, h('small', null, 'الحبة'), h('b', null, piece ? piece.name : 'الباركود الممسوح'), h('span', { class: 'num' }, piece ? formatMoney(piece.sell_price || 0, cur()) : pieceBarcode || ''))),
    field('كم حبة في الكرتونة؟', count),
    field('سعر بيع الحبة', price, 'اتركه فارغًا: سعر الكرتونة ÷ العدد'),
    preview,
    button('اربطهما في صنف واحد', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: piece ? 'دمج الحبة والكرتونة' : 'هذه حبة من كرتونة' });
  paint();
  setTimeout(() => { if (!count.value) count.focus(); }, 200);
}

/** كرتونة لصنف يُباع بالحبة: عدد الحبات وسعر الكرتونة (اختياري). */
export function packSheet({ product, barcode, onDone = null }) {
  const count = input({ dir: 'ltr', inputmode: 'numeric', class: 'input input-xl', placeholder: '24' });
  const price = input({ dir: 'ltr', inputmode: 'decimal', placeholder: 'اختياري' });
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const n = intOf(count);
      if (!n || n < 2) { feedback.error(); toast('اكتب كم حبة في الكرتونة (2 أو أكثر)', { kind: 'error' }); return; }
      const sp = price.value.trim() ? parseMoney(price.value, cur()) : null;
      try {
        await app.products.addPack(product.id, { barcode, count: n * QTY_SCALE, sellPrice: sp });
        feedback.ok(); close();
        toast(`سُجّلت كرتونة «${product.name}» (${n} حبة)`, { kind: 'ok', ms: 3500 });
        if (onDone) onDone();
      } catch (err) { feedback.error(); toast(err.errors ? Object.values(err.errors)[0] : err.message || 'تعذّر الحفظ', { kind: 'error', ms: 4500 }); }
    },
  }, h('p', { class: 'muted' }, `كرتونة «${product.name}» (سعر الحبة ${formatMoney(product.sell_price || 0, cur())})`),
    field('كم حبة في الكرتونة؟', count), field('سعر بيع الكرتونة', price, 'فارغ = سعر الحبة × العدد'),
    button('حفظ الكرتونة', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: 'كرتونة لصنف مسجّل' });
  setTimeout(() => count.focus(), 200);
}

/** من بطاقة الصنف: دمجه مع صنف مكرر (أحدهما حبة والآخر كرتونة). الأغلى سعرًا = الكرتونة غالبًا، ويمكن العكس. */
export async function mergeFrom(product, onDone) {
  const other = await pickProduct({ title: 'الصنف المكرر (الحبة أو الكرتونة)' });
  if (!other || other.id === product.id) return;
  let carton = (product.sell_price || 0) >= (other.sell_price || 0) ? product : other;
  let piece = carton === product ? other : product;
  openSheet((close) => {
    const box = h('div');
    const paint = () => fill(box,
      h('p', { class: 'muted' }, 'أيهما الكرتونة؟'),
      h('div', { class: 'list' }, ...[carton, piece].map((x) => h('button', { class: `row row-tap ${x === carton ? 'row-on' : ''}`, type: 'button', onclick: () => { if (x !== carton) { [carton, piece] = [piece, carton]; paint(); } } },
        h('span', { class: 'row-ic' }, icon(x === carton ? 'truck' : 'box', 20)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, x.name), h('span', { class: 'row-sub' }, formatMoney(x.sell_price || 0, cur()), x.barcode ? ` · ${x.barcode}` : '')),
        h('span', { class: `state-chip ${x === carton ? 'ok' : ''}` }, x === carton ? 'الكرتونة' : 'الحبة')))),
      button('التالي', { block: true, size: 'lg', onclick: () => { close(); linkSheet({ carton, piece, onDone }); } }));
    paint();
    return box;
  }, { title: 'دمج صنفين مكررين' });
}
