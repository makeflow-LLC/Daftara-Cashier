// فحص التحديثات: تلقائيًا في الخلفية مرة في اليوم (عند فتح التطبيق أو العودة إليه وهناك إنترنت)،
// وفورًا من زر «تحقق من التحديثات» في «عن التطبيق». لا شيء ينتظره: بلا إنترنت يُتجاهل بصمت.
//  - APK المباشر والحاسوب: يُقارن رقم آخر إصدار منشور برقم النسخة، ويُعرض رابط التنزيل (يُثبَّت فوق القديم).
//  - Google Play: المتجر يحدّث التطبيق؛ الزر يفتح صفحته.
//  - الويب: عامل الخدمة ينزّل الجديد، ويُطبَّق عند العودة للرئيسية.
import { RELEASES_API, CHECK_EVERY_MS, isNewer, releaseVersion, updateTarget } from '../domain/update.js';

export function createUpdater({ meta, getInfo, emit = () => {}, fetchFn = globalThis.fetch?.bind(globalThis), now = () => Date.now() }) {
  let cached = null; // { version, at }
  const u = {
    get flavor() { return getInfo().flavor; },
    get current() { return getInfo().version; },
    get target() { return updateTarget(u.flavor); },
    /** رقم الإصدار الأحدث إن كان أحدث من المثبَّت، وإلا null. */
    get available() {
      // النسخ التجريبية (بلا رقم إصدار رسمي) لا تُدعى للتحديث
      if (u.flavor === 'web' || u.flavor === 'play' || getInfo().release === false) return null;
      return cached && isNewer(cached.version, u.current) ? cached.version : null;
    },
    get checkedAt() { return cached ? cached.at : null; },

    async load() {
      cached = (await meta.get('update:latest')) || null;
      return u;
    },

    /**
     * يفحص الآن (force) أو إن مرّ يوم على آخر فحص.
     * يرجع { status: 'available'|'latest'|'downloading'|'store'|'offline'|'skipped', version? }.
     */
    async check({ force = false } = {}) {
      if (u.flavor === 'web') return checkWeb();
      if (u.flavor === 'play') return { status: 'store' };
      if (!force && cached && now() - cached.at < CHECK_EVERY_MS) return { status: 'skipped', version: u.available };
      if (!fetchFn || globalThis.navigator?.onLine === false) return { status: 'offline' };
      try {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null;
        const res = await fetchFn(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
        if (timer) clearTimeout(timer);
        if (!res.ok) return { status: 'offline' };
        const version = releaseVersion(await res.json());
        if (!version) return { status: 'offline' };
        const before = u.available;
        cached = { version, at: now() };
        await meta.set('update:latest', cached);
        if (u.available !== before) emit(u.available);
        return u.available ? { status: 'available', version } : { status: 'latest', version };
      } catch {
        return { status: 'offline' };
      }
    },

    /** الفحص التلقائي: عند البدء وعند كل عودة للتطبيق (لا يفحص فعليًا إلا مرة في اليوم). */
    start() {
      const kick = () => { u.check().catch(() => {}); };
      setTimeout(kick, 4000); // بعد أن يفتح التطبيق ويهدأ
      globalThis.document?.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
      globalThis.addEventListener?.('online', kick);
    },
  };

  async function checkWeb() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) return { status: 'offline' };
      await reg.update();
      return reg.installing || reg.waiting ? { status: 'downloading' } : { status: 'latest' };
    } catch {
      return { status: 'offline' };
    }
  }
  return u;
}
