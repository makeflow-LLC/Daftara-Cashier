// العروض: «اشترِ 2 والثالث مجانًا»، «3 بـ 10 ₪»، «خصم 10% على المنظفات حتى آخر الشهر».
// تُطبَّق وحدها في شاشة البيع (domain/offers.js). تُفتح أيضًا من «المساعد» لصنف راكد: ?product=<id>
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, field, emptyState, switchRow, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { OFFER_TYPES, offerTitle, offerState, offerProblem, localDay } from '../../domain/offers.js';
import { searchProducts } from '../../domain/product.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { parseDecimal, formatDecimal, normalizeDigits } from '../../domain/money.js';
import { uuid } from '../../core/ids.js';
import { app } from '../../core/app.js';

const STATE = { active: ['فعّال الآن', 'ok'], scheduled: ['يبدأ لاحقًا', 'info'], ended: ['انتهى', 'muted'], off: ['موقوف', 'muted'] };
const cur = () => app.shop?.base_currency || 'ILS';
const offersOf = () => app.shop?.settings?.offers || [];
const saveOffers = (list) => app.updateShopSettings({ offers: list });
const dm = (iso) => (iso ? iso.slice(5).split('-').reverse().join('/') : '');

export async function renderOffers(el, params = {}) {
  const body = h('div');
  el.append(header('العروض والخصومات', { back: true }), h('div', { class: 'page' },
    h('p', { class: 'muted' }, 'العرض يُطبَّق وحده في شاشة البيع ويظهر في الفاتورة — لا يتذكر الكاشير شيئًا.'),
    button('عرض جديد', { block: true, size: 'lg', icon: 'plus', onclick: () => editOffer(null) }),
    body));

  let products = [];
  let cats = [];
  const names = (o) => ({
    product: o.target?.kind === 'product' ? products.find((p) => p.id === o.target.id)?.name : null,
    category: o.target?.kind === 'category' ? cats.find((c) => c.id === o.target.id)?.name : null,
  });

  function paint() {
    const today = localDay();
    const list = offersOf();
    if (!list.length) {
      fill(body, emptyState('tag', 'لا عروض بعد', 'جرّب «اشترِ 2 والثالث مجانًا» على صنف راكد، أو خصمًا على تصنيف لأسبوع.'));
      return;
    }
    const order = { active: 0, scheduled: 1, off: 2, ended: 3 };
    const sorted = [...list].sort((a, b) => order[offerState(a, today)] - order[offerState(b, today)]);
    const periodOf = (o) => (o.from || o.to ? `${o.from ? `من ${dm(o.from)}` : ''}${o.to ? ` حتى ${dm(o.to)}` : ''}`.trim() : 'بلا موعد انتهاء');
    if (isWide()) {
      const on = (o) => { const n = names(o); return n.product || n.category || (o.target?.kind === 'all' ? 'كل المحل' : '—'); };
      fill(body, dataTable({
        rows: sorted,
        onRow: (o) => editOffer(o),
        rowClass: (o) => (['ended', 'off'].includes(offerState(o, today)) ? 'dt-dim' : ''),
        columns: [
          { key: 'title', label: 'العرض', grow: true, by: (o) => offerTitle(o, names(o), cur()), cell: (o) => h('strong', null, offerTitle(o, names(o), cur())) },
          { key: 'type', label: 'النوع', by: (o) => o.type, cell: (o) => OFFER_TYPES[o.type]?.name || '' },
          { key: 'on', label: 'على', by: on, cell: on },
          { key: 'period', label: 'المدة', by: (o) => o.to || '9999', cell: periodOf },
          { key: 'state', label: 'الحالة', by: (o) => order[offerState(o, today)], cell: (o) => { const st = offerState(o, today); return h('span', { class: `state-chip ${STATE[st][1]}` }, STATE[st][0]); } },
        ],
      }));
      return;
    }
    fill(body, h('div', { class: 'list' }, ...sorted.map((o) => {
      const st = offerState(o, today);
      const period = o.from || o.to ? `${o.from ? `من ${dm(o.from)}` : ''}${o.to ? ` حتى ${dm(o.to)}` : ''}`.trim() : 'بلا موعد انتهاء';
      return h('button', { class: `row row-tap ${st === 'ended' || st === 'off' ? 'row-dim' : ''}`, type: 'button', onclick: () => editOffer(o) },
        h('span', { class: 'row-ic' }, icon('tag', 20)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, offerTitle(o, names(o), cur())), h('span', { class: 'row-sub' }, period)),
        h('span', { class: `state-chip ${STATE[st][1]}` }, STATE[st][0]));
    })));
  }

  function editOffer(o, preset = null) {
    const d = o ? JSON.parse(JSON.stringify(o)) : { type: 'bxgy', target: { kind: 'product', id: preset?.product || null }, buy: 2, get: 1, qty: 3, price: null, percent: 1000, from: localDay(), to: null, active: true };
    const minor = CURRENCIES[cur()].minor;
    const typeChips = h('div', { class: 'chips' });
    const targetBox = h('div');
    const valuesBox = h('div');
    const preview = h('div', { class: 'offer-preview' });
    const from = input({ type: 'date', dir: 'ltr', value: d.from || '' });
    const to = input({ type: 'date', dir: 'ltr', value: d.to || '' });
    const nInput = (v, ph) => input({ dir: 'ltr', inputmode: 'numeric', value: v != null ? String(v) : '', placeholder: ph });
    const buy = nInput(d.buy, '2'); const get = nInput(d.get, '1'); const qty = nInput(d.qty, '3');
    const price = input({ dir: 'ltr', inputmode: 'decimal', value: d.price ? formatDecimal(d.price, minor, { trim: true, group: false }) : '', placeholder: '10' });
    const percent = input({ dir: 'ltr', inputmode: 'decimal', value: d.percent ? formatDecimal(d.percent, 2, { trim: true, group: false }) : '', placeholder: '10' });
    const search = input({ type: 'search', placeholder: 'ابحث عن الصنف بالاسم' });
    const hits = h('div', { class: 'list picker-list' });

    function read() {
      const int = (el) => { const v = parseInt(normalizeDigits(el.value), 10); return Number.isFinite(v) ? v : null; };
      d.buy = int(buy); d.get = int(get); d.qty = int(qty);
      d.price = price.value.trim() ? parseMoney(price.value, cur()) : null;
      d.percent = percent.value.trim() ? parseDecimal(percent.value, 2) : null;
      d.from = from.value || null; d.to = to.value || null;
    }
    function paintPreview() {
      read();
      const bad = offerProblem(d);
      fill(preview, bad ? h('span', { class: 'muted' }, bad) : h('span', null, icon('tag', 16), ' ', offerTitle(d, names(d), cur())));
    }
    function paintType() {
      fill(typeChips, ...Object.entries(OFFER_TYPES).map(([k, t]) => h('button', {
        class: `chip ${d.type === k ? 'on' : ''}`, type: 'button',
        onclick: () => { d.type = k; if (k !== 'percent') d.target = { kind: 'product', id: d.target.kind === 'product' ? d.target.id : null }; paintAll(); },
      }, t.name)));
    }
    function paintTarget() {
      const kinds = d.type === 'percent' ? [['product', 'صنف'], ['category', 'تصنيف'], ['all', 'كل المحل']] : [['product', 'صنف']];
      const chosen = d.target.kind === 'product' && d.target.id ? products.find((p) => p.id === d.target.id) : null;
      fill(targetBox,
        kinds.length > 1 ? h('div', { class: 'chips' }, ...kinds.map(([k, l]) => h('button', { class: `chip ${d.target.kind === k ? 'on' : ''}`, type: 'button', onclick: () => { d.target = { kind: k, id: null }; paintAll(); } }, l))) : null,
        d.target.kind === 'product' ? (chosen
          ? h('div', { class: 'cust-chip' }, icon('box', 16), h('span', null, chosen.name), h('button', { class: 'link-btn', type: 'button', onclick: () => { d.target.id = null; paintAll(); } }, 'غيّر'))
          : h('div', null, h('div', { class: 'search-row' }, icon('search', 20), search), hits)) : null,
        d.target.kind === 'category' ? h('div', { class: 'chips' }, ...(cats.length ? cats.map((c) => h('button', { class: `chip ${d.target.id === c.id ? 'on' : ''}`, type: 'button', onclick: () => { d.target.id = c.id; paintAll(); } }, c.name)) : [h('span', { class: 'muted' }, 'لا تصنيفات بعد')])) : null);
      paintHits();
    }
    function paintHits() {
      const q = search.value.trim();
      fill(hits, ...(q ? searchProducts(products, q, 6) : []).map((p) => h('button', { class: 'row row-tap', type: 'button', onclick: () => { d.target.id = p.id; search.value = ''; paintAll(); } },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name)), num(formatMoney(p.sell_price, cur())))));
    }
    function paintValues() {
      fill(valuesBox,
        d.type === 'bxgy' ? h('div', { class: 'grid-2' }, field('يشتري (قطع)', buy), field('ويأخذ مجانًا', get)) : null,
        d.type === 'bundle' ? h('div', { class: 'grid-2' }, field('العدد', qty), field(`بسعر (${CURRENCIES[cur()].symbol})`, price)) : null,
        d.type === 'percent' ? field('نسبة الخصم %', percent) : null);
    }
    function paintAll() { paintType(); paintTarget(); paintValues(); paintPreview(); }
    for (const x of [buy, get, qty, price, percent, from, to]) x.addEventListener('input', paintPreview);
    search.addEventListener('input', paintHits);

    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        read();
        const rec = { id: d.id || uuid(), type: d.type, target: d.target, active: d.active !== false, from: d.from, to: d.to };
        if (d.type === 'percent') rec.percent = d.percent;
        if (d.type === 'bxgy') { rec.buy = d.buy; rec.get = d.get; }
        if (d.type === 'bundle') { rec.qty = d.qty; rec.price = d.price; }
        const bad = offerProblem(rec);
        if (bad) { feedback.error(); toast(bad, { kind: 'error' }); return; }
        await saveOffers([...offersOf().filter((x) => x.id !== rec.id), rec]);
        feedback.ok(); close(); paint();
        toast(o ? 'حُفظ العرض' : 'العرض جاهز — يُطبَّق في البيع الآن', { kind: 'ok' });
      },
    },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'نوع العرض'), typeChips),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'على'), targetBox),
      valuesBox,
      h('div', { class: 'grid-2' }, field('يبدأ', from), field('ينتهي (اختياري)', to)),
      preview,
      o ? switchRow({ title: 'العرض شغّال', checked: d.active !== false, onchange: (on) => { d.active = on; } }) : null,
      button('حفظ العرض', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
      o ? button('احذف العرض', {
        kind: 'text', block: true,
        onclick: async () => {
          await saveOffers(offersOf().filter((x) => x.id !== o.id));
          close(); paint();
          toast('حُذف العرض', { undo: async () => { await saveOffers([...offersOf(), o]); paint(); } });
        },
      }) : null,
    ), { title: o ? 'تعديل العرض' : 'عرض جديد' });
    paintAll();
  }

  [products, cats] = await Promise.all([app.products.list(), app.products.categories()]);
  paint();
  if (params.product) editOffer(null, { product: params.product });
}
