// المرتجع: من فاتورة بيع (بحث برقمها)، اختر الأصناف والكميات ← المخزون يعود، والمبلغ يُرد نقدًا
// أو يُخصم من دين الزبون. لا يمكن إرجاع أكثر مما بيع (حتى مع مرتجعات سابقة).
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, money, emptyState, input, button, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { formatQty, unit as unitOf, QTY_SCALE } from '../../domain/units.js';
import { matchesInvoiceNumber } from '../../domain/numbering.js';
import { netLineTotals } from '../../domain/cart.js';
import { divRound } from '../../domain/money.js';
import { app } from '../../core/app.js';
import { showReceipt } from './receipt.js';
import { navigate } from '../../core/router.js';

export function renderReturns(el) {
  const q = input({ type: 'search', placeholder: 'رقم الفاتورة، مثل 42', inputmode: 'search', autocomplete: 'off' });
  const list = h('div');
  let sales = [];
  let customers = new Map();

  async function load() {
    sales = await app.sales.recentSales(200);
    customers = new Map((await app.customers.list()).map((c) => [c.id, c]));
    paint();
  }
  function paint() {
    const v = q.value.trim();
    const items = (v ? sales.filter((s) => matchesInvoiceNumber(s.number, v)) : sales).slice(0, 60);
    fill(list, items.length ? isWide() ? dataTable({
      rows: items,
      onRow: (s) => openInvoice(s.id),
      columns: [
        { key: 'number', label: 'رقم الفاتورة', by: (s) => s.created_at, cell: (s) => h('strong', null, num(s.number)) },
        { key: 'date', label: 'التاريخ', by: (s) => s.created_at, cell: (s) => num(new Date(s.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })) },
        { key: 'cust', label: 'الزبون', grow: true, by: (s) => customers.get(s.customer_id)?.name || '', cell: (s) => customers.get(s.customer_id)?.name || h('span', { class: 'muted' }, '—') },
        { key: 'total', label: 'الإجمالي', num: true, by: (s) => s.total, cell: (s) => money(s.total, s.currency) },
      ],
    }) : h('div', { class: 'list' }, ...items.map((s) => h('button', { class: 'row row-tap', type: 'button', onclick: () => openInvoice(s.id) },
      h('span', { class: 'row-ic' }, icon('receipt', 20)),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title num' }, s.number),
        h('span', { class: 'row-sub' }, num(new Date(s.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })),
          s.customer_id && customers.get(s.customer_id) ? ` — ${customers.get(s.customer_id).name}` : '')),
      money(s.total, s.currency))))
      : emptyState('receipt', v ? 'لا فاتورة بهذا الرقم' : 'لا مبيعات بعد', 'المرتجع يكون من فاتورة بيع سابقة.'));
  }
  q.addEventListener('input', paint);

  async function openInvoice(id) {
    const { invoice, lines, rows } = await app.sales.returnable(id);
    const nets = netLineTotals(invoice, lines);
    const picks = new Map(rows.map((r) => [r.line.id, 0]));
    const totalEl = h('div', { class: 'ret-total' });
    const body = h('div');
    let refund = 'cash';
    const refundChips = h('div', { class: 'chips' });
    function amount() {
      let t = 0;
      rows.forEach((r) => { const qn = picks.get(r.line.id); const i = lines.indexOf(r.line); if (qn) t += qn === r.line.qty ? nets[i] : divRound(nets[i] * qn, r.line.qty); });
      return t;
    }
    function paintRows() {
      fill(body, h('div', { class: 'list' }, ...rows.map((r) => {
        const qn = picks.get(r.line.id);
        const measured = unitOf(r.line.unit).measured && r.line.unit_factor === QTY_SCALE;
        const stepSize = measured ? r.returnable : QTY_SCALE;
        return h('div', { class: `row ${r.returnable ? '' : 'row-muted'}` },
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.line.name),
            h('span', { class: 'row-sub' }, 'بيع ', num(formatQty(r.sold)), r.returned ? [' — رُجع ', num(formatQty(r.returned))] : null)),
          r.returnable ? h('div', { class: 'stepper' },
            h('button', { type: 'button', 'aria-label': 'إنقاص', onclick: () => { picks.set(r.line.id, Math.max(0, qn - stepSize)); paintRows(); } }, icon('minus', 18)),
            h('span', { class: 'stepper-val num' }, formatQty(qn)),
            h('button', { type: 'button', 'aria-label': 'زيادة', onclick: () => { picks.set(r.line.id, Math.min(r.returnable, qn + stepSize)); paintRows(); } }, icon('plus', 18)))
            : h('span', { class: 'muted small' }, 'رُجع كله'));
      })));
      fill(totalEl, h('span', null, 'يُرد'), money(amount(), invoice.currency));
    }
    function paintRefund() {
      fill(refundChips,
        h('button', { class: `chip ${refund === 'cash' ? 'on' : ''}`, type: 'button', onclick: () => { refund = 'cash'; paintRefund(); } }, icon('cash', 16), 'نقدًا'),
        invoice.customer_id ? h('button', { class: `chip ${refund === 'credit' ? 'on' : ''}`, type: 'button', onclick: () => { refund = 'credit'; paintRefund(); } }, icon('user', 16), 'خصم من دين الزبون') : null);
    }
    paintRows();
    paintRefund();
    let busy = false;
    // exchange: بعد تسجيل المرتجع تُفتح شاشة البيع وللزبون رصيده، فيدفع الفرق فقط (أو يُرد له الباقي)
    async function save(close, exchange) {
      if (busy) return;
      const chosen = rows.filter((r) => picks.get(r.line.id) > 0).map((r) => ({ line: r.line, qty: picks.get(r.line.id) }));
      if (!chosen.length) { feedback.error(); toast('اختر صنفًا واحدًا على الأقل', { kind: 'error' }); return; }
      busy = true;
      try {
        const r = await app.sales.processReturn(invoice.id, chosen, refund);
        feedback.ok();
        close();
        if (exchange) {
          toast(`سُجّل المرتجع ${r.invoice.number} — اختر البضاعة البديلة`, { kind: 'ok', ms: 4000 });
          const cust = invoice.customer_id ? `&customer=${invoice.customer_id}` : '';
          // خُصم من دينه: لا رصيد نقدي، يبدأ بيعًا جديدًا للزبون نفسه
          navigate(refund === 'cash' ? `/sale?exchange=${r.total}&ref=${encodeURIComponent(r.invoice.number)}${cust}` : `/sale?${cust.slice(1)}`);
          return;
        }
        toast(`سُجّل المرتجع ${r.invoice.number}${refund === 'cash' ? ' — رُد للزبون نقدًا' : ' — خُصم من دينه'}`, { kind: 'ok', ms: 4000 });
        load();
        showReceipt(r.invoice.id, { doneLabel: 'تم', doneIcon: 'check' });
      } catch (e) { busy = false; feedback.error(); toast(e.message, { kind: 'error' }); }
    }
    openSheet((close) => h('div', null,
      h('p', { class: 'muted' }, 'اختر ما يرجعه الزبون:'),
      body, refundChips, totalEl,
      button('سجّل المرتجع', { block: true, size: 'lg', icon: 'check', onclick: () => save(close, false) }),
      button('بدّل ببضاعة أخرى', { kind: 'outline', block: true, icon: 'swap', onclick: () => save(close, true) }),
      h('p', { class: 'muted small' }, 'التبديل: يُسجَّل المرتجع ثم تفتح شاشة البيع، ويدفع الزبون فرق السعر فقط.'),
    ), { title: `مرتجع من ${invoice.number}` });
  }

  el.append(header('مرتجع وتبديل', { back: true }), h('div', { class: 'page' }, h('div', { class: 'search-row' }, icon('search', 20), q), list));
  load();
}
