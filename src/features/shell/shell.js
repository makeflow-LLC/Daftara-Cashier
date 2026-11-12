// إطار التطبيق: شريط التبويبات السفلي والزر العائم للبيع (ظاهر في كل الشاشات الرئيسية).
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { navigate, onRoute } from '../../core/router.js';
import { feedback } from '../../ui/feedback.js';

const TABS = [
  { id: 'home', path: '/', icon: 'home', label: 'الرئيسية' },
  { id: 'products', path: '/products', icon: 'box', label: 'الأصناف' },
  null, // مكان الزر العائم
  { id: 'customers', path: '/customers', icon: 'users', label: 'الزبائن' },
  { id: 'settings', path: '/settings', icon: 'more', label: 'المزيد' },
];

export function mountShell(root) {
  const buttons = new Map();
  const bar = h('nav', { class: 'tabbar', 'aria-label': 'التنقل' },
    ...TABS.map((t) => {
      if (!t) return h('span', { class: 'tab-gap', 'aria-hidden': 'true' });
      const b = h('button', { class: 'tab', type: 'button', onclick: () => navigate(t.path) }, icon(t.icon, 24), h('span', null, t.label));
      buttons.set(t.id, b);
      return b;
    }),
  );
  const fab = h('button', {
    class: 'fab', type: 'button', 'aria-label': 'بيع جديد',
    onclick: () => { feedback.tap(); navigate('/sale'); },
  }, icon('scan', 30), h('span', null, 'بيع'));
  root.append(bar, fab);

  onRoute((route) => {
    const chrome = route.chrome !== false;
    bar.hidden = !chrome;
    fab.hidden = !chrome;
    document.body.classList.toggle('has-tabbar', chrome);
    for (const [id, b] of buttons) b.classList.toggle('on', id === route.tab);
  });
}
