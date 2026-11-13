// التصنيفات: إضافة، إعادة تسمية، حذف (مع تراجع).
import { h, fill } from '../../ui/dom.js';
import { header, row, button, field, input, emptyState } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';

export function renderCategories(el) {
  const list = h('div');
  async function paint() {
    const [cats, products] = await Promise.all([app.products.categories(), app.products.list()]);
    const count = new Map();
    for (const p of products) if (p.category_id) count.set(p.category_id, (count.get(p.category_id) || 0) + 1);
    fill(list, cats.length
      ? h('div', { class: 'list' }, ...cats.map((c) => row({ icon: 'tag', title: c.name, sub: `${count.get(c.id) || 0} صنف`, onclick: () => edit(c) })))
      : emptyState('tag', 'لا تصنيفات', 'التصنيفات تسهّل البحث وتحديث الأسعار جماعيًا: ألبان، معلبات، منظفات…'));
  }
  function edit(c) {
    const inp = input({ value: c ? c.name : '', maxlength: 40, placeholder: 'مثال: ألبان' });
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!inp.value.trim()) { feedback.error(); return; }
        if (c) await app.products.renameCategory(c.id, inp.value);
        else await app.products.addCategory(inp.value);
        close(); paint();
      },
    },
      field('اسم التصنيف', inp),
      button('حفظ', { type: 'submit', block: true, icon: 'check' }),
      c ? button('حذف التصنيف', {
        kind: 'text', onclick: async () => {
          await app.products.removeCategory(c.id);
          close(); paint();
          toast(`حُذف «${c.name}» (الأصناف باقية)`, { undo: async () => { await app.store.patch('categories', c.id, { deleted: false }); paint(); } });
        },
      }) : null,
    ), { title: c ? 'تعديل التصنيف' : 'تصنيف جديد' });
    setTimeout(() => inp.focus(), 200);
  }
  el.append(
    header('التصنيفات', { back: true }),
    h('div', { class: 'page' }, list, button('أضف تصنيفًا', { kind: 'outline', icon: 'plus', block: true, onclick: () => edit(null) })),
  );
  paint();
}
