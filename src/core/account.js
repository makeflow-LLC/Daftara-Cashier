// الحساب: يربط المحل برقم هاتف وكلمة سر على الخادم، ويدخل به من جهاز جديد فتنزل البيانات كاملة.
// الجهاز يبقى «مجهولًا» عند الخادم؛ الدخول يجعله عضوًا في المحل (cashier_account_login).
import { HttpError } from '../sync/supabase.js';
import { accountPhone, passwordProblem, loginProblem, extractResetCode, accountStage } from '../domain/account.js';
import { snapshotDevice, clearShopData, restoreDevice } from './backup.js';

/** kind: 'input' (خطأ في ما كتبه المستخدم) | 'taken' (الرقم له حساب من قبل) | 'offline' | 'server' (خلل لا يحلّه المستخدم الآن) */
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
    if (code === '23505') return new AccountError('هذا الرقم مسجّل لمحل آخر — إن كان حسابك فاضغط «عندي حساب»', 'taken');
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
  let stage = 'explore'; // مرحلة المحل: يتجول بحرية ← تذكير لطيف ← الحساب مطلوب
  const remember = async (phone) => { cached = phone; await app.meta.set('account:phone', phone); };

  /** يحسب المرحلة من عدد فواتير البيع وعمر المحل (يُستدعى عند الفتح ومع كل تنقّل). */
  async function check() {
    if (!app.ctx.shopId || cached) return stage;
    try {
      const [sales, shop] = await Promise.all([
        app.db.invoices.where('type').equals('sale').count(),
        app.db.shops.get(app.ctx.shopId),
      ]);
      stage = accountStage({ sales, createdAt: shop?.created_at || null });
    } catch (e) { console.error(e); }
    return stage;
  }

  return {
    /** يُستدعى عند بدء التطبيق. */
    async init() { cached = await app.meta.get('account:phone'); await check(); },
    check,
    /** 'explore' | 'nudge' | 'required' — آخر ما حسبه check(). */
    get stage() { return stage; },
    /** هل يحتاج المحل حسابًا؟ (النسخة متصلة بالخادم، ولا حساب على الجهاز) */
    get missing() { return !!(app.config.syncEnabled && app.ctx.shopId && !cached); },
    /** الحساب مطلوب الآن: بعد فترة التجربة الحرة لا تُفتح الشاشات حتى يُنشأ (إلا «لاحقًا» بلا إنترنت). */
    get required() { return this.missing && !skipped && stage === 'required'; },
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
      // على الجهاز محل آخر (جرّب التطبيق هنا قبل أن يدخل بحسابه): يُستبدل ببيانات الحساب،
      // فلا تختلط أصناف المحلّين. نحتفظ بنسخة في الذاكرة ونرجع إليها إن لم تنزل البيانات.
      const prev = app.ctx.shopId || null;
      const replacing = !!prev && prev !== r.shop_id;
      const snap = replacing ? await snapshotDevice(app.db) : null;
      if (replacing) await clearShopData(app.db);
      // ننزّل بيانات المحل قبل حفظه على الجهاز: إن انقطع الإنترنت لا يبقى الجهاز على محل فارغ
      app.ctx.shopId = r.shop_id;
      const s = await app.sync.run();
      const shop = await app.db.shops.get(r.shop_id);
      if ((s && s.error) || !shop) {
        app.ctx.shopId = prev;
        if (replacing) await restoreDevice(app.db, snap);
        else for (const k of (await app.db.meta.toCollection().primaryKeys())) if (String(k).startsWith('cursor:') || k === 'remote') await app.db.meta.delete(k);
        throw s && s.error ? friendly(s.error) : new AccountError('لم تنزل بيانات المحل، حاول مرة أخرى');
      }
      await app.meta.set('shopId', r.shop_id);
      // حرف فواتير هذا الجهاز في المحل الذي دخله (الخادم يعطيه عند التسجيل)
      const reg = await app.meta.get('remote');
      if (reg && reg.prefix) { await app.meta.set('devicePrefix', reg.prefix); app.ctx.prefix = reg.prefix; }
      await remember(phone);
      return { shopId: r.shop_id, name: r.name, replaced: replacing };
    },

    /**
     * ما على هذا الجهاز الآن (قبل الدخول بحساب آخر): { name, products, sales } أو null إن لم يكن عليه محل.
     * يُعرض لصاحب المحل حتى يعرف ما الذي سيُستبدل.
     */
    async localShop() {
      if (!app.ctx.shopId) return null;
      const [shop, products, sales] = await Promise.all([
        app.db.shops.get(app.ctx.shopId),
        app.db.products.filter((p) => !p.deleted).count(),
        app.db.invoices.where('type').equals('sale').count(),
      ]);
      return { name: shop ? shop.name : '', products, sales };
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
