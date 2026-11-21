// اختصارات لوحة المفاتيح (الحاسوب): البيع كله بلا فأرة.
// عامة (الإطار): F1 شرح، F2 بيع… وخاصة بالشاشة المفتوحة (pageShortcuts) تُلغى عند مغادرتها.
// كل اختصار: { key: 'F4' | 'Ctrl+K' | '/', label: 'خصم', run, typing: true يعمل والمؤشر في حقل، sheet: true يعمل ونافذة مفتوحة }
import { h } from './dom.js';

let globals = [];
const pages = [];
let installed = false;

function keyName(e) {
  const k = e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${k}`;
}

function isTyping() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** منطق الاختيار (نقي، للاختبار): أول اختصار يطابق المفتاح ويصح في الحالة الحالية؛ اختصارات الشاشة قبل العامة. */
export function matchShortcut(lists, name, { typing = false, sheet = false } = {}) {
  for (const list of lists) {
    for (const s of list) {
      if (s.key !== name) continue;
      // حرف أو رمز بلا Ctrl/Alt يُكتب في الحقل ولا يُعد اختصارًا؛ مفاتيح F تعمل دائمًا
      const plain = !/^(F\d+|Ctrl\+|Alt\+|Escape)/.test(s.key);
      if (typing && (plain || s.typing === false)) continue;
      if (sheet && !s.sheet) continue;
      return s;
    }
  }
  return null;
}

function onKey(e) {
  if (e.defaultPrevented || e.repeat) return;
  const top = pages.length ? [pages[pages.length - 1]] : [];
  const s = matchShortcut([...top, globals], keyName(e), { typing: isTyping(), sheet: !!document.querySelector('.sheet') });
  if (!s) return;
  e.preventDefault();
  s.run(e);
}

function install() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', onKey);
}

export function setGlobalShortcuts(list) {
  install();
  globals = list;
}

/** اختصارات الشاشة المفتوحة. يرجع دالة الإلغاء (تُستدعى في تنظيف الشاشة). */
export function pageShortcuts(list) {
  install();
  pages.push(list);
  return () => { const i = pages.lastIndexOf(list); if (i >= 0) pages.splice(i, 1); };
}

/** ما يعمل الآن، لعرضه في ورقة «شرح»: [{ key, label }] — الشاشة أولًا ثم العامة. */
export function activeShortcuts() {
  const top = pages.length ? pages[pages.length - 1] : [];
  const seen = new Set();
  return [...top, ...globals].filter((s) => s.label && !seen.has(s.key) && seen.add(s.key)).map((s) => ({ key: s.key, label: s.label }));
}

/** شارة المفتاح بجانب الزر. تظهر على الشاشة العريضة فقط (CSS). */
export function kbd(key) {
  return h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, key);
}
