// الدخول برقم الهاتف وكلمة سر (نقي): تطبيع الرقم، شروط كلمة السر، ونصوص «نسيت كلمة السر».
import { normalizePhone } from './ledger.js';

export const MIN_PASSWORD = 6;
export const RESET_PREFIX = 'DCR-';
export const RESET_CONTEXT = 'cashier-reset-v1|';

/** رقم الحساب بالصيغة الدولية بلا + (970599123456)، أو null إن لم يكن رقمًا صالحًا. */
export function accountPhone(raw) {
  const d = normalizePhone(raw);
  return /^[0-9]{9,15}$/.test(d) ? d : null;
}

/** للعرض: 970599123456 ← 0599123456 */
export function displayPhone(phone) {
  if (!phone) return '';
  return phone.startsWith('970') || phone.startsWith('972') ? `0${phone.slice(3)}` : `+${phone}`;
}

/** رسالة خطأ بالعربية أو null. */
export function passwordProblem(pw, confirm) {
  if (String(pw || '').length < MIN_PASSWORD) return `كلمة السر ${MIN_PASSWORD} أحرف أو أرقام على الأقل`;
  if (confirm !== undefined && pw !== confirm) return 'كلمتا السر غير متطابقتين';
  return null;
}

/** رسالة واتساب لـ MakeFlow حين ينسى صاحب المحل كلمة السر. */
export function resetRequestMessage({ phone, request, shopName }) {
  return `مرحبًا، نسيت كلمة سر دفترة كاشير${shopName ? ` (${shopName})` : ''}\nرقم الحساب: ${phone}\nرقم الطلب: ${request}`;
}

/** من رسالة كاملة: الرقم ورقم الطلب (لصفحة MakeFlow). */
export function parseResetRequest(text) {
  const t = String(text || '');
  const phone = (/رقم الحساب:\s*([0-9]{9,15})/.exec(t) || [])[1] || null;
  const request = (/([0-9A-F]{4}-[0-9A-F]{4})/.exec(t.toUpperCase()) || [])[1] || null;
  return phone && request ? { phone, request } : null;
}

/** الرسالة الموقَّعة لكود إعادة التعيين. */
export function resetMessage(phone, request) {
  return `${RESET_CONTEXT}${phone}|${request}`;
}

export function extractResetCode(text) {
  const m = /DCR-[A-Za-z0-9_-]{80,90}/.exec(String(text || '').replace(/\s+/g, ''));
  return m ? m[0] : null;
}

/** يترجم ردود الخادم إلى رسائل يفهمها صاحب المحل. */
export function loginProblem(r) {
  if (!r) return 'تعذّر الاتصال — تأكد من الإنترنت';
  if (r.reason === 'locked') {
    const m = Math.ceil((r.wait || 30) / 60);
    return `محاولات كثيرة خاطئة. انتظر ${m} ${m === 1 ? 'دقيقة' : 'دقائق'} ثم حاول`;
  }
  return 'الرقم أو كلمة السر غير صحيحة';
}
