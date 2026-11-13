// سياق التطبيق: قاعدة البيانات، طبقة الكتابة، المزامنة، المحل الحالي وميزاته.
// تستورده كل الوحدات: import { app } from '../../core/app.js'
import { createDb } from './db.js';
import { createStore } from './store.js';
import { uuid } from './ids.js';
import { bus } from './bus.js';
import { config } from './config.js';
import { makeClock } from '../domain/merge.js';
import { resolveFeatures, defaultPaymentMethods, TRIAL_DAYS } from '../domain/features.js';
import { createSupabase } from '../sync/supabase.js';
import { createSyncEngine } from '../sync/engine.js';
import { startScheduler } from '../sync/scheduler.js';
import { createMediaSync } from '../sync/media.js';
import { createMedia } from './media.js';
import { createProductRepo } from '../features/products/repo.js';

const clock = makeClock();

export const app = {
  db: null,
  store: null,
  sync: null,
  scheduler: null,
  products: null,
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

  /** صلاحيات (المرحلة 2: الكاشير لا يرى الربح ولا التكلفة). الآن صاحب المحل فقط. */
  can(action) {
    const role = app.ctx.role;
    if (role === 'owner' || role === 'manager') return true;
    return !['see_profit', 'see_cost', 'settings', 'delete'].includes(action);
  },

  feature(name) {
    return !!app.features[name];
  },

  async boot() {
    const native = globalThis.Capacitor?.Plugins?.AppInfo;
    if (native) {
      try {
        const i = await native.get();
        app.info = { flavor: i.flavor, version: i.versionName, build: i.versionCode, sdk: i.sdk };
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
    });
    const deps = { db: app.db, store: app.store, getContext: () => app.ctx };
    app.products = createProductRepo(deps);
    app.media = createMedia(deps);
    if (app.ctx.shopId) await app.loadShop();
    app.startSync();
    bus.on('data', async (e) => {
      if (e.tables.includes('shops')) await app.loadShop();
      if (e.prefixChanged) app.ctx.prefix = e.prefixChanged;
    });
    return app;
  },

  async loadShop() {
    app.shop = await app.db.shops.get(app.ctx.shopId);
    app.features = resolveFeatures(app.shop?.shop_type, app.shop?.settings?.features);
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
    app.sync = createSyncEngine({ db: app.db, api, getContext: () => app.ctx, emit: (e) => bus.emit('data', e) });
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
