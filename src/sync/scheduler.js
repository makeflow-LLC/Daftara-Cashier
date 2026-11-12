// متى نزامن (بلا أن يطلب المستخدم شيئًا): عند الفتح، عند عودة الإنترنت، عند العودة للتطبيق،
// بعد كل حفظ بثوانٍ، وكل 90 ثانية والتطبيق ظاهر. لا مزامنة والتطبيق في الخلفية (بطارية وإنترنت).
const AFTER_CHANGE_MS = 4000;
const EVERY_MS = 90_000;

export function startScheduler(engine, { bus, isOnline = () => navigator.onLine !== false } = {}) {
  let debounce = null;
  let timer = null;

  function kick() {
    if (document.visibilityState === 'hidden') return;
    if (!isOnline()) return;
    engine.run();
  }
  function soon() {
    clearTimeout(debounce);
    debounce = setTimeout(kick, AFTER_CHANGE_MS);
  }
  function loop() {
    clearInterval(timer);
    timer = setInterval(kick, EVERY_MS);
  }

  window.addEventListener('online', kick);
  window.addEventListener('offline', () => engine.refreshPending());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  bus.on('data', (e) => { if (e.source === 'local') { engine.refreshPending(); soon(); } });
  setTimeout(kick, 1500);
  loop();
  return { now: kick };
}
