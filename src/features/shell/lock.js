// شاشة القفل: تغطي التطبيق كله حتى تنجح البصمة (core/applock.js). زر لإعادة المحاولة إن أُلغيت النافذة.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { createAppLock } from '../../core/applock.js';
import { app } from '../../core/app.js';

let screen = null;
export const appLock = createAppLock({
  onLock() {
    if (screen) return;
    screen = h('div', { class: 'app-lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'التطبيق مقفل' },
      h('div', { class: 'app-lock-ic' }, icon('lock', 44)),
      h('div', { class: 'app-lock-name' }, app.shop?.name || 'دفترة كاشير'),
      h('p', null, 'التطبيق مقفل'),
      h('button', { class: 'btn btn-lg app-lock-btn', type: 'button', onclick: () => appLock.lockNow() }, icon('lock', 22), h('span', null, 'افتح بالبصمة')),
      h('img', { class: 'app-lock-logo', src: 'icons/makeflow.png', alt: 'MakeFlow' }));
    document.body.append(screen);
  },
  onUnlock() {
    if (screen) screen.remove();
    screen = null;
  },
});
