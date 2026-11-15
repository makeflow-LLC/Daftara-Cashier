// الحساب: يربط المحل برقم هاتف وكلمة سر على الخادم، ويدخل به من جهاز جديد فتنزل البيانات كاملة.
// الجهاز يبقى «مجهولًا» عند الخادم؛ الدخول يجعله عضوًا في المحل (cashier_account_login).
import { HttpError } from '../sync/supabase.js';
import { accountPhone, passwordProblem, loginProblem, extractResetCode } from '../domain/account.js';

/** kind: 'input' (خطأ في ما كتبه المستخدم) | 'offline' | 'server' (خلل لا يحلّه المستخدم الآن) */
export class AccountError extends Error {
  constructor(message, kind = 'input') { super(message); this.kind = kind; }
}

export const PRIVACY_URL = 'https://makeflow.tech/apps/cashier/privacy.html';
export const TERMS_URL = 'https://makeflow.tech/apps/cashier/terms.html';

export const OFFLINE = 'تحتاج إنترنت لهذه الخطوة — اتصل ثم حاول';

function friendly(e) {
  if (e instanceof AccountError) return e;
  if (e instanceof HttpError) {
    if (e.status === 0 || e.transient) return new AccountError(OFFLINE, 'offline');
    const code = e.body && e.body.code;
    if (code === '23505') return new AccountError('هذا الرقم مسجّل لمحل آخر');
    if (code === '42501') return new AccountError('هذا الجهاز ليس صاحب المحل', 'server');
  }
  return new AccountError('حدث خطأ، حاول مرة أخرى', 'server');
}

export function createAccount(app) {
  const api = () => {
    if (!app.api) throw new AccountError('الحساب يحتاج نسخة التطبيق المتصلة بالخادم');
    return app.api;
  };
  async function session() {
    const a = api();
    try { if (!(await a.auth.getSession())) await a.auth.signInAnonymously(); } catch (e) { throw friendly(e); }
    return a;
  }

  let cached = null;   // رقم الحساب المحفوظ على الجهاز (يُقرأ فورًا في حارس التنقل)
  let skipped = false; // «تابع بلا إنترنت» لهذه الجلسة فقط: عند الفتح القادم يُطلب الحساب من جديد
  const remember = async (phone) => { cached = phone; await app.meta.set('account:phone', phone); };

  return {
    /** يُستدعى عند بدء التطبيق. */
    async init() { cached = await app.meta.get('account:phone'); },
    /** الحساب إلزامي: محل بلا حساب (والنسخة متصلة بالخادم) لا يُستعمل حتى يُنشأ حسابه. */
    get required() { return !!(app.config.syncEnabled && app.ctx.shopId && !cached && !skipped); },
    /** بلا إنترنت الآن: يُسمح بالعمل هذه الجلسة، ويُطلب الحساب عند الفتح القادم. */
    skipForNow() { skipped = true; },
    /** الرقم المحفوظ على هذا الجهاز (أو null). */
    phone: () => app.meta.get('account:phone'),

    /** يسأل الخادم (إن أمكن) عن الرقم المحفوظ للمحل — مفيد على جهاز ثانٍ. */
    async refresh() {
      if (!app.api || !app.ctx.shopId) return app.meta.get('account:phone');
      try {
        const r = await app.api.rest.rpc('cashier_account_get', { p_shop: app.ctx.shopId });
        if (r && r.phone) await remember(r.phone);
      } catch { /* بلا إنترنت: نبقى على المحفوظ */ }
      return app.meta.get('account:phone');
    },

    /** يحمي المحل برقم وكلمة سر (أو يغيّرهما). */
    async protect(rawPhone, password, confirm) {
      const phone = accountPhone(rawPhone);
      if (!phone) throw new AccountError('اكتب رقم جوال صحيحًا');
      const bad = passwordProblem(password, confirm);
      if (bad) throw new AccountError(bad);
      api();
      // المحل يجب أن يكون مسجّلًا على الخادم أولًا (أول مزامنة)
      const s = await app.sync.run();
      if (s && s.error) throw friendly(s.error);
      try {
        await app.api.rest.rpc('cashier_account_set', { p_shop: app.ctx.shopId, p_phone: phone, p_password: password });
      } catch (e) { throw friendly(e); }
      await remember(phone);
      return phone;
    },

    /** الدخول من جهاز جديد. عند النجاح تكون بيانات المحل نزلت على الجهاز. */
    async login(rawPhone, password) {
      const phone = accountPhone(rawPhone);
      if (!phone) throw new AccountError('اكتب رقم جوال صحيحًا');
      if (!password) throw new AccountError('اكتب كلمة السر');
      const a = await session();
      let r;
      try { r = await a.rest.rpc('cashier_account_login', { p_phone: phone, p_password: password }); } catch (e) { throw friendly(e); }
      if (!r || !r.ok) throw new AccountError(loginProblem(r));
      // ننزّل بيانات المحل قبل حفظه على الجهاز: إن انقطع الإنترنت لا يبقى الجهاز على محل فارغ
      app.ctx.shopId = r.shop_id;
      const s = await app.sync.run();
      const shop = await app.db.shops.get(r.shop_id);
      if ((s && s.error) || !shop) {
        app.ctx.shopId = null;
        for (const k of (await app.db.meta.toCollection().primaryKeys())) if (String(k).startsWith('cursor:') || k === 'remote') await app.db.meta.delete(k);
        throw s && s.error ? friendly(s.error) : new AccountError('لم تنزل بيانات المحل، حاول مرة أخرى');
      }
      await app.meta.set('shopId', r.shop_id);
      await remember(phone);
      return { shopId: r.shop_id, name: r.name };
    },

    /** نسيت كلمة السر (1): رقم الطلب الذي يُرسل لـ MakeFlow. */
    async resetRequest(rawPhone) {
      const phone = accountPhone(rawPhone);
      if (!phone) throw new AccountError('اكتب رقم جوال صحيحًا');
      const a = await session();
      let req;
      try { req = await a.rest.rpc('cashier_account_reset_request', { p_phone: phone }); } catch (e) { throw friendly(e); }
      if (!req) throw new AccountError('هذا الرقم غير مسجّل');
      return { phone, request: req };
    },

    /** نسيت كلمة السر (2): كود MakeFlow + كلمة السر الجديدة. */
    async reset(rawPhone, codeText, password, confirm) {
      const phone = accountPhone(rawPhone);
      const code = extractResetCode(codeText);
      if (!phone) throw new AccountError('اكتب رقم جوال صحيحًا');
      if (!code) throw new AccountError('الصق الكود الذي وصلك كاملًا');
      const bad = passwordProblem(password, confirm);
      if (bad) throw new AccountError(bad);
      const a = await session();
      let r;
      try { r = await a.rest.rpc('cashier_account_reset', { p_phone: phone, p_code: code, p_password: password }); } catch (e) { throw friendly(e); }
      if (!r || !r.ok) throw new AccountError('الكود غير صحيح أو استُعمل من قبل');
      return true;
    },
  };
}
