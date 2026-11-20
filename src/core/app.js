// سياق التطبيق: قاعدة البيانات، طبقة الكتابة، المزامنة، المحل الحالي وميزاته.
// تستورده كل الوحدات: import { app } from '../../core/app.js'
import { createDb } from './db.js';
import { createStore } from './store.js';
import { uuid } from './ids.js';
import { bus } from './bus.js';
import { config } from './config.js';
import { makeClock } from '../domain/merge.js';
import { resolveFeatures, defaultPaymentMethods } from '../domain/features.js';
import { TRIAL_DAYS } from '../domain/license.js';
import { allowed, userById } from '../domain/staff.js';
import { createLicense } from './license.js';
import { createAccount } from './account.js';
import { createSms } from './sms.js';
import { createReminders } from './reminders.js';
import { createSupabase } from '../sync/supabase.js';
import { createSyncEngine } from '../sync/engine.js';
import { startScheduler } from '../sync/scheduler.js';
import { createMediaSync } from '../sync/media.js';
import { createMedia } from './media.js';
import { createProductRepo } from '../features/products/repo.js';
import { createSaleRepo } from '../features/sale/repo.js';
import { createCustomerRepo } from '../features/customers/repo.js';
import { createInventoryRepo } from '../features/inventory/repo.js';
import { createCashRepo } from '../features/cash/repo.js';
import { createWalletRepo } from '../features/wallet/repo.js';
import { createDues } from './dues.js';
import { createExpenseRepo } from '../features/expenses/repo.js';
import { createPayroll } from './payroll.js';
import { createChat } from './chat.js';

const clock = makeClock();

