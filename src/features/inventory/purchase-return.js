// مرتجع المشتريات: بضاعة تعيدها للتاجر من فاتورة شراء سابقة. اختر الأصناف والكميات ←
// البضاعة تخرج من المخزون، وثمنها ينزل مما عليك للتاجر (الافتراضي حين عليك له) أو يردّه لك نقدًا فيدخل الدرج.
// لا يُعاد أكثر مما اشتُري ولا أكثر من الموجود (ما بِيع لا يُعاد).
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, money, emptyState, input, button, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { formatQty, packToBase, unit as unitOf, QTY_SCALE } from '../../domain/units.js';
import { matchesInvoiceNumber } from '../../domain/numbering.js';
import { normalizeArabic } from '../../domain/product.js';
import { divRound, cappedReturn } from '../../domain/money.js';
import { purchaseReturnTax, purchaseBase } from '../../domain/inventory.js';
import { formatMoney } from '../../domain/currency.js';
import { app } from '../../core/app.js';
import { showReceipt } from '../sale/receipt.js';

const when = (iso, year = false) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', ...(year ? { year: '2-digit' } : {}), hour: '2-digit', minute: '2-digit' });

/** ورقة المرتجع لفاتورة شراء. onDone(result) بعد الحفظ. */
export async function purchaseReturnSheet(invoiceId, onDone = null) {
  let data;
  try { data = await app.inventory.purchaseReturnable(invoiceId); } catch (e) { toast(e.message || 'الفاتورة غير موجودة', { kind: 'error' }); return; }
  const { invoice, lines, rows, stock, supplier, prior } = data;
  const cur = invoice.currency || 'ILS';
  const picks = new Map(rows.map((r) => [r.line.id, 0]));
  // الموجود من كل صنف بوحدة سطره: لا يُعاد ما بِيع
  const left = new Map(stock);
  const maxOf = (r) => {
    const have = Math.floor(((left.get(r.line.product_id) || 0) * QTY_SCALE) / r.line.unit_factor);
    const measured = unitOf(r.line.unit).measured && r.line.unit_factor === QTY_SCALE;
    return Math.min(r.returnable, measured ? have : Math.floor(have / QTY_SCALE) * QTY_SCALE);
  };
  const owed = supplier ? (await app.inventory.supplier(supplier.id))?.balance || 0 : 0;
  // عليك له ← المرتجع ينزل من دينك؛ دفعت نقدًا ولا شيء عليك ← يردّ ثمنها نقدًا
  let refund = supplier && owed > 0 ? 'credit' : 'cash';
  const body = h('div');
  const totalEl = h('div', { class: 'ret-total' });
  const chips = h('div', { class: 'chips' });
  const note = h('p', { class: 'ret-note' });
  // ما يردّه التاجر: ثمن البضاعة وضريبتها (نفس حساب الحفظ)
  const amount = () => { const raw = rows.reduce((t, r) => { const q = picks.get(r.line.id); return t + (q ? (q === r.line.qty ? r.line.total : divRound(r.line.total * q, r.line.qty)) : 0); }, 0); if (!raw) return 0; const net = cappedReturn(raw, purchaseBase(invoice, lines), prior.net, rows.every((r) => picks.get(r.line.id) === r.returnable)); return net + purchaseReturnTax(invoice, lines, net, prior); };

  function paintRows() {
    fill(body, h('div', { class: 'list' }, ...rows.map((r) => {
      const q = picks.get(r.line.id);
      const max = maxOf(r);
      const measured = unitOf(r.line.unit).measured && r.line.unit_factor === QTY_SCALE;
      const step = measured ? max : QTY_SCALE;
      const have = packToBase(max, r.line.unit_factor) < packToBase(r.returnable, r.line.unit_factor);
      return h('div', { class: `row ${max ? '' : 'row-muted'}` },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.line.name),
          h('span', { class: 'row-sub' }, 'اشتريت ', num(formatQty(r.bought)), r.returned ? [' — أعدت ', num(formatQty(r.returned))] : null, have && r.returnable ? [' — الموجود ', num(formatQty(max))] : null)),
        max ? h('div', { class: 'stepper' },
          h('button', { type: 'button', 'aria-label': 'إنقاص', onclick: () => { picks.set(r.line.id, Math.max(0, q - step)); paintRows(); } }, icon('minus', 18)),
          h('span', { class: 'stepper-val num' }, formatQty(q)),
          h('button', { type: 'button', 'aria-label': 'زيادة', onclick: () => { picks.set(r.line.id, Math.min(max, q + step)); paintRows(); } }, icon('plus', 18)))
          : h('span', { class: 'muted small' }, r.returnable ? 'لم يبقَ منه هنا' : 'أُعيد كله'));
    })));
    fill(totalEl, h('span', null, 'قيمة المرتجع'), money(amount(), cur));
    paintNote();
  }
  function paintNote() {
    const v = amount();
    const who = supplier ? supplier.name : 'التاجر';
    note.className = `ret-note ${refund === 'credit' ? 'ret-note-credit' : ''}`;
    fill(note, icon(refund === 'credit' ? 'truck' : 'cash', 18), h('span', null, refund === 'credit'
      ? `ينزل مما عليك لـ ${who}${v ? ` ${formatMoney(v, cur)}` : ''} — لا يدخل نقد إلى الصندوق.`
      : `يردّ لك ${who} ثمنها نقدًا${v ? ` ${formatMoney(v, cur)}` : ''} ويدخل الدرج${supplier ? ' — ما عليك له لا يتغير' : ''}.`));
  }
  function paintRefund() {
    const chip = (key, ic, label) => h('button', { class: `chip ${refund === key ? 'on' : ''}`, type: 'button', onclick: () => { refund = key; paintRefund(); } }, icon(ic, 16), label);
    fill(chips, ...(!supplier ? [] : refund === 'credit' || owed > 0
      ? [chip('credit', 'truck', 'اخصمها مما عليّ له'), chip('cash', 'cash', 'ردّ لي ثمنها نقدًا')]
      : [chip('cash', 'cash', 'ردّ لي ثمنها نقدًا'), chip('credit', 'truck', 'اخصمها من حسابي عنده')]));
    paintNote();
  }
  paintRows();
  paintRefund();
  let busy = false;
  openSheet((close) => h('div', null,
    h('p', { class: 'muted' }, 'اختر ما تعيده للتاجر:'),
    body, totalEl, chips, note,
    button('سجّل المرتجع', { block: true, size: 'lg', icon: 'check', onclick: async () => {
      if (busy) return;
      const chosen = rows.filter((r) => picks.get(r.line.id) > 0).map((r) => ({ line: r.line, qty: picks.get(r.line.id) }));
      if (!chosen.length) { feedback.error(); toast('اختر صنفًا واحدًا على الأقل', { kind: 'error' }); return; }
      busy = true;
      try {
        const r = await app.inventory.returnPurchase(invoice.id, chosen, refund);
        feedback.ok(); close();
        toast(`سُجّل المرتجع ${r.invoice.number}${r.credit ? ` — نزل مما عليك ${formatMoney(r.credit, cur)}` : ` — دخل الدرج ${formatMoney(r.cash, cur)}`}`, { kind: 'ok', ms: 4500 });
        if (onDone) onDone(r);
        showReceipt(r.invoice.id, { doneLabel: 'تم', doneIcon: 'check' });
      } catch (e) { busy = false; feedback.error(); toast(e.errors?.qty || e.message || 'تعذّر الحفظ', { kind: 'error', ms: 4000 }); }
    } }),
  ), { title: `مرتجع من ${invoice.number}${supplier ? ` — ${supplier.name}` : ''}` });
}

