// الترخيص (نقي): 30 يومًا تجربة من لحظة التنزيل، ثم اشتراك شهري أو سنوي. بعد الانتهاء: قراءة فقط.
//
// لماذا لا يُخترق كما حصل في دفترة (تعديل رقم داخل الكود):
//  1. كود التفعيل توقيع Ed25519 من MakeFlow على رقم هذا الجهاز وتاريخ الانتهاء؛ التطبيق يحمل المفتاح العام فقط.
//  2. التطبيق يرفض العمل إن عُدّل ملف APK (توقيع الملف يُفحص في كود أندرويد نفسه، لا في هذه الصفحات).
//  3. الخادم نفسه يرفض رفع بيانات محل بلا اشتراك سارٍ: نسخة معدّلة لا تحصل على مزامنة ولا نسخ سحابي ولا جهاز ثانٍ.
//  4. الوقت لا يرجع للوراء: آخر وقت رآه التطبيق محفوظ، وتاريخ التثبيت يأتي من أندرويد أيضًا.

export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 3;
export const PRICES = Object.freeze({ monthly: 3000, yearly: 30000 }); // بالأغورة
export const PLAN_LABEL = Object.freeze({ monthly: 'شهري', yearly: 'سنوي', trial: 'تجربة', m: 'شهري', y: 'سنوي' });
export const LICENSE_PREFIX = 'DCS-';
export const SIGN_CONTEXT = 'cashier-license-v1|';
const DAY = 86400000;

/** الجداول التي تُقفل في وضع القراءة فقط. تبقى مفتوحة: الدفعات وقيود الحسابات والصندوق وإعدادات المحل. */
export const LOCKED_TABLES = Object.freeze(['invoices', 'invoice_lines', 'movements', 'products', 'product_units', 'product_images', 'price_history', 'customers', 'suppliers', 'stock_counts', 'categories']);

/** الوقت الموثوق: لا يرجع للوراء إن أرجع المستخدم ساعة الجوال. */
export function trustedNow(now, lastSeen) {
  return Math.max(now, lastSeen || 0);
}

