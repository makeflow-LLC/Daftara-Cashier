// نقطة البدء: يفتح قاعدة الجهاز، ثم الإعداد الأول أو الرئيسية. لا شيء ينتظر الإنترنت.
import { app } from './core/app.js';
import { addRoute, mount, render, navigate, onRoute, setGuard } from './core/router.js';
import { MODULES } from './features/index.js';
import { mountShell } from './features/shell/shell.js';
import { renderSetup } from './features/setup/setup.js';
import { readPrefs, applyTheme } from './features/settings/settings.js';
import { configureFeedback } from './ui/feedback.js';
import { closeTopSheet, closeAllSheets, toast } from './ui/overlay.js';
import { closeScanner } from './ui/scanner.js';
import { startPwa } from './core/pwa.js';
import { appLock } from './features/shell/lock.js';
import { watchDailyReport } from './features/reports/daily.js';
import { updates } from './core/updates.js';

async function start() {
  if (window.__oldWebView) return;
  startPwa(); // نسخة الويب: تعمل بلا إنترنت وتُثبَّت على الشاشة الرئيسية
  const prefs = readPrefs();
  applyTheme(prefs.theme);
  configureFeedback({ sound: prefs.sound, vibrate: prefs.vibrate });

  await app.boot();
  const view = document.getElementById('view');
  mount(view);
  onRoute(closeAllSheets);
  // مرحلة الحساب تُحدَّث مع كل تنقّل؛ لا نقاطع شاشة مفتوحة (بيع جارٍ مثلًا): الطلب يظهر عند التنقّل التالي
  onRoute(() => { app.account.check(); });
  // الترخيص: بعد انتهاء المدة تُفتح «الاشتراك» بدل شاشات الكتابة، وأي حفظ مرفوض يدلّ عليها
  setGuard((route, path) => {
    // بعد فترة التجربة الحرة (3 أيام أو 20 فاتورة): بلا حساب لا تُفتح أي شاشة غير شاشة إنشائه
    if (app.account.required) return path === '/account/required' ? null : '/account/required';
    // الموظفون: لا أحد دخل ← «من أنت؟»، ومن لا يملك صلاحية الشاشة يرجع للرئيسية
    if (app.locked) return path === '/lock' ? null : '/lock';
    if (path === '/lock' && !app.locked) return '/';
    if (route && route.perm && !(route.perm === 'owner' ? !app.staff || app.user?.owner : app.can(route.perm))) {
      setTimeout(() => toast('هذه الشاشة لصاحب المحل — اطلب منه الصلاحية', { kind: 'error' }), 0);
      return '/';
    }
    return route && route.write && app.license.compute().readOnly ? '/subscribe' : null;
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (!e.reason || !e.reason.license) return;
    e.preventDefault();
    toast(e.reason.message, { kind: 'error', ms: 5000 });
    navigate('/subscribe');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) app.license.compute(); });
  app.bus.on('toast', (a) => toast(...a)); // رسائل من الخدمات (مثل SMS) تظهر للمستخدم
  if (app.ctx.shopId) app.reminders.start(); // التذكير الدوري بالديون
  if (app.ctx.shopId) app.dues.start(); // مواعيد السداد للتجار: تذكير مرة في اليوم
  watchDailyReport(); // «📊 تقرير اليوم جاهز» في الساعة التي يختارها صاحب المحل
  updates.start(); // «تحديث جديد متوفر» حين يُنشر إصدار أحدث
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopSheet(); });

  if (!app.ctx.shopId) {
    addRoute({ path: '/', chrome: false, render: renderSetup });
    document.body.classList.remove('has-tabbar');
    await render();
    // بعد إنشاء المحل: نسجّل الشاشات الحقيقية
    const off = app.bus.on('shop', () => { off(); registerAll(); });
  } else {
    registerAll();
    await render();
  }
  appLock.start(); // قفل البصمة (إن شغّله صاحب المحل): شاشة القفل تظهر قبل أن تُرى أي بيانات
  hideSplash();
  androidBackButton();
}

let shellMounted = false;
function registerAll() {
  for (const m of MODULES) for (const r of m.routes) addRoute(r);
  if (!shellMounted) { mountShell(document.getElementById('chrome')); shellMounted = true; }
}

function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  s.classList.add('gone');
  setTimeout(() => s.remove(), 300);
}

// زر الرجوع في أندرويد: يغلق الورقة المفتوحة، أو يرجع شاشة، أو يصغّر التطبيق من الرئيسية
function androidBackButton() {
  const App = globalThis.Capacitor?.Plugins?.App;
  if (!App) return;
  App.addListener('backButton', () => {
    if (closeTopSheet()) return;
    if (closeScanner()) return;
    const hash = location.hash || '#/';
    if (hash === '#/' || hash === '#') App.minimizeApp();
    else history.back();
  });
}

start().catch((e) => {
  console.error(e);
  hideSplash();
  document.getElementById('view').innerHTML = '<div class="fatal"><h1>تعذّر فتح التطبيق</h1><p>أعد تشغيله. بياناتك محفوظة على الجوال.</p></div>';
  toast(String(e?.message || e), { kind: 'error', ms: 8000 });
});

export { navigate };
