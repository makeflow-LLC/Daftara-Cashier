// الماسح: كاميرا مستمرة بـ Google ML Kit (عبر خدمات Google Play، فلا يكبر التطبيق)، صوت واهتزاز لكل مسح،
// زر الفلاش، وحقل لكتابة الباركود يدويًا دائمًا (كاميرا معطلة، باركود ممسوح، أو تجربة في المتصفح).
//
// على أندرويد تعمل الكاميرا خلف صفحة التطبيق: نجعل الصفحة شفافة في وسطها ونُظهر الإطار فوقها.
// في المتصفح: BarcodeDetector إن وُجد، وإلا الكتابة اليدوية فقط.
import { h } from './dom.js';
import { icon } from './icons.js';
import { feedback } from './feedback.js';
import { normalizeBarcode } from '../domain/product.js';

const FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR'];
// الباركود يُحسب مرة واحدة ما دام أمام الكاميرا. ليُحسب ثانية: أبعد الكاميرا عنه (ثانية ونصف) ثم امسحه من جديد،
// أو زد العدد بزر + في السلة. (كل قراءة له تجدّد المهلة، فالبقاء أمامه لا يكرره أبدًا.)
const REPEAT_MS = 1500;
let active = null;

// ---------- التكبير ----------
// عدسات الجوالات الرخيصة لا تركّز على القريب (أقل من 10 سم تقريبًا، وبعضها تركيزه ثابت). الحل: تكبير 2×
// افتراضيًا، فيمسك البائع الجوال على شبر (15–20 سم) حيث الصورة حادّة والباركود يملأ الإطار.
// الاختيار (1× / 2× / 3×) يُحفظ لكل جوال.
const ZOOM_KEY = 'cashier-zoom';
const DEFAULT_ZOOM = 2;
export const SCAN_HINT = 'أبعد الجوال شبرًا عن الباركود';

function savedZoom() {
  try { const z = Number(localStorage.getItem(ZOOM_KEY)); return z >= 1 && z <= 5 ? z : DEFAULT_ZOOM; } catch { return DEFAULT_ZOOM; }
}

/** أقرب مستوى مسموح للمطلوب ضمن حدود الكاميرا (نقي، للاختبار). */
export function pickZoom(wanted, min, max) {
  const lo = Number.isFinite(min) && min > 0 ? min : 1;
  const hi = Number.isFinite(max) && max >= lo ? max : lo;
  return Math.min(Math.max(wanted, Math.max(1, lo)), hi);
}

/** المستويات المعروضة: 1× و2× و3× إن كانت الكاميرا تسمح بها. */
export function zoomLevels(min, max) {
  return [1, 2, 3].filter((z) => z >= (min || 1) - 0.01 && z <= (max || 1) + 0.01);
}

/** يطبّق التكبير المحفوظ ويرجع شريط أزرار التكبير (أو null إن لم تدعمه الكاميرا). */
async function setupZoom(native) {
  let min = 1, max = 1;
  try { min = (await native.getMinZoomRatio()).zoomRatio; max = (await native.getMaxZoomRatio()).zoomRatio; } catch { return null; }
  const levels = zoomLevels(min, max);
  if (levels.length < 2) return null;
  let current = pickZoom(savedZoom(), min, max);
  const bar = h('div', { class: 'zoom-bar', role: 'group', 'aria-label': 'التكبير' });
  const apply = async (z) => {
    current = z;
    try { await native.setZoomRatio({ zoomRatio: z }); } catch { /* */ }
    try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* */ }
    paint();
  };
  const paint = () => {
    bar.textContent = '';
    for (const z of levels) bar.append(h('button', { class: `zoom-btn ${Math.abs(current - z) < 0.01 ? 'on' : ''}`, type: 'button', 'aria-label': `تكبير ${z}`, onclick: (e) => { e.stopPropagation(); apply(z); } }, `${z}×`));
  };
  try { await native.setZoomRatio({ zoomRatio: current }); } catch { /* */ }
  paint();
  return bar;
}

function plugin() {
  return globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins.BarcodeScanner : null;
}

/**
 * يفتح الماسح. onCode(code) يُستدعى لكل باركود جديد؛ إن أرجع وعدًا يتوقف المسح حتى ينتهي
 * (مثلًا ورقة إضافة صنف جديد)، ثم يعود وحده. continuous=false: يُغلق بعد أول باركود.
 * panel: عنصر اختياري يظهر أسفل الإطار (عدّاد، آخر صنف…).
 */