function ms(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * الحالة الآن. كل الأوقات ISO أو ملّي ثانية:
 *   installedAt   أقدم ما نعرفه: تثبيت التطبيق أو إنشاء المحل
 *   server        آخر ما قاله الخادم: { is_active, plan, expires_at, trial_ends_at } أو null
 *   code          كود تفعيل تحقّقنا منه: { expiresAt, plan } أو null
 *   play          اشتراك Google Play: { active, plan } أو null
 * يرجع { status: 'trial'|'active'|'grace'|'expired'|'blocked', readOnly, daysLeft, until, plan }.
 */
export function licenseState({ now, installedAt, server = null, code = null, play = null }) {
  if (server && server.is_active === false) return { status: 'blocked', readOnly: true, daysLeft: 0, until: null, plan: server.plan || null };
  const paid = [];
  if (server && ms(server.expires_at)) paid.push([ms(server.expires_at), server.plan]);
  if (code && ms(code.expiresAt)) paid.push([ms(code.expiresAt), code.plan]);
  if (play && play.active) paid.push([now + 2 * DAY, play.plan]);
  paid.sort((a, b) => b[0] - a[0]);
  const days = (t) => Math.max(0, Math.ceil((t - now) / DAY));
  if (paid.length) {
    const [until, plan] = paid[0];
    if (now <= until) return { status: 'active', readOnly: false, daysLeft: days(until), until, plan: plan || null };
    if (now <= until + GRACE_DAYS * DAY) return { status: 'grace', readOnly: false, daysLeft: days(until + GRACE_DAYS * DAY), until, plan: plan || null };
  }
  let trialEnd = (ms(installedAt) ?? now) + TRIAL_DAYS * DAY;
  if (server && ms(server.trial_ends_at) !== null) trialEnd = Math.min(trialEnd, ms(server.trial_ends_at));
  if (now < trialEnd) return { status: 'trial', readOnly: false, daysLeft: days(trialEnd), until: trialEnd, plan: 'trial' };
  return { status: 'expired', readOnly: true, daysLeft: 0, until: paid.length ? paid[0][0] : trialEnd, plan: null };
}

// ---------- رقم الجهاز ----------
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // بلا 0 O 1 I
/** نص سداسي (بصمة معرّف الجهاز) → رقم قصير يُقرأ ويُكتب بسهولة: XXXXX-XXXXX */
export function deviceCode(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '').padEnd(16, '0').slice(0, 16);
  let n = BigInt(`0x${clean}`);
  let s = '';
  for (let i = 0; i < 10; i++) { s = ALPHABET[Number(n % 32n)] + s; n /= 32n; }
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

// ---------- كود التفعيل ----------
const enc = new TextEncoder();
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
export function unb64(str) {
  return Uint8Array.from(atob(str.trim()), (c) => c.charCodeAt(0));
}

/** الرسالة الموقَّعة لكود: رقم الجهاز | تاريخ الانتهاء YYYYMMDD | الخطة (m أو y). */
export function codePayload({ device, expires, plan }) {
  return `${device}|${expires}|${plan}`;
}

/** يصنع كودًا (لأداة MakeFlow والاختبارات). sign(messageBytes) → توقيع 64 بايت. */
export function makeCode({ device, expires, plan }, sign) {
  const payload = codePayload({ device, expires, plan });
  return `${LICENSE_PREFIX}${b64url(enc.encode(payload))}.${b64url(sign(enc.encode(SIGN_CONTEXT + payload)))}`;
}

/** يستخرج الكود من رسالة واتساب كاملة إن لُصقت كما هي. */
export function extractCode(text) {
  const m = /DCS-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(String(text || ''));
  return m ? m[0] : null;
}

/**
 * يتحقق من كود تفعيل لهذا الجهاز. verify(msg, sig, publicKey) من مكتبة التوقيع.
 * يرجع { ok: true, expiresAt (ISO نهاية اليوم), plan } أو { ok: false, reason } بالعربية.
 */
export function verifyCode(text, { device, publicKey, verify, now = Date.now() }) {
  const code = extractCode(text);
  if (!code) return { ok: false, reason: 'لم نجد كود تفعيل في النص' };
  let payload, sig;
  try {
    const [p, s] = code.slice(LICENSE_PREFIX.length).split('.');
    payload = new TextDecoder().decode(unb64url(p));
    sig = unb64url(s);
  } catch { return { ok: false, reason: 'الكود غير مكتمل — انسخه كاملًا' }; }
  const parts = payload.split('|');
  if (parts.length !== 3 || sig.length !== 64 || !/^\d{8}$/.test(parts[1])) return { ok: false, reason: 'الكود غير صحيح' };
  let good = false;
  try { good = verify(enc.encode(SIGN_CONTEXT + payload), sig, publicKey); } catch { good = false; }
  if (!good) return { ok: false, reason: 'الكود غير صحيح' };
  if (parts[0] !== device) return { ok: false, reason: 'هذا الكود لجهاز آخر' };
  const e = parts[1];
  const expiresAt = new Date(Number(e.slice(0, 4)), Number(e.slice(4, 6)) - 1, Number(e.slice(6, 8)), 23, 59, 59).toISOString();
  if (Date.parse(expiresAt) < now) return { ok: false, reason: 'انتهت مدة هذا الكود' };
  return { ok: true, expiresAt, plan: parts[2] === 'y' ? 'yearly' : 'monthly', code };
}

/** رسالة طلب الاشتراك التي يرسلها صاحب المحل على واتساب. */
export function subscribeMessage({ shopName, device, plan, shopId, until = null }) {
  const d = until ? new Date(until) : null;
  const two = (x) => String(x).padStart(2, '0');
  return `مرحبًا، أريد الاشتراك في دفترة كاشير (${PLAN_LABEL[plan]} — ${plan === 'yearly' ? '300' : '30'} شيكل)\nالمحل: ${shopName}\nرقم الجهاز: ${device}`
    + (d ? `\nالاشتراك الحالي حتى: ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` : '')
    + (shopId ? `\nرقم المحل: ${shopId}` : '');
}