/** صفحة مرتجع المشتريات: فواتير الشراء، بحث برقمها أو باسم التاجر، والضغط يفتح ورقة المرتجع. */
export function renderPurchaseReturn(el, params) {
  const q = input({ type: 'search', placeholder: 'رقم فاتورة الشراء أو اسم التاجر', autocomplete: 'off' });
  const list = h('div');
  let all = [];
  let names = new Map();

  function paint() {
    const v = q.value.trim();
    const nq = normalizeArabic(v);
    const nameOf = (i) => names.get(i.supplier_id) || '';
    const items = (v ? all.filter((i) => matchesInvoiceNumber(i.number, v) || (nq && !/^\d+$/.test(nq) && normalizeArabic(nameOf(i)).includes(nq))) : all).slice(0, 60);
    const open = (i) => purchaseReturnSheet(i.id, load);
    fill(list, items.length ? isWide() ? dataTable({
      rows: items, onRow: open,
      columns: [
        { key: 'number', label: 'رقم الفاتورة', by: (i) => i.created_at, cell: (i) => h('strong', null, num(i.number)) },
        { key: 'date', label: 'التاريخ', by: (i) => i.created_at, cell: (i) => num(when(i.created_at, true)) },
        { key: 'supplier', label: 'التاجر', grow: true, by: nameOf, cell: (i) => nameOf(i) || h('span', { class: 'muted' }, '—') },
        { key: 'pay', label: 'الدفع', by: (i) => (i.paid < i.total ? 1 : 0), cell: (i) => (i.paid < i.total ? h('span', { class: 'dt-tag warn' }, 'على الحساب') : 'مدفوعة') },
        { key: 'total', label: 'الإجمالي', num: true, by: (i) => i.total, cell: (i) => money(i.total, i.currency) },
      ],
    }) : h('div', { class: 'list' }, ...items.map((i) => h('button', { class: 'row row-tap', type: 'button', onclick: () => open(i) },
      h('span', { class: 'row-ic' }, icon('truck', 20)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title num' }, i.number),
        h('span', { class: 'row-sub' }, num(when(i.created_at)), nameOf(i) ? ` — ${nameOf(i)}` : '', i.paid < i.total ? ' · على الحساب' : '')),
      money(i.total, i.currency))))
      : emptyState('truck', v ? 'لا فاتورة شراء بهذا الرقم أو الاسم' : 'لا مشتريات بعد', 'المرتجع يكون من فاتورة شراء سابقة.'));
  }
  async function load() {
    all = await app.inventory.recentPurchases(200);
    names = new Map((await app.inventory.suppliers()).map((s) => [s.id, s.name]));
    paint();
  }
  q.addEventListener('input', paint);
  el.append(header('مرتجع للتاجر', { back: true }), h('div', { class: 'page' },
    h('p', { class: 'muted' }, 'بضاعة تالفة أو زائدة تعيدها للتاجر؟ اختر فاتورة الشراء ثم ما تعيده.'),
    h('div', { class: 'search-row' }, icon('search', 20), q), list));
  load().then(() => { if (params && params.id) purchaseReturnSheet(params.id, load); });
}
