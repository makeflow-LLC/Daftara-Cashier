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

// مستمع واحد للتطبيق كله. الشاشة التي تعرف ماذا تفعل بالباركود (بيع، شراء، جرد، نقل…) تسجّل نفسها
// بـ listenKeyScanner؛ وفي أي شاشة أخرى يذهب الباركود إلى المعالج العام (setDefaultScanHandler):
// بطاقة سريعة للصنف — فالقارئ يعمل في كل مكان.
const screens = [];
let fallback = null;
let installed = false;
let buffer = null;

function onKey(e) {
  if (e.ctrlKey || e.altKey || e.metaKey || typing(document.activeElement)) return;
  const target = screens.length ? screens[screens.length - 1] : fallback;
  if (!target) return;
  if (document.querySelector('.sheet-backdrop, .sheet')) return; // نافذة مفتوحة: لا نضيف للسلة من خلفها
  const code = buffer.push(e.key, e.timeStamp || performance.now());
  if (code) { e.preventDefault(); e.stopPropagation(); target(code); }
}

function install() {
  if (installed) return;
  installed = true;
  buffer = createKeyBuffer();
  document.addEventListener('keydown', onKey, true);
}

/** الشاشة المفتوحة تستقبل ما يمسحه القارئ (إلا داخل الحقول، فلها تعاملها). يرجع دالة الإيقاف. */
export function listenKeyScanner(onCode) {
  install();
  screens.push(onCode);
  return () => { const i = screens.lastIndexOf(onCode); if (i >= 0) screens.splice(i, 1); };
}

/** ما يحدث حين يُمسح باركود في شاشة لم تسجّل نفسها. */
export function setDefaultScanHandler(fn) {
  install();
  fallback = fn;
}

/** نسخة الحاسوب: لا كاميرا مسح، بل قارئ USB ولوحة مفاتيح. */
export function isDesktop() {
  return (globalThis.CASHIER_CONFIG && globalThis.CASHIER_CONFIG.flavor) === 'desktop';
}
