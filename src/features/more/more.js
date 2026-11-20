// «المزيد»: كل أقسام التطبيق في مربعات كبيرة ملوّنة — الوصول لأي شيء بضغطة.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, syncBadge } from '../../ui/components.js';
import { SHOP_TYPES } from '../../domain/features.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { openFeedback } from '../help/feedback.js';
import { makeflowMark } from '../settings/settings.js';
import { lockNow } from '../staff/staff.js';

export function renderMore(el) {
  const can = (p) => app.can(p);
  const tile = (ic, label, tone, onclick, show = true) => !show ? null : h('button', { class: `hub-tile hub-${tone}`, type: 'button', onclick }, h('span', { class: 'hub-ic' }, icon(ic, 28)), h('span', { class: 'hub-label' }, label));
  const isOwner = !app.staff || !!app.user?.owner;
  // المحادثة: شارة بعدد الرسائل والتعميمات غير المقروءة
  const chatTile = tile('chat', 'المحادثة والتعميمات', 'pink', () => navigate('/chat'));
  app.chat.unread().then((u) => { const n = u.chats + u.announcements; if (n) chatTile.append(h('span', { class: 'badge' }, String(n))); });
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
      tile('chart', 'التقارير', 'green', go('/reports'), can('reports')),
      tile('receipt', 'الفواتير', 'blue', go('/invoices')),
      tile('cash', 'الصندوق', 'amber', go('/cash'), can('cash')),
      tile('coins', 'المصاريف', 'pink', go('/expenses'), can('cash')),
      tile('users', 'الرواتب', 'violet', go('/payroll'), isOwner),
      tile('box', 'المخزون', 'violet', go('/inventory'), can('purchases')),
      tile('truck', 'ديون التجار', 'teal', go('/suppliers'), can('purchases')),
      tile('warehouse', 'المخازن والنقل', 'blue', go('/inventory/warehouses'), can('purchases')),
      tile('undo', 'مرتجع وتبديل', 'amber', go('/sale/returns'), can('returns')),
      tile('star', 'العروض', 'green', go('/offers'), can('products')),
      tile('store', 'كتالوج واتساب', 'teal', go('/settings/catalog'), can('settings')),
      tile('tag', 'أدوات', 'pink', go('/tools'), can('products')),
      tile('lock', 'الموظفون والصلاحيات', 'blue', go('/settings/staff'), isOwner),
      chatTile),
    h('h2', { class: 'section-title' }, 'التطبيق'),
    h('div', { class: 'hub' },
      app.staff ? tile('lock', `قفل (${app.user?.name || ''})`, 'gray', lockNow) : null,
      tile('lock', 'حسابي', 'violet', go('/account'), can('settings')),
      tile('star', 'الاشتراك', 'amber', go('/subscribe')),
      tile('sliders', 'الإعدادات', 'gray', go('/settings'), can('settings')),
      tile('help', 'المساعدة', 'blue', go('/help')),
      tile('chat', 'أرسل ملاحظة', 'green', () => openFeedback('note'))),
    h('p', { class: 'made-by' }, 'دفترة كاشير ', h('span', { class: 'num' }, app.info.version), app.config.release ? '' : ' — نسخة تجريبية'),
    makeflowMark(),
  ));
}
