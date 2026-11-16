// نسخة الويب (makeflow.tech/apps/cashier/app/): تعمل بلا إنترنت بعد أول فتح (sw.js يخزّن ملفات التطبيق)،
// وتُثبَّت على الشاشة الرئيسية في آيفون وأندرويد كأنها تطبيق. البيانات في IndexedDB على الجهاز كبقية النسخ.

export function isWeb() {
  return (globalThis.CASHIER_CONFIG || {}).flavor === 'web';
}

/** مفتوحة من أيقونة الشاشة الرئيسية (لا من المتصفح)؟ */
export function isStandalone() {
  return !!(globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);
}

export function isIos() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function startPwa() {
  if (!isWeb()) return;
  // يطلب من المتصفح ألا يمسح البيانات عند امتلاء الذاكرة (سفاري يمسح بيانات المواقع غير المثبّتة بعد مدة)
  try { navigator.storage?.persist?.(); } catch { /* */ }
  if (!('serviceWorker' in navigator) || location.protocol === 'http:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
  // نسخة جديدة نزلت: نعيد التحميل عند العودة للرئيسية (لا في منتصف بيع)
  let updated = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) updated = true; });
  window.addEventListener('hashchange', () => {
    if (updated && (location.hash === '' || location.hash === '#/')) location.reload();
  });
}

/** تلميح «أضفه إلى الشاشة الرئيسية» (آيفون لا يعرضه وحده). يختفي بعد إغلاقه. */
const HINT_KEY = 'cashier-a2hs-dismissed';
export function shouldShowInstallHint() {
  if (!isWeb() || isStandalone()) return false;
  try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return false; }
}
export function dismissInstallHint() {
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* */ }
}