export function openScanner({ title = 'امسح الباركود', onCode, continuous = true, panel = null, onClose = null } = {}) {
  if (active) active.close();
  const native = plugin();
  let paused = false;
  let closed = false;
  let last = { code: '', at: 0 };
  let video = null;
  let stream = null;
  let detectTimer = null;
  const listeners = [];

  const status = h('div', { class: 'scan-status' });
  const manual = h('input', {
    class: 'input scan-manual-input', type: 'text', inputmode: 'numeric', dir: 'ltr', autocomplete: 'off',
    placeholder: 'أو اكتب الباركود هنا', enterkeyhint: 'done', 'aria-label': 'اكتب الباركود',
  });
  const torchBtn = h('button', { class: 'icon-btn scan-torch', type: 'button', 'aria-label': 'الفلاش', onclick: toggleTorch, hidden: true }, icon('flash'));
  const frame = h('div', { class: 'scan-frame' }, h('span', { class: 'scan-laser' }));
  const ui = h('div', { class: 'scanner', role: 'dialog', 'aria-label': title },
    h('div', { class: 'scan-top' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق', onclick: () => ctl.close() }, icon('x')),
      h('div', { class: 'scan-title' }, title),
      torchBtn,
    ),
    frame,
    status,
    h('div', { class: 'scan-bottom' },
      h('form', { class: 'scan-manual', onsubmit: (e) => { e.preventDefault(); const v = manual.value; manual.value = ''; handle(v, true); } },
        manual, h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check', 20), h('span', null, 'تم'))),
      panel,
    ),
  );

  function say(text, kind = '') {
    status.textContent = text || '';
    status.className = `scan-status ${kind}`;
  }

  async function handle(raw, typed = false) {
    if (closed || paused) return;
    const code = normalizeBarcode(raw);
    if (!code) return;
    const now = Date.now();
    if (!typed && code === last.code && now - last.at < REPEAT_MS) { last.at = now; return; }
    last = { code, at: now };
    feedback.ok();
    flash();
    if (!continuous) { if (onCode) onCode(code); ctl.close(); return; }
    const r = onCode && onCode(code);
    if (r && typeof r.then === 'function') {
      paused = true;
      try { await r; } finally { paused = false; last = { code, at: Date.now() }; }
    }
  }

  function flash() {
    frame.classList.remove('hit');
    void frame.offsetWidth;
    frame.classList.add('hit');
  }

  async function toggleTorch() {
    try { await native.toggleTorch(); torchBtn.classList.toggle('on'); } catch { /* بلا فلاش */ }
  }

  async function startNative() {
    try {
      const perm = await native.requestPermissions();
      if (perm.camera !== 'granted' && perm.camera !== 'limited') {
        say('اسمح للتطبيق باستخدام الكاميرا من إعدادات الجوال، أو اكتب الباركود.', 'warn');
        feedback.error();
        return;
      }
      document.documentElement.classList.add('scanning');
      listeners.push(await native.addListener('barcodesScanned', (e) => {
        const b = e.barcodes && e.barcodes[0];
        if (b) handle(b.rawValue || b.displayValue);
      }));
      listeners.push(await native.addListener('scanError', () => say('تعذّرت قراءة الكاميرا، حاول مجددًا', 'warn')));
      await native.startScan({ formats: FORMATS, lensFacing: 'BACK' });
      if (closed) { native.stopScan(); return; }
      try { torchBtn.hidden = !(await native.isTorchAvailable()).available; } catch { /* */ }
      const zoom = await setupZoom(native);
      if (zoom) frame.after(zoom);
      say(SCAN_HINT);
    } catch (e) {
      document.documentElement.classList.remove('scanning');
      say('الماسح يتجهّز لأول مرة (يحتاج إنترنت مرة واحدة). اكتب الباركود الآن.', 'warn');
      console.warn('scanner', e);
    }
  }

  async function startWeb() {
    const BD = globalThis.BarcodeDetector;
    if (!BD || !navigator.mediaDevices?.getUserMedia) {
      say('اكتب الباركود (الكاميرا تعمل في تطبيق الجوال)');
      setTimeout(() => manual.focus(), 100);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
      video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
      video.srcObject = stream;
      ui.prepend(video);
      const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] });
      detectTimer = setInterval(async () => {
        if (paused || video.readyState < 2) return;
        try { const r = await det.detect(video); if (r[0]) handle(r[0].rawValue); } catch { /* إطار غير جاهز */ }
      }, 250);
      say('وجّه الكاميرا نحو الباركود');
    } catch {
      say('لا يمكن فتح الكاميرا. اكتب الباركود.', 'warn');
    }
  }

  const ctl = {
    el: ui,
    pause() { paused = true; },
    resume() { paused = false; },
    /** يحرّر الكاميرا مؤقتًا (لالتقاط صورة للصنف بكاميرا الجوال) ثم يعيدها. */
    async suspendCamera() {
      paused = true;
      if (native) {
        document.documentElement.classList.remove('scanning');
        try { await native.stopScan(); } catch { /* */ }
      }
    },
    async resumeCamera() {
      if (closed) return;
      if (native) {
        try {
          await native.startScan({ formats: FORMATS, lensFacing: 'BACK' });
          document.documentElement.classList.add('scanning');
          await native.setZoomRatio({ zoomRatio: savedZoom() });
        } catch { /* */ }
      }
      paused = false;
    },
    say,
    close() {
      if (closed) return;
      closed = true;
      active = null;
      document.documentElement.classList.remove('scanning');
      if (native) {
        for (const l of listeners) { try { l.remove(); } catch { /* */ } }
        native.stopScan().catch(() => {});
      }
      if (detectTimer) clearInterval(detectTimer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      ui.remove();
      if (onClose) onClose();
    },
  };

  document.body.append(ui);
  active = ctl;
  if (native) startNative(); else startWeb();
  return ctl;
}

