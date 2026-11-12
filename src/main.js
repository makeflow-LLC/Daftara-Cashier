// نقطة البدء: يفتح قاعدة الجهاز، ثم الإعداد الأول أو الرئيسية. لا شيء ينتظر الإنترنت.
import { app } from './core/app.js';
import { addRoute, mount, render, navigate, onRoute } from './core/router.js';
import { MODULES } from './features/index.js';
import { mountShell } from './features/shell/shell.js';
import { renderSetup } from './features/setup/setup.js';
import { readPrefs, applyTheme } from './features/settings/settings.js';
import { configureFeedback } from './ui/feedback.js';
import { closeTopSheet, closeAllSheets, toast } from './ui/overlay.js';

async function start() {
  if (window.__oldWebView) return;
  const prefs = readPrefs();
  applyTheme(prefs.theme);
  configureFeedback({ sound: prefs.sound, vibrate: prefs.vibrate });

  await app.boot();
  const view = document.getElementById('view');
  mount(view);
  onRoute(closeAllSheets);
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
