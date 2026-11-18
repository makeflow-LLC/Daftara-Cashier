// «تحديث جديد متوفر»: لافتة في الرئيسية، وورقة «ما الجديد» بزر «حدّث الآن»، وفحص يدوي في «عن التطبيق».
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { noteTitle } from '../../domain/updates.js';
import { app } from '../../core/app.js';
import { updates } from '../../core/updates.js';

const HOW = {
  direct: 'يُنزَّل ملف التطبيق الجديد. بعد التنزيل اضغط عليه ثم «تثبيت» (إن سألك الجوال: اسمح بالتثبيت من هذا المصدر). بياناتك لا تُمسح.',
  desktop: 'يُنزَّل ملف التثبيت الجديد. شغّله فيتحدث البرنامج فوق القديم. بياناتك لا تُمسح.',
  play: 'تفتح صفحة التطبيق في Google Play: اضغط «تحديث».',
  web: 'يُعاد فتح التطبيق بالنسخة الجديدة. بياناتك لا تُمسح.',
};

/** ورقة ما الجديد وزر التحديث. */
export function updateSheet(latest) {
  openSheet((close) => h('div', { class: 'update-sheet' },
    h('div', { class: 'acc-card acc-ok' }, h('span', { class: 'acc-ic' }, icon('rocket', 30)),
      h('div', null, h('strong', null, 'الإصدار ', num(latest.version)), h('span', null, 'عندك الآن ', num(app.info.version)))),
    latest.notes && latest.notes.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'ما الجديد'),
      h('ul', { class: 'feature-list update-notes' }, ...latest.notes.map((n) => h('li', null, h('b', null, noteTitle(n)), n.length > noteTitle(n).length ? h('span', { class: 'muted' }, n.slice(noteTitle(n).length).replace(/^[\s:：—-]+/, '')) : null)))) : null,
    h('p', { class: 'muted small' }, HOW[app.info.flavor] || HOW.direct),
    button('حدّث الآن', { block: true, size: 'lg', icon: 'refresh', onclick: async () => { close(); await updates.install(latest); } }),
    button('لاحقًا', { kind: 'text', block: true, onclick: async () => { await updates.snooze(latest.version); close(); app.bus.emit('update', null); } }),
  ), { title: 'تحديث جديد متوفر' });
}

/** لافتة الرئيسية: تظهر حين يوجد إصدار أحدث (وتختفي 3 أيام بعد «لاحقًا»). */
export function updateBanner() {
  const box = h('div');
  const paint = async () => {
    const a = await updates.available();
    if (!a || (await updates.snoozed(a.version))) { fill(box); return; }
    fill(box, h('button', { class: 'beta-banner update-banner', type: 'button', onclick: () => updateSheet(a) },
      icon('rocket', 26),
      h('span', { class: 'row-main' }, h('strong', null, 'تحديث جديد متوفر — ', num(a.version)),
        h('span', null, a.notes && a.notes.length ? a.notes.slice(0, 3).map(noteTitle).join('، ') : 'ميزات وإصلاحات جديدة')),
      h('span', { class: 'lic-cta' }, 'حدّث')));
  };
  paint();
  const off = app.bus.on('update', paint);
  box.cleanup = off;
  return box;
}

/** صف «ابحث عن تحديث» في «عن التطبيق». */
export function checkRow() {
  const sub = h('span', { class: 'row-sub' }, 'اضغط للفحص الآن');
  return h('button', { class: 'row row-tap', type: 'button', onclick: async () => {
    sub.textContent = 'نبحث…';
    const a = await updates.check().catch(() => null);
    if (a) { sub.textContent = `متوفر الإصدار ${a.version}`; updateSheet(a); }
    else { sub.textContent = 'عندك آخر إصدار ✓'; toast('عندك آخر إصدار ✓', { kind: 'ok' }); }
  } }, h('span', { class: 'row-ic' }, icon('refresh', 22)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'ابحث عن تحديث'), sub), icon('chevron', 20));
}