/** لزر الرجوع: يغلق الماسح إن كان مفتوحًا. */
export function closeScanner() {
  if (!active) return false;
  active.close();
  return true;
}

export function scannerOpen() {
  return !!active;
}

/** مسح باركود واحد (للبحث أو لحقل الباركود). يرجع الكود أو null إن أُغلق. */
export function scanOnce(title = 'امسح الباركود') {
  return new Promise((resolve) => {
    let got = null;
    openScanner({ title, continuous: false, onCode: (c) => { got = c; }, onClose: () => resolve(got) });
  });
}


/**
 * مسح داخل الشاشة (شاشة البيع): الكاميرا تظهر في مربع box والسلة ظاهرة تحته.
 * على أندرويد المعاينة خلف الصفحة: نجعل الصفحة شفافة ونُبقي باقي العناصر بخلفيات معتمة.
 * يرجع { stop, pause, resume, toggleTorch, torch: boolean } أو null إن لم تتوفر كاميرا.
 */
export async function startInlineScanner({ box, onCode, onStatus = () => {} }) {
  const native = plugin();
  let paused = false;
  let stopped = false;
  let last = { code: '', at: 0 };
  const listeners = [];
  let stream = null;
  let timer = null;
  let overlay = null;

  function handle(raw) {
    if (stopped || paused) return;
    const code = normalizeBarcode(raw);
    if (!code) return;
    const now = Date.now();
    if (code === last.code && now - last.at < REPEAT_MS) { last.at = now; return; }
    last = { code, at: now };
    feedback.ok();
    box.classList.remove('hit'); void box.offsetWidth; box.classList.add('hit');
    onCode(code);
  }

  const ctl = {
    torch: false,
    pause() { paused = true; },
    resume() { paused = false; },
    async toggleTorch() { if (native) { try { await native.toggleTorch(); } catch { /* */ } } },
    async stop() {
      if (stopped) return;
      stopped = true;
      document.documentElement.classList.remove('scanning-inline');
      if (native) {
        for (const l of listeners) { try { l.remove(); } catch { /* */ } }
        try { await native.stopScan(); } catch { /* */ }
      }
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      box.querySelector('video')?.remove();
      if (overlay) { overlay.remove(); overlay = null; }
    },
  };

  if (native) {
    try {
      const perm = await native.requestPermissions();
      if (perm.camera !== 'granted' && perm.camera !== 'limited') { onStatus('اسمح باستخدام الكاميرا من إعدادات الجوال'); return null; }
      listeners.push(await native.addListener('barcodesScanned', (e) => { const b = e.barcodes && e.barcodes[0]; if (b) handle(b.rawValue || b.displayValue); }));
      document.documentElement.classList.add('scanning-inline');
      await native.startScan({ formats: FORMATS, lensFacing: 'BACK' });
      try { ctl.torch = (await native.isTorchAvailable()).available; } catch { /* */ }
      const zoom = await setupZoom(native);
      overlay = h('div', { class: 'cam-overlay' }, h('span', { class: 'cam-hint' }, SCAN_HINT), zoom);
      box.append(overlay);
      onStatus('');
      return ctl;
    } catch (e) {
      await ctl.stop();
      onStatus('الماسح يتجهّز لأول مرة (يحتاج إنترنت مرة واحدة). ابحث بالاسم أو اكتب الباركود.');
      return null;
    }
  }
  const BD = globalThis.BarcodeDetector;
  if (!BD || !navigator.mediaDevices?.getUserMedia) { onStatus('الكاميرا تعمل في تطبيق الجوال — ابحث بالاسم أو اكتب الباركود'); return null; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
    video.srcObject = stream;
    box.prepend(video);
    const det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] });
    timer = setInterval(async () => {
      if (paused || video.readyState < 2) return;
      try { const r = await det.detect(video); if (r[0]) handle(r[0].rawValue); } catch { /* */ }
    }, 250);
    return ctl;
  } catch {
    onStatus('لا يمكن فتح الكاميرا — ابحث بالاسم أو اكتب الباركود');
    return null;
  }
}
