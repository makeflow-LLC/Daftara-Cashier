// زر «شرح» في رأس كل صفحة: يفتح ورقة فيها لماذا هذه الصفحة وكيف تُستعمل، دون مغادرتها (السلة والنموذج يبقيان كما هما).
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { topicById, topicForPath } from '../../domain/guide.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { topicContent } from './topic.js';
import { askSupport } from './feedback.js';
import { activeShortcuts } from '../../ui/shortcuts.js';
import { isWide } from '../../ui/wide.js';

const here = () => (location.hash || '#/').slice(1) || '/';

export function openHelpSheet(topic) {
  // الدليل الكامل صفحة داخل التطبيق: لا تُفتح قبل إنشاء المحل ولا والجهاز مقفل
  const canBrowse = !!app.ctx.shopId && !app.locked && !app.account?.required;
  const keys = activeShortcuts();
  return openSheet(() => h('div', { class: 'g-sheet' },
    topicContent(topic),
    // الحاسوب: اختصارات لوحة المفاتيح التي تعمل في هذه الصفحة الآن
    isWide() && keys.length ? h('div', { class: 'g-keys' }, h('h3', { class: 'g-h' }, icon('flash', 18), 'اختصارات لوحة المفاتيح'),
      h('div', { class: 'g-keys-list' }, ...keys.map((k) => h('div', { class: 'g-key' }, h('kbd', { class: 'kbd on' }, k.key), h('span', null, k.label))))) : null,
    h('div', { class: 'g-actions' },
      canBrowse && topic.id !== 'help' ? h('button', { class: 'btn btn-outline', type: 'button', onclick: () => navigate('/help') }, icon('help', 20), h('span', null, 'الدليل الكامل')) : null,
      h('button', { class: 'btn btn-wa', type: 'button', onclick: () => askSupport(topic.title) }, icon('chat', 20), h('span', null, 'اسألنا على واتساب')))),
  { title: `شرح: ${topic.title}` });
}

/**
 * زر «شرح» للصفحة المفتوحة الآن (أو لموضوع محدد: topic). يرجع null إن لم يكن للصفحة شرح.
 * compact: علامة الاستفهام وحدها. dark: فوق خلفية ملوّنة أو فوق الكاميرا.
 */
export function pageHelpButton({ compact = false, dark = false, topic = null } = {}) {
  const fixed = topic ? topicById(topic) : null;
  if (!fixed && !topicForPath(here())) return null;
  return h('button', {
    class: `help-btn ${compact ? 'compact' : ''} ${dark ? 'dark' : ''}`.replace(/\s+/g, ' ').trim(),
    type: 'button', 'aria-label': 'شرح هذه الصفحة', title: 'شرح هذه الصفحة',
    onclick: () => { const t = fixed || topicForPath(here()); if (t) { feedback.tap(); openHelpSheet(t); } },
  }, h('span', { class: 'help-q', 'aria-hidden': 'true' }, '؟'), compact ? null : h('span', null, 'شرح'));
}
