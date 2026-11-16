// قراءة الباركود من الكاميرا في المتصفح (نسخة الويب: آيفون، آيباد، أي جوال أو حاسوب).
// BarcodeDetector المدمج إن وُجد (كروم أندرويد)، وإلا ZXing (WebAssembly) من vendor/zxing —
// سفاري آيفون لا يملك BarcodeDetector. ZXing يُحمَّل عند أول فتح للكاميرا فقط، ولا يُشحن إلا في نسخة الويب.
// يرجع { detect(video) → Promise<string[]> } أو null إن لم تتوفر قراءة.

const FORMATS_NATIVE = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
const FORMATS_ZXING = ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'ITF'];
const MAX_W = 960; // تصغير الإطار قبل القراءة: أسرع، والباركود ما زال واضحًا

let pending = null;

export function createDetector() {
  if (!pending) {
    pending = build().catch((e) => { console.warn('detector', e); return null; });
    pending.then((d) => { if (!d) pending = null; });
  }
  return pending;
}

async function build() {
  const BD = globalThis.BarcodeDetector;
  if (BD) {
    try {
      const supported = typeof BD.getSupportedFormats === 'function' ? await BD.getSupportedFormats() : FORMATS_NATIVE;
      const formats = FORMATS_NATIVE.filter((f) => supported.includes(f));
      if (formats.includes('ean_13')) {
        const d = new BD({ formats });
        return { kind: 'native', detect: async (video) => (await d.detect(video)).map((r) => r.rawValue) };
      }
    } catch { /* ننزل إلى ZXing */ }
  }
  const Z = await loadZxing();
  if (!Z) return null;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  return {
    kind: 'zxing',
    async detect(video) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return [];
      const k = Math.min(1, MAX_W / vw);
      canvas.width = Math.round(vw * k);
      canvas.height = Math.round(vh * k);
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      const res = await Z.readBarcodes(img, { formats: FORMATS_ZXING, tryHarder: true, maxNumberOfSymbols: 1 });
      return res.filter((r) => r.isValid && r.text).map((r) => r.text);
    },
  };
}

function base() {
  return new URL('vendor/zxing/', document.baseURI).href;
}

async function loadZxing() {
  if (!globalThis.ZXingWASM) {
    const ok = await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `${base()}zxing_reader.js`;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.append(s);
    });
    if (!ok || !globalThis.ZXingWASM) return null;
  }
  const Z = globalThis.ZXingWASM;
  await Z.prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? `${base()}${path}` : prefix + path) },
    fireImmediately: true,
  });
  return Z;
}

/** فيديو كاميرا خلفية جاهز للتشغيل داخل الصفحة (آيفون يحتاج playsinline و muted). */
export function cameraVideo(cls) {
  const v = document.createElement('video');
  v.className = cls;
  v.setAttribute('playsinline', '');
  v.setAttribute('muted', '');
  v.muted = true;
  v.autoplay = true;
  return v;
}

export function cameraStream() {
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
}
