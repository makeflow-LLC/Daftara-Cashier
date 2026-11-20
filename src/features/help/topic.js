// عرض موضوع من دليل الاستخدام: لماذا هذه الصفحة، صورها، خطوات استعمالها، نصائح، والأسئلة الشائعة عنها.
// يُستعمل في ورقة «شرح» (فوق الصفحة نفسها) وفي صفحة الموضوع داخل «المساعدة».
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { SHOT_CAPTIONS, faqFor } from '../../domain/guide.js';
import { FAQ } from '../../domain/faq.js';
import { navigate } from '../../core/router.js';

/** صور الموضوع في إطار جوال. الصورة الناقصة تختفي وحدها. الضغط يكبّرها. */
function shots(topic) {
  if (!topic.shots.length) return null;
  const row = h('div', { class: `g-shots ${topic.shots.length > 1 ? 'many' : ''}`.trim() });
  for (const name of topic.shots) {
    const cap = SHOT_CAPTIONS[name] || topic.title;
    const fig = h('figure', { class: 'g-shot' });
    const img = h('img', { src: `guide/${name}.webp`, alt: `صورة: ${cap}`, loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => { fig.remove(); if (!row.children.length) row.remove(); });
    fig.append(
      h('button', { class: 'g-shot-btn', type: 'button', 'aria-label': `كبّر صورة ${cap}`, onclick: () => fig.classList.toggle('zoom') }, img),
      h('figcaption', null, cap));
    row.append(fig);
  }
  return row;
}

/** سؤال شائع يُفتح جوابه في مكانه. */
export function faqItem(it, { open = false, onToggle = null } = {}) {
  const el = h('div', { class: `faq ${open ? 'open' : ''}` });
  const ans = () => h('div', { class: 'faq-a' }, h('p', null, it.a),
    it.go ? h('button', { class: 'btn btn-outline', type: 'button', onclick: () => navigate(it.go[0]) }, icon('chevron', 18), h('span', null, it.go[1])) : null);
  const btn = h('button', { class: 'faq-q', type: 'button', 'aria-expanded': String(open) }, h('span', null, it.q), icon(open ? 'minus' : 'plus', 20));
  btn.addEventListener('click', () => {
    if (onToggle) { onToggle(it); return; }
    const now = !el.classList.contains('open');
    el.classList.toggle('open', now);
    btn.setAttribute('aria-expanded', String(now));
    btn.lastChild.replaceWith(icon(now ? 'minus' : 'plus', 20));
    if (now) el.append(ans()); else if (el.children[1]) el.children[1].remove();
  });
  el.append(btn);
  if (open) el.append(ans());
  return el;
}

export function topicContent(topic) {
  const related = faqFor(topic, FAQ);
  return h('div', { class: 'g-topic' },
    h('div', { class: 'g-why' }, h('div', { class: 'g-label' }, icon('info', 18), 'لماذا هذه الصفحة؟'), h('p', null, topic.why)),
    shots(topic),
    h('h3', { class: 'g-h' }, icon('check', 18), 'كيف أستعملها؟'),
    h('ol', { class: 'g-steps' }, ...topic.steps.map((s, i) => h('li', null, h('span', { class: 'g-n num' }, String(i + 1)), h('span', null, s)))),
    topic.tips.length ? h('div', { class: 'g-tips' }, h('div', { class: 'g-label' }, icon('bulb', 18), 'نصائح'),
      h('ul', null, ...topic.tips.map((t) => h('li', null, t)))) : null,
    related.length ? h('div', null, h('h3', { class: 'g-h' }, icon('help', 18), 'أسئلة شائعة عن هذه الصفحة'),
      h('div', { class: 'list faq-list' }, ...related.map((it) => faqItem(it)))) : null,
  );
}
