// قارئ الباركود (USB أو بلوتوث) يكتب الأرقام بسرعة كأنه لوحة مفاتيح ثم يضغط Enter.
// هنا نلتقطه في أي مكان من الشاشة، حتى لو لم يكن المؤشر في خانة البحث (الحاسوب خاصة).
// الكتابة البشرية أبطأ بكثير، فلا تُحسب مسحًا.

const GAP_MS = 60;   // أقصى زمن بين حرفين من القارئ
const MIN_LEN = 4;

/** منطق نقي (للاختبار): push(key, t) → الباركود حين يكتمل، أو null. */
export function createKeyBuffer({ gap = GAP_MS, min = MIN_LEN } = {}) {
  let buf = '';
  let last = 0;
  return {
    push(key, t) {
      if (key === 'Enter') {
        const code = buf.length >= min && t - last <= gap * 4 ? buf : null;
        buf = '';
        return code;
      }
      if (key.length !== 1 || !/[0-9A-Za-z\-٠-٩]/.test(key)) { buf = ''; return null; }
      if (buf && t - last > gap) buf = '';
      buf += key;
      last = t;
      return null;
    },
  };
}

function typing(el) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** يستمع للقارئ في كل الشاشة (إلا داخل الحقول، فلها تعاملها). يرجع دالة الإيقاف. */
export function listenKeyScanner(onCode) {
  const b = createKeyBuffer();
  const handler = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || typing(document.activeElement)) return;
    if (document.querySelector('.sheet-backdrop, .sheet')) return; // نافذة مفتوحة: لا نضيف للسلة من خلفها
    const code = b.push(e.key, e.timeStamp || performance.now());
    if (code) { e.preventDefault(); onCode(code); }
  };
  document.addEventListener('keydown', handler, true);
  return () => document.removeEventListener('keydown', handler, true);
}

/** نسخة الحاسوب: لا كاميرا مسح، بل قارئ USB ولوحة مفاتيح. */
export function isDesktop() {
  return (globalThis.CASHIER_CONFIG && globalThis.CASHIER_CONFIG.flavor) === 'desktop';
}
