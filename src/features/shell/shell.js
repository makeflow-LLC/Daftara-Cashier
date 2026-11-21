// إطار التطبيق. على الجوال: شريط التبويبات السفلي والزر العائم للبيع (في الشاشات الرئيسية).
// على الشاشة العريضة (حاسوب): قائمة جانبية ثابتة في كل الشاشات، واختصارات لوحة المفاتيح، والقارئ في كل مكان.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { syncBadge } from '../../ui/components.js';
import { navigate, onRoute, render } from '../../core/router.js';
import { feedback } from '../../ui/feedback.js';
import { setGlobalShortcuts, kbd } from '../../ui/shortcuts.js';
import { setDefaultScanHandler } from '../../ui/keyscan.js';
import { isWide, onWideChange } from '../../ui/wide.js';
import { topicForPath } from '../../domain/guide.js';
import { SIDE, sideItemFor } from '../../domain/nav.js';
import { app } from '../../core/app.js';
import { openHelpSheet } from '../help/sheet.js';
import { handleGlobalScan } from './scan.js';

const TABS = [
  { id: 'home', path: '/', icon: 'home', label: 'الرئيسية' },
  { id: 'products', path: '/products', icon: 'box', label: 'الأصناف' },
  null, // مكان الزر العائم
  { id: 'customers', path: '/customers', icon: 'users', label: 'الديون' },
  { id: 'settings', path: '/more', icon: 'more', label: 'المزيد' },
];

const here = () => ((location.hash || '#/').slice(1) || '/').split('?')[0];
// شاشات بلا قائمة: القفل وطلب الحساب (لا تنقّل منها)
const BARE = ['/lock', '/account/required'];

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

  const side = h('nav', { class: 'sidebar', 'aria-label': 'القائمة الرئيسية' });
  let visible = [];
  function paintSide() {
    visible = SIDE.filter((it) => !it.perm || app.can(it.perm));
    const current = sideItemFor(here(), visible);
    fill(side,
      h('div', { class: 'side-shop' }, h('span', { class: 'side-logo' }, (app.shop?.name || '؟').trim().charAt(0)), h('strong', null, app.shop?.name || 'دفترة كاشير')),
      h('button', { class: `side-sale ${here() === '/sale' ? 'on' : ''}`, type: 'button', onclick: () => navigate('/sale') }, icon('scan', 24), h('span', null, 'بيع جديد'), kbd('F2')),
      h('div', { class: 'side-items' }, ...visible.map((it, i) => h('button', {
        class: `side-item ${current === it ? 'on' : ''}`, type: 'button', 'aria-current': current === it ? 'page' : null, onclick: () => navigate(it.path),
      }, icon(it.icon, 22), h('span', null, it.label), i < 9 ? kbd(`Alt ${i + 1}`) : null))),
      h('div', { class: 'side-foot' }, syncBadge(), h('span', { class: 'side-hint' }, kbd('F1'), ' شرح الصفحة')));
  }
  root.append(bar, fab, side);

  onRoute((route) => {
    const chrome = route.chrome !== false;
    bar.hidden = !chrome;
    fab.hidden = !chrome;
    document.body.classList.toggle('has-tabbar', chrome);
    document.body.classList.toggle('has-side', !BARE.includes(here()));
    for (const [id, b] of buttons) b.classList.toggle('on', id === route.tab);
    paintSide();
  });
  app.bus.on('shop', paintSide);
  app.bus.on('user', paintSide);
  // عبور الحد بين الجوال والحاسوب: الشاشة تُرسم من جديد بشكلها المناسب (جدول أو قائمة)
  onWideChange(() => render());

  const focusSearch = () => {
    const s = document.querySelector('#view input[type=search]');
    if (s) { s.focus(); s.select(); }
  };
  setGlobalShortcuts([
    { key: 'F1', label: 'شرح هذه الصفحة', sheet: false, run: () => { const t = topicForPath(here()); if (t) openHelpSheet(t); } },
    { key: 'F2', label: 'بيع جديد', sheet: true, run: () => navigate('/sale') },
    { key: 'F3', label: 'ابحث في هذه الصفحة', run: focusSearch },
    { key: '/', run: focusSearch },
    { key: 'Ctrl+K', run: focusSearch },
    ...SIDE.slice(0, 9).map((_, i) => ({ key: `Alt+${i + 1}`, label: i === 0 ? 'Alt + رقم: التنقل بين أقسام القائمة' : null, run: () => { if (isWide() && visible[i]) navigate(visible[i].path); } })),
  ]);
  setDefaultScanHandler(handleGlobalScan);
}
