// قفل التطبيق بالبصمة (اختياري، لكل جهاز): عند فتح التطبيق، وعند العودة إليه بعد غياب أكثر من دقيقة.
// أندرويد فقط (BiometricPlugin): بصمة أو وجه، وإن تعذّرا فرمز قفل الجوال — فلا يُحبس صاحب المحل خارج بياناته.
// إن أُزيل قفل الجوال نفسه لاحقًا يُفتح التطبيق ويُطفأ القفل (لا وسيلة تحقق تبقى).
const KEY = 'cashier-applock';
export const RELOCK_AFTER_MS = 60 * 1000;

/** هل يُعاد القفل عند العودة؟ (نقي، للاختبار) */
export function shouldRelock({ enabled, locked, busy, hiddenAt, now }) {
  return !!enabled && !locked && !busy && !!hiddenAt && now - hiddenAt >= RELOCK_AFTER_MS;
}

export function createAppLock({ plugin = () => globalThis.Capacitor?.Plugins?.Biometric || null, storage = globalThis.localStorage, onLock = () => {}, onUnlock = () => {} } = {}) {
  let locked = false;
  let busy = false;
  let hiddenAt = 0;
  const read = () => { try { return storage.getItem(KEY) === '1'; } catch { return false; } };
  const write = (on) => { try { if (on) storage.setItem(KEY, '1'); else storage.removeItem(KEY); } catch { /* */ } };

  const lock = {
    get enabled() { return read(); },
    get locked() { return locked; },

    /** { available, biometric } — available: يوجد قفل للجوال يمكن التحقق به؛ biometric: بصمة أو وجه مسجّل. */
    async support() {
      const p = plugin();
      if (!p) return { available: false, biometric: false };
      try { const r = await p.available(); return { available: !!r.available, biometric: !!r.biometric }; } catch { return { available: false, biometric: false }; }
    },

    /** يطلب البصمة. true عند النجاح. */
    async verify(title = 'دفترة كاشير', subtitle = 'افتح التطبيق ببصمتك') {
      const p = plugin();
      if (!p || busy) return false;
      busy = true;
      try { await p.authenticate({ title, subtitle }); return true; } catch { return false; } finally { busy = false; hiddenAt = 0; }
    },

    /** تشغيل أو إطفاء القفل: كلاهما بعد تحقق ناجح (فلا يطفئه غير صاحب الجوال). */
    async setEnabled(on) {
      if (!(await lock.support()).available) return false;
      if (!(await lock.verify('دفترة كاشير', on ? 'تأكيد تشغيل القفل' : 'تأكيد إطفاء القفل'))) return false;
      write(on);
      return true;
    },

    /** يقفل الشاشة ويطلب البصمة. */
    async lockNow() {
      if (!read()) return;
      if (!(await lock.support()).available) { write(false); if (locked) { locked = false; onUnlock(); } return; }
      if (!locked) { locked = true; onLock(); }
      if (await lock.verify()) { locked = false; onUnlock(); }
    },

    /** يبدأ العمل: يقفل الآن إن كان مفعّلًا، ويراقب الخروج من التطبيق والعودة إليه. */
    start() {
      const hidden = () => { if (!busy && !locked) hiddenAt = Date.now(); };
      const visible = () => {
        if (shouldRelock({ enabled: read(), locked, busy, hiddenAt, now: Date.now() })) lock.lockNow();
        if (!busy) hiddenAt = 0;
      };
      document.addEventListener('visibilitychange', () => (document.hidden ? hidden() : visible()));
      const App = globalThis.Capacitor?.Plugins?.App;
      if (App && App.addListener) App.addListener('appStateChange', (s) => (s.isActive ? visible() : hidden()));
      return lock.lockNow();
    },
  };
  return lock;
}
