// «المزيد»: كل أقسام التطبيق في مربعات كبيرة ملوّنة — الوصول لأي شيء بضغطة.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, syncBadge } from '../../ui/components.js';
import { SHOP_TYPES } from '../../domain/features.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { openFeedback } from '../help/feedback.js';

export function renderMore(el) {
  const tile = (ic, label, tone, onclick) => h('button', { class: `hub-tile hub-${tone}`, type: 'button', onclick }, h('span', { class: 'hub-ic' }, icon(ic, 28)), h('span', { class: 'hub-label' }, label));
  const go = (p) => () => navigate(p);
  const shopCard = h('button', { class: 'shop-card', type: 'button', onclick: go('/settings/shop') },
    h('span', { class: 'shop-logo' }, (app.shop?.name || '؟').trim().charAt(0)),
    h('span', { class: 'row-main' }, h('span', { class: 'shop-name' }, app.shop?.name || ''), h('span', { class: 'shop-sub' }, SHOP_TYPES[app.shop?.shop_type]?.name || '')),
    icon('edit', 20));
  app.media.logoUrl().then((u) => { if (u) { const s = shopCard.querySelector('.shop-logo'); s.textContent = ''; s.style.backgroundImage = `url("${u}")`; } });

  el.append(header('المزيد', { actions: [syncBadge()] }), h('div', { class: 'page' },
    shopCard,
    h('h2', { class: 'section-title' }, 'إدارة المحل'),
    h('div', { class: 'hub' },
      tile('chart', 'التقارير', 'green', go('/reports')),
      tile('receipt', 'الفواتير', 'blue', go('/invoices')),
      tile('cash', 'الصندوق', 'amber', go('/cash')),
      tile('box', 'المخزون', 'violet', go('/inventory')),
      tile('truck', 'الموردون', 'teal', go('/suppliers')),
      tile('tag', 'أدوات', 'pink', go('/tools'))),
    h('h2', { class: 'section-title' }, 'التطبيق'),
    h('div', { class: 'hub' },
      tile('star', 'الاشتراك', 'amber', go('/subscribe')),
      tile('sliders', 'الإعدادات', 'gray', go('/settings')),
      tile('help', 'المساعدة', 'blue', go('/help')),
      tile('chat', 'أرسل ملاحظة', 'green', () => openFeedback('note'))),
    h('p', { class: 'made-by' }, 'دفترة كاشير ', h('span', { class: 'num' }, app.info.version), app.config.release ? ' · أحد منتجات ' : ' — نسخة تجريبية · أحد منتجات ', h('b', null, 'MakeFlow')),
  ));
}
