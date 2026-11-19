// باركود مُسح ولم يُعرف، وهو قطعة منفردة من صنف مسجّل بباركود عبوته (كرتونة نسكافيه فيها 24 قطعة):
// البائع يختار الصنف، فيُربط به الباركود ولا يُنشأ صنف جديد. انظر pieceLinkPlan في domain/product.js.
import { h, fill, num } from '../../ui/dom.js';
import { input, button, money } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { searchProducts, pieceLinkPlan } from '../../domain/product.js';
import { formatQty, unit as unitOf } from '../../domain/units.js';
import { app } from '../../core/app.js';
import { productThumb } from './thumb.js';

export function linkPieceSheet(code, { products, onLinked = () => {} }) {
  const q = input({ placeholder: 'ابحث باسم الصنف', enterkeyhint: 'search' });
  const list = h('div', { class: 'list' });
  let sheet = null;

  function paint() {
    const hits = searchProducts(products, q.value, 30);
    fill(list, hits.length ? hits.map((p) => h('button', { class: 'row row-tap', type: 'button', onclick: () => pick(p) },
      productThumb(p, 36), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name)), money(p.sell_price, p.currency)))
      : h('div', { class: 'row muted' }, 'لا نتائج'));
  }

  async function pick(p) {
    const full = await app.products.get(p.id);
    if (!full) return;
    const plan = pieceLinkPlan(full);
    if (!plan) {
      feedback.error();
      toast(`«${full.name}» له باركود قطعة آخر — عدّله من بطاقة الصنف`, { kind: 'error', ms: 4000 });
      return;
    }
    sheet.close();
    const u = unitOf(full.unit);
    openSheet((close) => h('div', null,
      h('p', null, 'باركود القطعة المنفردة: ', num(code)),
      plan.kind === 'move'
        ? h('p', { class: 'muted' }, 'الباركود المسجّل الآن ', num(full.barcode), ` يصير باركود ال${plan.pack.name} (${formatQty(plan.pack.factor)} ${u.short})، وهذا باركود ${u.name} واحدة.`)
        : h('p', { class: 'muted' }, `يصير هذا باركود ${u.name} واحدة من «${full.name}».`),
      button(`نعم، قطعة من «${full.name}»`, {
        block: true, size: 'lg', icon: 'check',
        onclick: async () => {
          try {
            const { product } = await app.products.linkPiece(full.id, code);
            feedback.ok();
            toast(`رُبط الباركود بـ «${product.name}»`, { kind: 'ok' });
            close();
            onLinked(product);
          } catch (err) {
            feedback.error();
            toast(err.errors?.barcode || err.errors?.packs || 'تعذّر الربط', { kind: 'error', ms: 4000 });
          }
        },
      }),
      button('إلغاء', { kind: 'text', onclick: close }),
    ), { title: 'ربط القطعة بالصنف' });
  }

  q.addEventListener('input', paint);
  sheet = openSheet(() => h('div', null,
    h('p', { class: 'muted' }, 'اختر الصنف الذي هذه قطعة منه: ', num(code)),
    q, list,
  ), { title: 'قطعة من صنف مسجّل' });
  paint();
  setTimeout(() => q.focus(), 200);
}