export const app = {
  db: null,
  store: null,
  sync: null,
  scheduler: null,
  products: null,
  license: null,
  account: null,
  media: null,
  mediaSync: null,
  shop: null,
  features: {},
  ctx: { shopId: null, deviceId: null, prefix: 'A', userId: null, role: 'owner', deviceName: null },
  clock,
  config,
  bus,
  /** معلومات النسخة: من الإعدادات، ثم من أندرويد نفسه (نوع النسخة direct/play ورقم البناء). */
  info: { flavor: config.flavor, version: config.version, build: config.build },

  meta: {
    async get(key, def = null) { return (await app.db.meta.get(key))?.value ?? def; },
    set(key, value) { return app.db.meta.put({ key, value }); },
  },

  /** من يستعمل هذا الجهاز الآن: null = صاحب المحل (أو المحل بلا موظفين)، أو { owner } أو عضو. */
  user: null,

  /** إعداد الموظفين (settings.staff) أو null. */
  get staff() {
    const s = app.shop?.settings?.staff;
    return s && s.enabled ? s : null;
  },

  /** الموظفون مفعّلون ولا أحد دخل على هذا الجهاز: تظهر شاشة القفل. */
  get locked() {
    return !!(app.staff && !app.user);
  },

  /** صلاحيات: صاحب المحل كل شيء، والموظف ما أعطاه صاحب المحل فقط (domain/staff.js). */
  can(action) {
    if (!app.staff) return true;
    if (!app.user) return false;
    return allowed(app.user, action);
  },

  /** يدخل شخص (id = 'owner' أو معرّف موظف) أو يقفل الجهاز (null). كل ما يُحفظ بعدها يحمل اسمه. */
  async setUser(id) {
    app.user = id ? userById(app.shop?.settings?.staff, id) : null;
    app.ctx.userId = app.user && !app.user.owner ? app.user.id : null;
    app.ctx.role = !app.user || app.user.owner ? 'owner' : 'staff';
    await app.meta.set('staff:current', app.user ? app.user.id : null);
    bus.emit('user', app.user);
  },

  feature(name) {
    return !!app.features[name];
  },

  async boot() {
    // نسخة الحاسوب (Electron): رقم الجهاز وتاريخ التثبيت من ويندوز عبر preload.js
    const desk = globalThis.cashierDesktop;
    if (desk) {
      try {
        const i = await desk.info();
        app.info = { ...app.info, flavor: 'desktop', version: i.version || app.info.version, deviceKey: i.deviceKey, installedAt: i.installedAt, os: i.os };
      } catch { /* يبقى ما في الإعدادات */ }
    }
    const native = globalThis.Capacitor?.Plugins?.AppInfo;
    if (native) {
      try {
        const i = await native.get();
        app.info = { flavor: i.flavor, version: i.versionName, build: i.versionCode, sdk: i.sdk, deviceKey: i.deviceKey, installedAt: i.installedAt };
      } catch { /* المتصفح */ }
    }
    app.db = createDb(globalThis.Dexie);
    await app.db.open();
    let deviceId = await app.meta.get('deviceId');
    if (!deviceId) {
      deviceId = uuid();
      await app.meta.set('deviceId', deviceId);
    }
    app.ctx.deviceId = deviceId;
    app.ctx.prefix = await app.meta.get('devicePrefix', 'A');
    app.ctx.shopId = await app.meta.get('shopId');
    app.store = createStore({
      db: app.db, clock, getContext: () => app.ctx,
      emit: (e) => bus.emit('data', e),
      guard: (table) => app.license && app.license.guard(table),
    });
    const deps = { db: app.db, store: app.store, getContext: () => app.ctx };
    app.products = createProductRepo(deps);
    app.media = createMedia(deps);
    app.sales = createSaleRepo({ ...deps, clock });
    app.customers = createCustomerRepo(deps);
    app.inventory = createInventoryRepo({ ...deps, clock });
    app.cash = createCashRepo({ ...deps, clock });
    app.expenses = createExpenseRepo({ ...deps, clock });
    app.wallet = createWalletRepo({ ...deps, customers: app.customers });
    if (app.ctx.shopId) await app.loadShop();
    app.license = createLicense({
      meta: app.meta, info: app.info, deviceId, shopCreatedAt: app.shop?.created_at || null,
      emit: (s) => bus.emit('license', s),
      billing: globalThis.Capacitor?.Plugins?.CashierBilling || null,
    });
    await app.license.init();
    app.startSync();
    app.account = createAccount(app);
    await app.account.init();
    app.sms = createSms(app, { toast: (...a) => bus.emit('toast', a) });
    app.reminders = createReminders(app, { toast: (...a) => bus.emit('toast', a), emit: () => bus.emit('reminders', app.reminders.due) });
    app.dues = createDues(app, { toast: (...a) => bus.emit('toast', a), emit: () => bus.emit('dues') });
    app.payroll = createPayroll(app, { toast: (...a) => bus.emit('toast', a) });
    app.chat = createChat(app, { toast: (...a) => bus.emit('toast', a) });
    bus.on('data', async (e) => {
      if (e.tables.includes('shops')) await app.loadShop();
      if (e.prefixChanged) app.ctx.prefix = e.prefixChanged;
    });
    return app;
  },

  async loadShop() {
    app.shop = await app.db.shops.get(app.ctx.shopId);
    app.features = resolveFeatures(app.shop?.shop_type, app.shop?.settings?.features);
    // الموظف الحالي: من الجهاز، ويُعاد من إعداد المحل (صلاحياته تتغير من جهاز صاحب المحل)
    const id = await app.meta.get('staff:current');
    app.user = app.staff ? userById(app.staff, id) : null;
    app.ctx.userId = app.user && !app.user.owner ? app.user.id : null;
    app.ctx.role = !app.user || app.user.owner ? 'owner' : 'staff';
    bus.emit('shop', app.shop);
  },

  startSync() {
    if (!config.syncEnabled) {
      app.sync = disabledSync();
      return;
    }
    const api = createSupabase({
      url: config.supabaseUrl,
      anonKey: config.supabaseAnonKey,
      loadSession: () => app.meta.get('auth'),
      saveSession: (s) => app.meta.set('auth', s),
    });
    app.api = api;
    app.sync = createSyncEngine({ db: app.db, api, getContext: () => app.ctx, emit: (e) => bus.emit('data', e), gate: (a) => app.license.gate(a) });
    app.mediaSync = createMediaSync({ db: app.db, api });
    app.sync.onStatus((s) => {
      bus.emit('sync', s);
      if (s.state === 'synced') app.mediaSync.run(); // الصور والكتالوج بعد كل مزامنة ناجحة
    });
    app.scheduler = startScheduler(app.sync, { bus });
  },

  /** الإعداد الأول: ينشئ المحل وكل ما يلزمه في معاملة واحدة، بلا إنترنت. */
  async createShop({ name, phone, shopType }) {
    const shopId = uuid();
    const now = new Date();
    const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 86400000).toISOString();
    app.ctx.shopId = shopId;
    await app.store.write(async (w) => {
      await w.put('shops', {
        id: shopId, name: name.trim(), phone: phone?.trim() || null, shop_type: shopType, base_currency: 'ILS',
        settings: {
          features: resolveFeatures(shopType),
          rates: { USD: null, JOD: null },
          trialEndsAt: trialEnds,
          createdOnDevice: app.ctx.deviceId,
        },
      });
      await w.put('branches', { name: 'المحل الرئيسي', is_main: true });
      let sort = 0;
      for (const m of defaultPaymentMethods()) {
        await w.put('payment_methods', { name: m.name, kind: m.kind, fee_bp: m.fee_bp, sort: sort++ });
      }
      await app.db.meta.put({ key: 'shopId', value: shopId });
      await app.db.meta.put({ key: 'devicePrefix', value: app.ctx.prefix });
    });
    await app.loadShop();
    return shopId;
  },

  /** اسم مقترح لباركود من الكتالوج المشترك (null بلا إنترنت أو بلا مزامنة). */
  async catalogLookup(barcode) {
    if (!app.mediaSync || navigator.onLine === false) return null;
    return app.mediaSync.lookup(barcode);
  },

  /** يحفظ إعدادات المحل (دمج سطحي داخل settings). */
  async updateShopSettings(patch) {
    const settings = { ...(app.shop.settings || {}), ...patch };
    await app.store.patch('shops', app.shop.id, { settings });
    await app.loadShop();
  },
};

function disabledSync() {
  const status = { state: 'disabled', pending: 0, lastSyncAt: null, error: null };
  return {
    status,
    run: async () => ({ skipped: 'disabled' }),
    onStatus(fn) { fn(status); return () => {}; },
    refreshPending: async () => {},
  };
}
