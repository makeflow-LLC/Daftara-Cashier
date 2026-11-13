// سجل الفواتير: بحث برقم الفاتورة أو اسم الزبون/المورّد أو اسم صنف، وتصفية بالنوع والتاريخ. الضغط يفتح الفاتورة.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, input, money } from '../../ui/components.js';
import { filterInvoices, INVOICE_TITLES, dateTimeText } from '../../domain/invoice.js';
import { normalizeArabic } from '../../domain/product.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { startOfDay } from '../../core/queries.js';
import { showReceipt } from '../sale/receipt.js';

const TYPES = [['', 'الكل'], ['sale', 'بيع'], ['sale_return', 'مرتجع'], ['purchase', 'شراء']];
const RANGES = [['today', 'اليوم'], ['week', 'آخر 7 أيام'], ['month', 'آخر 30 يومًا'], ['all', 'كل الوقت']];
const ICON = { sale: 'receipt', sale_return: 'undo', purchase: 'truck', purchase_return: 'undo' };

export function renderInvoices(el, params) {
  let all = [];
  let lines = null;
  let names = { customerNames: new Map(), supplierNames: new Map() };
  let type = params.type || '';
  let range = params.range || 'week';
  const q = input({ type: 'search', placeholder: 'رقم الفاتورة، اسم الزبون، أو اسم صنف', autocomplete: 'off' });
  const typeChips = h('div', { class: 'chips chips-scroll' });
  const rangeChips = h('div', { class: 'chips chips-scroll' });
  const body = h('div');
  el.append(header('الفواتير', { back: true }), h('div', { class: 'page' }, h('div', { class: 'search-row' }, icon('search', 20), q), h('div', { class: 'inv-filters' }, typeChips, rangeChips), body));

  function from() {
    const d = startOfDay();
    if (range === 'week') d.setDate(d.getDate() - 6);
    if (range === 'month') d.setDate(d.getDate() - 29);
    return range === 'all' ? null : d.toISOString();
  }

  async function paint() {
    fill(typeChips, ...TYPES.map(([k, l]) => h('button', { class: `chip ${type === k ? 'on' : ''}`, type: 'button', onclick: () => { type = k; paint(); } }, l)));
    fill(rangeChips, ...RANGES.map(([k, l]) => h('button', { class: `chip ${range === k ? 'on' : ''}`, type: 'button', onclick: () => { range = k; paint(); } }, l)));
    const query = q.value.trim();
    let productHits = new Set();
    const nq = normalizeArabic(query);
    if (nq && !/^\d+$/.test(nq)) {
      if (!lines) lines = await app.db.invoice_lines.toArray();   // تُحمَّل مرة واحدة عند أول بحث باسم
      productHits = new Set(lines.filter((l) => normalizeArabic(l.name).includes(nq)).map((l) => l.invoice_id));
    }
    const items = filterInvoices(all, { query, type, from: from() }, { ...names, productHits });
    const total = items.filter((i) => i.type === 'sale').reduce((a, i) => a + i.total, 0);
    fill(body, items.length ? h('div', null,
      h('div', { class: 'list-count muted small' }, `${items.length} فاتورة`, type === 'sale' || !type ? [' — مبيعات ', money(total)] : null),
      h('div', { class: 'list' }, ...items.slice(0, 150).map((i) => {
        const party = names.customerNames.get(i.customer_id) || names.supplierNames.get(i.supplier_id);
        return h('button', { class: 'row row-tap', type: 'button', onclick: () => showReceipt(i.id, { doneLabel: 'إغلاق', doneIcon: 'x' }) },
          h('span', { class: `row-ic ${i.type === 'sale' ? '' : 'ic-debt'}` }, icon(ICON[i.type], 20)),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, INVOICE_TITLES[i.type].replace('فاتورة ', ''), ' ', num(i.number), party ? h('span', { class: 'muted' }, ` · ${party}`) : null),
            h('span', { class: 'row-sub' }, num(dateTimeText(i.created_at)), i.type === 'sale' && i.paid < i.total ? ' · آجل' : '')),
          money(i.total, i.currency));
      })),
      items.length > 150 ? h('p', { class: 'muted small' }, 'تظهر أحدث 150 فاتورة — ضيّق البحث لرؤية الأقدم.') : null)
      : emptyState('receipt', 'لا فواتير', query ? `لا فاتورة تطابق «${query}»` : 'لا فواتير في هذه المدة — جرّب «كل الوقت».'));
  }

  async function load() {
    const [inv, cs, ss] = await Promise.all([app.db.invoices.toArray(), app.db.customers.toArray(), app.db.suppliers.toArray()]);
    all = inv;
    lines = null;
    names = { customerNames: new Map(cs.map((c) => [c.id, c.name])), supplierNames: new Map(ss.map((s) => [s.id, s.name])) };
    paint();
  }
  let t = null;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(paint, 150); });
  load();
  return bus.on('data', (e) => { if (e.tables.includes('invoices')) load(); });
}
