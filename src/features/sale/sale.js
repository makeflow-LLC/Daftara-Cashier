// شاشة البيع — هيكلها فقط في هذه المرحلة (تُبنى كاملة في المرحلة 2: المسح، السلة، الدفع).
// تُحمَّل مسبقًا مع التطبيق، فتفتح فورًا من الزر العائم في أي شاشة.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, iconButton, money, emptyState, input } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';

export function renderSale(el) {
  const t0 = performance.now();
  const soon = () => toast('شاشة البيع الكاملة تأتي في المرحلة 2');
  el.append(
    h('div', { class: 'sale' },
      header('بيع جديد', { back: true, actions: [iconButton('flash', 'الفلاش', soon)] }),
      h('div', { class: 'scan-box', onclick: soon },
        icon('scan', 40), h('span', null, 'وجّه الكاميرا نحو الباركود'), h('small', null, 'المسح المستمر يأتي في المرحلة 1'),
      ),
      h('div', { class: 'search-row' }, icon('search', 20), input({ placeholder: 'ابحث باسم الصنف', type: 'search', onfocus: soon })),
      h('div', { class: 'cart' }, emptyState('cart', 'السلة فارغة', 'امسح باركود أو ابحث عن صنف لإضافته.')),
      h('div', { class: 'paybar' },
        h('div', { class: 'paybar-total' }, h('span', null, 'الإجمالي'), money(0)),
        h('button', { class: 'btn btn-primary btn-lg', type: 'button', disabled: true }, icon('check', 22), h('span', null, 'ادفع')),
      ),
    ),
  );
  el.dataset.openMs = String(Math.round(performance.now() - t0));
}
