// الجرد: امسح الصنف ← اكتب العدد الفعلي ← التالي. في النهاية «اعتمد الجرد»: تُنشأ حركات تسوية بالفروق
// وتظهر قيمة الفرق (نقص أو زيادة). القائمة تُحفظ لو أُغلق التطبيق في منتصف الجرد.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, button, input, field, money } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { openScanner } from '../../ui/scanner.js';
import { countSummary } from '../../domain/inventory.js';
import { formatQty, parseQty, unit as unitOf } from '../../domain/units.js';
import { formatMoney } from '../../domain/currency.js';
import { app } from '../../core/app.js';
import { pickProduct } from './hub.js';

export async function renderCount(el) {
  let items = await app.inventory.loadCount();
  const body = h('div');
  const sumEl = h('div');
  el.append(header('جرد المخزون', { back: true }), h('div', { class: 'page' },
    h('div', { class: 'product-actions' },
      button('امسح وعُدّ', { icon: 'scan', onclick: scan }),
      button('اختر بالاسم', { kind: 'outline', icon: 'search', onclick: async () => { const p = await pickProduct(); if (p) ask(p); } })),
    sumEl, body));

  function paint() {
    const s = countSummary(items);
    fill(sumEl, items.length ? h('div', { class: `pay-remaining ${s.diffValue < 0 ? 'bad' : 'ok'}` },
      h('span', null, `${items.length} صنف — ${s.diffValue < 0 ? 'نقص بقيمة' : s.diffValue > 0 ? 'زيادة بقيمة' : 'لا فرق'}`), money(Math.abs(s.diffValue))) : null);
    fill(body, items.length ? h('div', null,
      h('div', { class: 'list' }, ...s.rows.map((r, i) => h('button', { class: 'row row-tap', type: 'button', onclick: () => ask({ id: r.product_id, name: r.name, unit: r.unit }, i) },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.name),
          h('span', { class: 'row-sub' }, 'المسجّل ', num(formatQty(r.recorded)), ' — الفعلي ', num(formatQty(r.actual)))),
        h('span', { class: `row-end ${r.diff < 0 ? 'owed' : r.diff > 0 ? 'credit' : ''}` }, r.diff ? num(`${r.diff > 0 ? '+' : '−'}${formatQty(Math.abs(r.diff))}`) : icon('check', 20))))),
      button('اعتمد الجرد', { block: true, size: 'lg', icon: 'check', onclick: apply }),
      button('ألغِ هذا الجرد', { kind: 'text', onclick: () => { const old = items; items = []; save(); toast('أُلغي الجرد', { undo: () => { items = old; save(); } }); } }))
      : emptyState('clipboard', 'ابدأ الجرد', 'امسح أي صنف واكتب كم حبة موجودة فعلًا على الرف. جرّد قسمًا واحدًا أو المحل كله.'));
  }
  function save() { app.inventory.saveCount(items); paint(); }

  // ورقة العدّ: الرقم فقط
  function ask(p, index = -1) {
    return new Promise((resolve) => {
      const i = index >= 0 ? index : items.findIndex((x) => x.product_id === p.id);
      const q = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0', value: i >= 0 ? formatQty(items[i].actual) : '' });
      openSheet((close) => h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const actual = parseQty(q.value || '');
          if (actual === null || actual < 0) { feedback.error(); toast('اكتب العدد الموجود', { kind: 'error' }); return; }
          const s = await app.db.stock.get(p.id);
          const row = { product_id: p.id, name: p.name, unit: p.unit, recorded: s ? s.qty : 0, actual, unit_cost: s ? s.avgCost : 0 };
          if (i >= 0) items[i] = row; else items.unshift(row);
          feedback.ok(); close(); save();
        },
      }, field(`كم ${unitOf(p.unit).name} موجودة الآن؟`, q),
        button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
        i >= 0 ? button('أزل من الجرد', { kind: 'text', onclick: () => { items.splice(i, 1); close(); save(); } }) : null,
      ), { title: p.name, onClose: resolve });
      setTimeout(() => { q.focus(); q.select(); }, 150);
    });
  }

  function scan() {
    openScanner({
      title: 'جرد: امسح الصنف',
      onCode: async (code) => {
        const hit = await app.products.findByCode(code);
        if (!hit) { feedback.error(); toast('باركود غير مسجّل', { kind: 'error' }); return undefined; }
        return ask(hit.product);
      },
    });
  }

  async function apply() {
    const r = await app.inventory.applyCount(items);
    items = [];
    feedback.ok(); paint();
    const cur = app.shop?.base_currency || 'ILS';
    toast(r.changed ? `اعتُمد الجرد: ${r.changed} صنف عُدّل — ${r.diffValue < 0 ? 'نقص' : 'زيادة'} ${formatMoney(Math.abs(r.diffValue), cur)}` : 'اعتُمد الجرد: المخزون مطابق تمامًا', { kind: 'ok', ms: 5000 });
  }
  paint();
}
