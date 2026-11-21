// ورقة الدفع: ضغطة واحدة على طريقة الدفع = تم الدفع. لا مبلغ مستلم ولا خيارات (المحلات تعتمد على السرعة).
// آجل: على زبون. وتقسيم الدفع بين عدة طرق إن فُعّلت ميزته.
import { h, fill } from '../../ui/dom.js';
import { kbd } from '../../ui/shortcuts.js';
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
/**
 * credit: رصيد مرتجع للتبديل (رُدّ للزبون في فاتورة المرتجع) — يدفع الزبون الفرق فقط، أو يُرد له الباقي.
 * في السجلات: المرتجع أخرج المبلغ نقدًا من الدرج، والبيع الجديد يُدخله نقدًا، فالصافي = الفرق الفعلي.
 */
export function openPay({ total, customer, credit = 0, onConfirm, onClose = null }) {
  const base = app.shop?.base_currency || 'ILS';
  let methods = [];
  let cust = customer;
  let split = false;
  let rows = [];          // للتقسيم: [{name, p}]
  let busy = false;
  let offDigit = () => {};
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
    const due = Math.max(0, total - credit);       // ما يدفعه الزبون فعلًا
    const back = Math.max(0, credit - total);      // ما يُرد له إن أخذ بأقل من المرتجع
    // مع رصيد المرتجع: الجزء المقابل له نقدًا (يعادل ما أخرجه المرتجع من الدرج)، والفرق بالطريقة المختارة
    function build(m) {
      const cashM = methods.find((x) => x.kind === 'cash') || m;
      if (!credit || m === cashM) return [pay(m, total)];
      return due > 0 ? [pay(cashM, Math.min(credit, total)), pay(m, due)] : [pay(cashM, total)];
    }

    function paintMain() {
      fill(body,
        h('div', { class: 'pay-total' }, h('span', null, credit ? 'ثمن البضاعة الجديدة' : 'المطلوب'), money(total)),
        credit ? h('div', { class: 'rc-kv' }, h('span', null, 'رصيد المرتجع'), money(-credit)) : null,
        credit ? h('div', { class: `pay-change ${back ? 'bad' : 'ok'}` }, h('span', null, back ? 'رُدّ للزبون الفرق' : due ? 'يدفع الزبون الفرق' : 'متساويان — لا فرق'), money(back || due)) : null,
        cust ? h('div', { class: 'pay-cust' }, icon('user', 18), h('span', null, cust.name),
          h('button', { class: 'link-btn', type: 'button', onclick: () => { cust = null; paintMain(); } }, 'إزالة')) : null,
        credit && !due
          ? button('تم التبديل', { block: true, size: 'lg', icon: 'check', onclick: () => { const m = methods.find((x) => x.kind === 'cash') || methods[0]; if (m) confirm(build(m)); } })
          : h('div', { class: 'pay-methods' }, ...methods.map((m, i) => h('button', {
            class: `pay-method pay-${m.kind}`, type: 'button', onclick: () => confirm(build(m)),
          }, i < 9 ? kbd(String(i + 1)) : null, icon(KIND_ICON[m.kind], 26), h('span', null, m.name)))),
        app.feature('splitPayment') && !credit ? button('تقسيم الدفع على أكثر من طريقة', { kind: 'text', onclick: () => { split = true; rows = []; paintSplit(); } }) : null,
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

    // البيع بالآجل لمن يملك صلاحيته فقط
    app.sales.paymentMethods().then((m) => { methods = m.filter((x) => x.kind !== 'credit' || app.can('credit')); if (!split) paintMain(); });
    paintMain();
    // الحاسوب: رقم طريقة الدفع على لوحة المفاتيح (1 = الأولى…) والمؤشر ليس في حقل
    const onDigit = (e) => {
      if (split || e.ctrlKey || e.altKey || e.metaKey || !/^[1-9]$/.test(e.key)) return;
      const t = document.activeElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (document.querySelectorAll('.sheet').length > 1) return; // فوقها نافذة أخرى (اختيار الزبون)
      const btn = body.querySelectorAll('.pay-methods .pay-method')[Number(e.key) - 1];
      if (btn) { e.preventDefault(); btn.click(); }
    };
    document.addEventListener('keydown', onDigit);
    offDigit = () => document.removeEventListener('keydown', onDigit);
    return body;
  }, { title: 'الدفع', onClose: () => { offDigit(); if (onClose) onClose(); } });
  return sheet;
}
