// «أرسل ملاحظة»: التطبيق في مرحلته التجريبية، ورأي صاحب المحل يصل MakeFlow مباشرة على واتساب.
// ثلاثة أنواع: مشكلة، طلب ميزة، ملاحظة. الرسالة تحمل تلقائيًا نسخة التطبيق واسم المحل لتسهيل المتابعة.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button } from '../../ui/components.js';
import { openSheet, toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';
import { openLink } from '../customers/customers.js';

export const SUPPORT_PHONE = '970597750343';

export const FEEDBACK_TYPES = [
  { key: 'bug', label: 'مشكلة', icon: 'alert', hint: 'ماذا حدث؟ وفي أي شاشة؟', tone: 'pink' },
  { key: 'feature', label: 'طلب ميزة', icon: 'bulb', hint: 'ما الميزة التي تتمناها؟ وكيف تفيدك؟', tone: 'amber' },
  { key: 'note', label: 'ملاحظة', icon: 'chat', hint: 'اكتب ملاحظتك أو رأيك…', tone: 'blue' },
];

/** نص الرسالة (نقي، للاختبار). */
export function feedbackMessage({ type, text, shopName, version, flavor, sdk }) {
  const t = FEEDBACK_TYPES.find((x) => x.key === type) || FEEDBACK_TYPES[2];
  return `*دفترة كاشير — ${t.label}*\n${String(text).trim()}\n\n—\nالمحل: ${shopName || '—'}\nالنسخة: ${version}${flavor ? ` (${flavor})` : ''}${sdk ? ` · أندرويد ${sdk}` : ''}`;
}

export function openFeedback(initial = 'note') {
  let type = initial;
  const chips = h('div', { class: 'fb-types' });
  const text = h('textarea', { class: 'input textarea', rows: 5, maxlength: 1500 });
  const paint = () => {
    fill(chips, ...FEEDBACK_TYPES.map((t) => h('button', { class: `fb-type fb-${t.tone} ${type === t.key ? 'on' : ''}`, type: 'button', onclick: () => { type = t.key; paint(); text.focus(); } }, icon(t.icon, 24), h('span', null, t.label))));
    text.placeholder = FEEDBACK_TYPES.find((t) => t.key === type).hint;
  };
  paint();
  openSheet((close) => h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      if (text.value.trim().length < 3) { feedback.error(); toast('اكتب ملاحظتك أولًا', { kind: 'error' }); text.focus(); return; }
      const msg = feedbackMessage({ type, text: text.value, shopName: app.shop?.name, version: app.info.version, flavor: app.info.flavor, sdk: app.info.sdk });
      close();
      openLink(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(msg)}`);
      toast('شكرًا لك! أرسل الرسالة من واتساب', { kind: 'ok', ms: 4000 });
    },
  },
    h('p', { class: 'muted' }, 'التطبيق في نسخته التجريبية، وكل ملاحظة منك تطوّره. تصل رسالتك إلى فريق MakeFlow على واتساب.'),
    chips, text,
    h('button', { class: 'btn btn-wa btn-block btn-lg', type: 'submit' }, icon('chat', 22), h('span', null, 'أرسل عبر واتساب')),
  ), { title: 'أرسل ملاحظة' });
  setTimeout(() => text.focus(), 200);
}
