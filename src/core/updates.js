// يتحقق من وجود إصدار جديد: version.json على makeflow.tech (وإن تعذّر: آخر إصدار على GitHub).
// عند الفتح، ثم كل 6 ساعات والتطبيق مفتوح. النتيجة تُحفظ على الجهاز فتظهر اللافتة حتى بلا إنترنت.
// «حدّث الآن» حسب النسخة: أندرويد (مباشر) يُنزّل الـ APK، الحاسوب ملف التثبيت، Google Play صفحة المتجر، الويب إعادة تحميل.
import { isNewer, changelogNotes } from '../domain/updates.js';
import { app } from './app.js';

const VERSION_URL = 'https://makeflow.tech/apps/cashier/version.json';
const GITHUB_LATEST = 'https://api.github.com/repos/makeflow-LLC/Daftara-Cashier/releases/latest';
const EVERY_MS = 6 * 3600 * 1000;
const KEY = 'update:latest';
const SNOOZE = 'update:snoozed';

async function fetchJson(url, headers = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), 10000) : null;
  try {
    const r = await fetch(url, { headers, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    return r.ok ? await r.json() : null;
  } finally { if (t) clearTimeout(t); }
}

/** آخر إصدار منشور: { version, notes, apk, exe, play } أو null. */
export async function fetchLatest() {
  try {
    const v = await fetchJson(`${VERSION_URL}?t=${Date.now()}`);
    if (v && v.version) return v;
  } catch { /* نجرب GitHub */ }
  try {
    const g = await fetchJson(GITHUB_LATEST, { Accept: 'application/vnd.github+json' });
    if (g && g.tag_name) {
      const version = g.tag_name.replace(/^v/i, '');
      const asset = (n) => (g.assets || []).find((a) => a.name === n)?.browser_download_url;
      return { version, notes: changelogNotes(g.body || '', version), apk: asset('daftara-cashier.apk'), exe: asset('daftara-cashier-setup.exe') };
    }
  } catch { /* بلا إنترنت */ }
  return null;
}

export const updates = {
  /** الإصدار الأحدث المعروف إن كان أحدث من هذه النسخة، وإلا null. */
  async available() {
    const l = await app.meta.get(KEY);
    return l && isNewer(l.version, app.info.version) ? l : null;
  },
  /** هل أخفاه المستخدم («لاحقًا») لهذا الإصدار مؤخرًا؟ */
  async snoozed(version) {
    const s = await app.meta.get(SNOOZE);
    return !!(s && s.version === version && Date.now() - s.at < 3 * 86400000);
  },
  snooze(version) { return app.meta.set(SNOOZE, { version, at: Date.now() }); },
  /** يسأل الخادم الآن. يرجع الإصدار الأحدث أو null. */
  async check() {
    const l = await fetchLatest();
    if (l) await app.meta.set(KEY, { ...l, checkedAt: Date.now() });
    const a = await updates.available();
    app.bus.emit('update', a);
    return a;
  },
  /** يبدأ الفحص الدوري (نسخ الإصدار فقط؛ النسخ التجريبية بلا رقم إصدار حقيقي). */
  start() {
    if (!app.config.release) return;
    const tick = () => updates.check().catch(() => {});
    setTimeout(tick, 5000); // بعد أن يفتح التطبيق: لا يؤخر البدء
    setInterval(tick, EVERY_MS);
  },
  /** «حدّث الآن» حسب نوع النسخة. */
  async install(latest) {
    const f = app.info.flavor;
    if (f === 'web') {
      try { const r = await navigator.serviceWorker?.getRegistration(); if (r) await r.update(); } catch { /* */ }
      location.reload();
      return 'reload';
    }
    const url = f === 'play' ? latest.play || 'https://play.google.com/store/apps/details?id=com.makeflow.daftara.cashier'
      : f === 'desktop' ? latest.exe || 'https://makeflow.tech/apps/cashier/daftara-cashier-setup.exe'
        : latest.apk || 'https://makeflow.tech/apps/cashier/daftara-cashier.apk';
    const { openLink } = await import('../features/customers/customers.js');
    openLink(url);
    return f;
  },
};
