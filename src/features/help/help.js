// المساعدة: دليل استخدام مصوّر لكل صفحة (مصنّف في أقسام)، وأسئلة شائعة بأجوبة قصيرة، وبحث فوري في الاثنين.
// المحتوى بيانات فقط: domain/guide.js (الصفحات) و domain/faq.js (الأسئلة). زر «شرح» في كل صفحة: sheet.js.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, input, emptyState, row } from '../../ui/components.js';
import { normalizeArabic } from '../../domain/product.js';
import { GUIDE_CATS, TOPICS, topicsOf, topicById, searchTopics } from '../../domain/guide.js';
import { FAQ } from '../../domain/faq.js';
import { navigate } from '../../core/router.js';
import { openFeedback, askSupport } from './feedback.js';
import { topicContent, faqItem } from './topic.js';

export { FAQ };

// آخر ما كان مفتوحًا: يرجع المستخدم من صفحة الموضوع فيجد بحثه وقسمه كما تركهما
const last = { tab: 'guide', cat: 'all', q: '' };

const contact = () => h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'لم تجد ما تبحث عنه؟'),
  h('div', { class: 'help-contact' },
    h('button', { class: 'btn btn-wa', type: 'button', onclick: () => askSupport() }, icon('chat', 22), h('span', null, 'اسألنا على واتساب')),
    h('button', { class: 'btn btn-outline', type: 'button', onclick: () => openFeedback('feature') }, icon('bulb', 22), h('span', null, 'اقترح ميزة'))));

const topicRow = (t) => row({ icon: t.icon, title: t.title, sub: t.why, onclick: () => navigate(`/help/topic?id=${t.id}`) });
const topicList = (list) => h('div', { class: 'list g-list' }, ...list.map(topicRow));

export function renderHelp(el, params = {}) {
  if (params.tab === 'faq' || params.tab === 'guide') last.tab = params.tab;
  const q = input({ type: 'search', placeholder: 'ابحث: بيع، دين، جرد، طابعة…', autocomplete: 'off', value: last.q });
  const tabs = h('div', { class: 'seg' });
  const chips = h('div', { class: 'chips chips-scroll' });
  const body = h('div');
  let open = null;

  const faqList = (items) => h('div', { class: 'list faq-list' }, ...items.map((it) => faqItem(it, { open: open === it.q, onToggle: () => { open = open === it.q ? null : it.q; paint(); } })));
  const none = () => emptyState('help', 'لم نجد جوابًا', 'جرّب كلمة أخرى، أو اسألنا مباشرة على واتساب وسنرد عليك.',
    h('button', { class: 'btn btn-wa', type: 'button', onclick: () => askSupport() }, icon('chat', 22), h('span', null, 'اسألنا على واتساب')));

  function paintSearch(nq) {
    const topics = searchTopics(q.value, normalizeArabic);
    const words = nq.split(/\s+/).filter(Boolean);
    const faqs = FAQ.flatMap((g) => g.items).filter((it) => { const text = normalizeArabic(it.q + it.a); return words.every((w) => text.includes(w)); });
    tabs.hidden = true; chips.hidden = true;
    if (!topics.length && !faqs.length) { fill(body, none()); return; }
    fill(body,
      h('p', { class: 'g-count muted' }, `${topics.length + faqs.length} نتيجة`),
      topics.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title faq-group' }, icon('clipboard', 20), 'في دليل الصفحات'), topicList(topics)) : null,
      faqs.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title faq-group' }, icon('help', 20), 'في الأسئلة الشائعة'), faqList(faqs)) : null);
  }

  function paint() {
    last.q = q.value;
    const nq = normalizeArabic(q.value).trim();
    if (nq) { paintSearch(nq); return; }
    tabs.hidden = false; chips.hidden = false;
    const seg = (key, ic, label) => h('button', { class: `seg-btn ${last.tab === key ? 'on' : ''}`, type: 'button', onclick: () => { last.tab = key; last.cat = 'all'; open = null; paint(); } }, icon(ic, 20), label);
    fill(tabs, seg('guide', 'clipboard', 'الدليل المصوّر'), seg('faq', 'help', 'الأسئلة الشائعة'));
    const chip = (id, label) => h('button', { class: `chip ${last.cat === id ? 'on' : ''}`, type: 'button', onclick: () => { last.cat = id; open = null; paint(); } }, label);
    if (last.tab === 'guide') {
      fill(chips, chip('all', 'الكل'), ...GUIDE_CATS.map((c) => chip(c.id, c.name)));
      const cats = GUIDE_CATS.filter((c) => last.cat === 'all' || c.id === last.cat);
      fill(body, ...cats.map((c) => h('div', { class: 'section' },
        h('h2', { class: 'section-title faq-group' }, icon(c.icon, 20), c.name, h('span', { class: 'g-n-of muted num' }, String(topicsOf(c.id).length))),
        topicList(topicsOf(c.id)))));
    } else {
      fill(chips, chip('all', 'الكل'), ...FAQ.map((g) => chip(g.group, g.group)));
      const groups = FAQ.filter((g) => last.cat === 'all' || g.group === last.cat);
      fill(body, ...groups.map((g) => h('div', { class: 'section' },
        h('h2', { class: 'section-title faq-group' }, icon(g.icon, 20), g.group), faqList(g.items))));
    }
  }
  q.addEventListener('input', () => { open = null; paint(); });

  el.append(header('المساعدة', { back: true }), h('div', { class: 'page' },
    h('div', { class: 'help-hero' }, icon('help', 30), h('div', null, h('strong', null, 'كيف نساعدك؟'),
      h('p', null, `دليل مصوّر لـ ${TOPICS.length} صفحة، وأجوبة قصيرة عن كل شيء.`))),
    h('div', { class: 'search-row' }, icon('search', 20), q),
    tabs, chips, body, contact(),
  ));
  paint();
}

/** صفحة موضوع واحد من الدليل: /help/topic?id=sale */
export function renderHelpTopic(el, params = {}) {
  const topic = topicById(params.id);
  if (!topic) { navigate('/help', { replace: true }); return; }
  const cat = GUIDE_CATS.find((c) => c.id === topic.cat);
  const i = TOPICS.indexOf(topic);
  const prev = TOPICS[i - 1], next = TOPICS[i + 1];
  const nav = (t, label, ic) => t ? h('button', { class: 'g-nav', type: 'button', onclick: () => navigate(`/help/topic?id=${t.id}`, { replace: true }) },
    h('span', { class: 'g-nav-dir' }, ic === 'back' ? icon('back', 16) : null, label, ic === 'chevron' ? icon('chevron', 16) : null), h('strong', null, t.title)) : h('span');
  el.append(header(topic.title, { back: true, sub: cat ? `دليل الاستخدام · ${cat.name}` : 'دليل الاستخدام', help: false }), h('div', { class: 'page' },
    topicContent(topic),
    topic.open ? h('button', { class: 'btn btn-primary btn-block btn-lg g-open', type: 'button', onclick: () => navigate(topic.open) }, icon('chevron', 22), h('span', null, `افتح «${topic.title}»`)) : null,
    h('div', { class: 'g-navs' }, nav(prev, 'السابق', 'back'), nav(next, 'التالي', 'chevron')),
    contact(),
  ));
}
