// ورقة الدفع: ضغطة واحدة على طريقة الدفع = تم الدفع. لا مبلغ مستلم ولا خيارات (المحلات تعتمد على السرعة).
// آجل: على زبون. وتقسيم الدفع بين عدة طرق إن فُعّلت ميزته.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, money, input } from '../../ui/components.js';
import { openSheet, toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { paymentSummary, validatePayment } from '../../domain/cart.js';
import { parseMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import { app } from '../../core/app.js';
import { pickCustomer } from '../customers/picker.js';

const KIND_ICON = { cash: 'cash', transfer: 'wallet', credit: 'user' };

/** يفتح ورقة الدفع. onConfirm({ payments, customer }) يحفظ البيع. */
export function openPay({ total, customer, onConfirm, onClose = null }) {
  const base = app.shop?.base_currency || 'ILS';
  let methods = [];
  let cust = customer;
  let split = false;
  let rows = [];          // للتقسيم: [{name, p}]
  let busy = false;
  const body = h('div', { class: 'pay' });

  const sheet = openSheet((close) => {
    async function confirm(payments) {
      if (busy) return;
      const err = validatePayment(total, payments, cust?.id);
      if (err) {
        if (err.startsWith('اختر الزبون')) { const c = await pickCustomer({ title: 'البيع بالآجل على…' }); if (!c) return; cust = c; return confirm(payments); }
        feedback.error(); toast(err, { kind: 'error' }); return;
      }
      busy = true;
      try { await onConfirm({ payments, customer: cust }); close(); }
      catch (e) { busy = false; feedback.error(); toast(e.message || 'تعذّر الحفظ', { kind: 'error' }); }
    }

    const pay = (m, amount) => ({ method_id: m.id, kind: m.kind, amount, fee_bp: 0, currency: base });

    function paintMain() {
      fill(body,
        h('div', { class: 'pay-total' }, h('span', null, 'المطلوب'), money(total)),
        cust ? h('div', { class: 'pay-cust' }, icon('user', 18), h('span', null, cust.name),
          h('button', { class: 'link-btn', type: 'button', onclick: () => { cust = null; paintMain(); } }, 'إزالة')) : null,
        h('div', { class: 'pay-methods' }, ...methods.map((m) => h('button', {
          class: `pay-method pay-${m.kind}`, type: 'button', onclick: () => confirm([pay(m, total)]),
        }, icon(KIND_ICON[m.kind], 26), h('span', null, m.name)))),
        app.feature('splitPayment') ? button('تقسيم الدفع على أكثر من طريقة', { kind: 'text', onclick: () => { split = true; rows = []; paintSplit(); } }) : null,
      );
    }

    function paintSplit() {
      const s = paymentSummary(total, rows.map((r) => r.p));
      const amt = input({ dir: 'ltr', inputmode: 'decimal', value: s.remaining ? formatDecimal(s.remaining, CURRENCIES[base].minor, { trim: true, group: false }) : '' });
      fill(body,
        h('div', { class: 'pay-total' }, h('span', null, 'المطلوب'), money(total)),
        rows.length ? h('div', { class: 'list' }, ...rows.map((r, i) => h('div', { class: 'row' },
          h('span', { class: 'row-ic' }, icon(KIND_ICON[r.p.kind], 20)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.name)),
          money(r.p.amount),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'حذف', onclick: () => { rows.splice(i, 1); paintSplit(); } }, icon('x', 18)),
        ))) : null,
        h('div', { class: `pay-remaining ${s.remaining ? 'bad' : 'ok'}` }, h('span', null, s.remaining ? 'المتبقي' : 'اكتمل الدفع'), money(s.remaining)),
        s.remaining ? h('div', null,
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'المبلغ ثم اختر الطريقة'), amt),
          h('div', { class: 'pay-methods pay-methods-sm' }, ...methods.map((m) => h('button', {
            class: `pay-method pay-${m.kind}`, type: 'button',
            onclick: () => {
              const v = parseMoney(amt.value, base);
              if (!v || v <= 0 || v > s.remaining) { feedback.error(); toast('المبلغ أكبر من المتبقي أو غير صحيح', { kind: 'error' }); return; }
              rows.push({ name: m.name, p: pay(m, v) });
              paintSplit();
            },
          }, icon(KIND_ICON[m.kind], 22), h('span', null, m.name)))),
        ) : button('تم الدفع', { block: true, size: 'lg', icon: 'check', onclick: () => confirm(rows.map((r) => r.p)) }),
        button('رجوع', { kind: 'text', onclick: () => { split = false; paintMain(); } }),
      );
    }

    app.sales.paymentMethods().then((m) => { methods = m; if (!split) paintMain(); });
    paintMain();
    return body;
  }, { title: 'الدفع', onClose });
  return sheet;
}
