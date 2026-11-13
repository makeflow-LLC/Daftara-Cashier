// اختيار زبون (للبيع بالآجل أو لربط الفاتورة به): بحث بالاسم أو الرقم، أو زبون جديد بسطرين.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { field, input, button, money } from '../../ui/components.js';
import { openSheet, toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';

/** يفتح ورقة الاختيار ويرجع الزبون المختار أو null. */
export function pickCustomer({ title = 'اختر الزبون' } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    let all = [];
    const q = input({ type: 'search', placeholder: 'ابحث بالاسم أو رقم الجوال', autocomplete: 'off' });
    const list = h('div', { class: 'list picker-list' });
    const sheet = openSheet((close) => {
      function pick(c) { chosen = c; close(); }
      function paint() {
        const items = app.customers.search(all, q.value).slice(0, 40);
        fill(list,
          ...items.map((c) => h('button', { class: 'row row-tap', type: 'button', onclick: () => pick(c) },
            h('span', { class: 'row-ic' }, icon('user', 20)),
            h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.name), c.phone ? h('span', { class: 'row-sub num' }, c.phone) : null),
            c.balance ? h('span', { class: `row-end ${c.balance > 0 ? 'owed' : ''}` }, money(c.balance)) : null)),
          h('button', { class: 'row row-tap row-add', type: 'button', onclick: () => createNew(pick) },
            h('span', { class: 'row-ic' }, icon('plus', 20)),
            h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, q.value.trim() ? `زبون جديد: «${q.value.trim()}»` : 'زبون جديد'))),
        );
      }
      q.addEventListener('input', paint);
      app.customers.list().then((l) => { all = l; paint(); });
      paint();
      return h('div', null, h('div', { class: 'search-row sheet-search' }, icon('search', 20), q), list);
    }, { title, onClose: () => resolve(chosen) });

    function createNew(pick) {
      const name = input({ value: /\d{5,}/.test(q.value) ? '' : q.value.trim(), maxlength: 60, placeholder: 'اسم الزبون' });
      const phone = input({ value: /\d{5,}/.test(q.value) ? q.value.trim() : '', type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: '059xxxxxxx' });
      openSheet((close) => h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const c = await app.customers.create({ name: name.value, phone: phone.value });
            feedback.ok();
            close();
            pick({ ...c, balance: 0 });
          } catch (err) { feedback.error(); toast(err.errors?.name || 'تعذّر الحفظ', { kind: 'error' }); }
        },
      }, field('الاسم', name), field('رقم الجوال (لإرسال الفواتير والتذكير على واتساب)', phone),
        button('حفظ واختيار', { type: 'submit', block: true, icon: 'check' })), { title: 'زبون جديد' });
      setTimeout(() => (name.value ? phone : name).focus(), 200);
    }
    setTimeout(() => q.focus(), 200);
    return sheet;
  });
}
