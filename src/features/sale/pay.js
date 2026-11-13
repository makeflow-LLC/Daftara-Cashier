// ورقة الدفع: ضغطة على طريقة الدفع تكفي للحالة العادية. نقدًا: المبلغ المستلم والباقي (وبالدولار/الدينار
// إن فُعّلت العملات). تحويل: بالرسوم المحددة لطريقته. آجل: على زبون. وتقسيم الدفع بين عدة طرق إن فُعّل.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, money, input } from '../../ui/components.js';
import { openSheet, toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { paymentSummary, validatePayment } from '../../domain/cart.js';
import { parseMoney, formatMoney, convertToBase, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal, percentOf } from '../../domain/money.js';
import { app } from '../../core/app.js';
import { pickCustomer } from '../customers/picker.js';

const KIND_ICON = { cash: 'cash', transfer: 'wallet', credit: 'user' };

/** أوراق نقدية مقترحة للمبلغ المستلم: المبلغ نفسه ثم أقرب الفئات الأكبر. */
export function cashSuggestions(total) {
  const out = [total];
  for (const note of [1000, 2000, 5000, 10000, 20000, 50000]) {
    const v = Math.ceil(total / note) * note;
    if (v > total && !out.includes(v)) out.push(v);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * يفتح ورقة الدفع. ctx: { total, customer, setCustomer }.
 * يرجع وعدًا بـ { payments, customer } عند التأكيد، أو null إن أُغلقت.
 */
export function openPay({ total, customer, onConfirm, onClose = null }) {
  const base = app.shop?.base_currency || 'ILS';
  const rates = app.shop?.settings?.rates || {};
  let methods = [];
  let cust = customer;
  let split = false;
  let rows = [];          // للتقسيم: [{method, amount}]
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

    function full(m) {
      return { method_id: m.id, kind: m.kind, amount: total, fee_bp: m.fee_bp || 0, currency: base };
    }

    function paintMain() {
      fill(body,
        h('div', { class: 'pay-total' }, h('span', null, 'المطلوب'), money(total)),
        cust ? h('div', { class: 'pay-cust' }, icon('user', 18), h('span', null, cust.name),
          h('button', { class: 'link-btn', type: 'button', onclick: () => { cust = null; paintMain(); } }, 'إزالة')) : null,
        h('div', { class: 'pay-methods' }, ...methods.map((m) => h('button', {
          class: `pay-method pay-${m.kind}`, type: 'button',
          onclick: () => (m.kind === 'cash' ? paintCash(m) : confirm([full(m)])),
        }, icon(KIND_ICON[m.kind], 26), h('span', null, m.name),
          m.kind === 'transfer' && m.fee_bp ? h('small', null, `رسوم ${formatDecimal(m.fee_bp, 2, { trim: true })}%`) : null))),
        app.feature('splitPayment') ? button('تقسيم الدفع على أكثر من طريقة', { kind: 'outline', icon: 'sliders', block: true, onclick: () => { split = true; rows = []; paintSplit(); } }) : null,
      );
    }

    function paintCash(m) {
      let cur = base;
      const recv = input({ dir: 'ltr', inputmode: 'decimal', placeholder: formatDecimal(total, CURRENCIES[base].minor, { group: false }), class: 'input input-xl' });
      const changeEl = h('div', { class: 'pay-change' });
      const curChips = h('div', { class: 'chips' });
      const quick = h('div', { class: 'chips pay-quick' });
      function receivedBase() {
        const v = recv.value.trim() ? parseMoney(recv.value, cur) : null;
        if (v === null) return recv.value.trim() ? null : total;
        return cur === base ? v : convertToBase(v, cur, rates[cur], base);
      }
      function paintChange() {
        const r = receivedBase();
        if (r === null) { changeEl.textContent = 'المبلغ غير صحيح'; changeEl.className = 'pay-change bad'; return; }
        const d = r - total;
        changeEl.className = `pay-change ${d < 0 ? 'bad' : 'ok'}`;
        fill(changeEl, h('span', null, d < 0 ? 'ناقص' : 'الباقي للزبون'), money(Math.abs(d)));
      }
      function paintQuick() {
        const suggestions = cur === base ? cashSuggestions(total) : [];
        fill(quick, ...suggestions.map((v) => h('button', { class: 'chip', type: 'button', onclick: () => { recv.value = formatDecimal(v, CURRENCIES[base].minor, { trim: true, group: false }); paintChange(); } }, num(formatMoney(v, base)))));
      }
      const extra = Object.keys(rates).filter((c) => rates[c] && c !== base);
      if (app.feature('multiCurrency') && extra.length) {
        const paintCur = () => fill(curChips, ...[base, ...extra].map((c) => h('button', { class: `chip ${cur === c ? 'on' : ''}`, type: 'button', onclick: () => { cur = c; recv.value = ''; paintCur(); paintQuick(); paintChange(); } }, `${CURRENCIES[c].name} ${CURRENCIES[c].symbol}`)));
        paintCur();
      }
      recv.addEventListener('input', paintChange);
      fill(body,
        h('div', { class: 'pay-total' }, h('span', null, 'المطلوب'), money(total)),
        curChips,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'المبلغ المستلم'), recv),
        quick,
        changeEl,
        h('form', {
          onsubmit: (e) => {
            e.preventDefault();
            const r = receivedBase();
            if (r === null || r < total) { feedback.error(); toast(r === null ? 'المبلغ غير صحيح' : 'المبلغ المستلم أقل من المطلوب', { kind: 'error' }); return; }
            const p = { method_id: m.id, kind: 'cash', amount: r, fee_bp: 0, currency: cur };
            if (cur !== base) { p.amount_currency = parseMoney(recv.value, cur); p.rate = rates[cur]; }
            confirm([p]);
          },
        }, button('تم الدفع', { type: 'submit', block: true, size: 'lg', icon: 'check' })),
        button('رجوع', { kind: 'text', onclick: paintMain }),
      );
      paintQuick();
      paintChange();
      setTimeout(() => recv.focus(), 100);
    }

    function paintSplit() {
      const s = paymentSummary(total, rows.map((r) => ({ ...r.p })));
      const list = h('div', { class: 'list' }, ...rows.map((r, i) => h('div', { class: 'row' },
        h('span', { class: 'row-ic' }, icon(KIND_ICON[r.p.kind], 20)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.name),
          r.p.kind === 'transfer' && r.p.fee_bp ? h('span', { class: 'row-sub' }, `رسوم ${formatMoney(percentOf(r.p.amount, r.p.fee_bp))}`) : null),
        money(r.p.amount),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'حذف', onclick: () => { rows.splice(i, 1); paintSplit(); } }, icon('x', 18)),
      )));
      const amt = input({ dir: 'ltr', inputmode: 'decimal', value: s.remaining ? formatDecimal(s.remaining, CURRENCIES[base].minor, { trim: true, group: false }) : '' });
      fill(body,
        h('div', { class: 'pay-total' }, h('span', null, 'المطلوب'), money(total)),
        rows.length ? list : null,
        h('div', { class: `pay-remaining ${s.remaining ? 'bad' : 'ok'}` }, h('span', null, s.remaining ? 'المتبقي' : (s.change ? 'الباقي للزبون' : 'اكتمل الدفع')), money(s.remaining || s.change)),
        s.remaining ? h('div', null,
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'المبلغ ثم اختر الطريقة'), amt),
          h('div', { class: 'pay-methods pay-methods-sm' }, ...methods.map((m) => h('button', {
            class: `pay-method pay-${m.kind}`, type: 'button',
            onclick: () => {
              const v = parseMoney(amt.value, base);
              if (!v || v <= 0) { feedback.error(); return; }
              rows.push({ name: m.name, p: { method_id: m.id, kind: m.kind, amount: v, fee_bp: m.fee_bp || 0, currency: base } });
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
