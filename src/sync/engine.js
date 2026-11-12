// محرك المزامنة: يرفع ما في outbox ثم يسحب الجديد من الخادم. لا يوقف المستخدم أبدًا:
// كل شيء محفوظ على الجهاز أولًا، والمزامنة تعمل بصمت متى توفّر الإنترنت.
//
//   رفع: أقدم ما في outbox أولًا، مجمّعًا حسب الجدول (الآباء قبل الأبناء)، دفعات صغيرة.
//        خطأ شبكة → نتوقف ونعيد لاحقًا. خطأ في سجل بعينه → نعزله (dead) ونكمل الباقي.
//   سحب: سؤال واحد «ما آخر رقم لكل جدول؟» (cashier_shop_heads)، ثم نسحب الجداول التي تغيّرت فقط.
//        آخر تعديل يفوز للأصناف والزبائن…، والإضافة فقط للحركات والدفعات.
import { TABLES, TABLE, toRemote } from './tables.js';
import { HttpError } from './supabase.js';
import { remoteWins, normalizeTimestamps } from '../domain/merge.js';
import { foldProduct } from '../domain/stock.js';

const PUSH_BATCH = 200;
const PULL_LIMIT = 500;
const MAX_TRIES = 5;

export function createSyncEngine({ db, api, getContext, emit = () => {}, now = () => new Date().toISOString() }) {
  let running = null;
  let status = { state: 'idle', pending: 0, lastSyncAt: null, error: null };
  const listeners = new Set();

  function setStatus(patch) {
    status = { ...status, ...patch };
    for (const fn of listeners) fn(status);
  }

  const meta = {
    async get(key, def = null) { return (await db.meta.get(key))?.value ?? def; },
    set(key, value) { return db.meta.put({ key, value }); },
  };

  // ---------- الدخول وتسجيل المحل والجهاز ----------
  async function ensureSession() {
    const s = await api.auth.getSession();
    if (s) return s;
    return api.auth.signInAnonymously();
  }

  async function ensureRemoteShop(ctx) {
    const reg = await meta.get('remote');
    if (reg && reg.shopId === ctx.shopId && reg.deviceId === ctx.deviceId) return reg;
    const shop = await db.shops.get(ctx.shopId);
    await api.rest.rpc('cashier_create_shop', {
      p_id: ctx.shopId, p_name: shop?.name || 'محل', p_type: shop?.shop_type || 'other', p_currency: shop?.base_currency || 'ILS',
    });
    const prefix = await api.rest.rpc('cashier_register_device', {
      p_shop: ctx.shopId, p_device: ctx.deviceId, p_name: ctx.deviceName || null, p_preferred: ctx.prefix || null,
    });
    const value = { shopId: ctx.shopId, deviceId: ctx.deviceId, prefix, at: now() };
    await meta.set('remote', value);
    // الخادم أعطى حرفًا آخر (جهاز ثانٍ استعمل A وهو بلا إنترنت): الفواتير الجديدة تأخذ الحرف الصحيح
    if (prefix && prefix !== ctx.prefix) {
      await meta.set('devicePrefix', prefix);
      emit({ tables: ['meta'], source: 'sync', prefixChanged: prefix });
    }
    return value;
  }

  // ---------- الرفع ----------
  async function push() {
    let pushed = 0;
    for (let round = 0; round < 50; round++) {
      const entries = await db.outbox.orderBy('seq').filter((e) => !e.dead).limit(PUSH_BATCH).toArray();
      if (!entries.length) break;
      const groups = new Map();
      for (const e of entries) {
        if (!groups.has(e.table)) groups.set(e.table, []);
        groups.get(e.table).push(e);
      }
      const ordered = [...groups.keys()].sort((a, b) => TABLES.indexOf(TABLE[a]) - TABLES.indexOf(TABLE[b]));
      for (const name of ordered) pushed += await pushGroup(name, groups.get(name));
    }
    return pushed;
  }

  async function pushGroup(name, entries) {
    const t = TABLE[name];
    if (!t) { await db.outbox.bulkDelete(entries.map((e) => e.seq)); return 0; }
    const rows = await db.table(name).bulkGet(entries.map((e) => e.id));
    const live = [];
    const gone = [];
    entries.forEach((e, i) => (rows[i] ? live.push([e, toRemote(name, rows[i])]) : gone.push(e.seq)));
    if (gone.length) await db.outbox.bulkDelete(gone);
    if (!live.length) return 0;
    const opts = { ignoreDuplicates: t.mode === 'append' };
    try {
      await api.rest.upsert(t.remote, live.map(([, r]) => r), opts);
      await db.outbox.bulkDelete(live.map(([e]) => e.seq));
      return live.length;
    } catch (err) {
      if (!(err instanceof HttpError) || err.transient) throw err;
      // خطأ بيانات: نرفع واحدًا واحدًا لنعزل السجل المعطوب ولا نوقف الباقي
      let ok = 0;
      for (const [e, r] of live) {
        try {
          await api.rest.upsert(t.remote, [r], opts);
          await db.outbox.delete(e.seq);
          ok++;
        } catch (one) {
          if (!(one instanceof HttpError) || one.transient) throw one;
          const tries = (e.tries || 0) + 1;
          await db.outbox.update(e.seq, { tries, dead: tries >= MAX_TRIES, error: String(one.message).slice(0, 300) });
        }
      }
      return ok;
    }
  }

  // ---------- السحب ----------
  async function pull(ctx) {
    const res = await api.rest.select('cashier_shop_heads', { select: 'heads', shop_id: `eq.${ctx.shopId}` });
    const heads = (res && res[0] && res[0].heads) || {};
    let pulled = 0;
    for (const t of TABLES) {
      const head = Number(heads[t.remote] || 0);
      const key = `cursor:${t.name}`;
      let cursor = Number(await meta.get(key, 0));
      if (head <= cursor) continue;
      for (;;) {
        const rows = await api.rest.select(t.remote, {
          select: '*', shop_id: `eq.${ctx.shopId}`, server_seq: `gt.${cursor}`, order: 'server_seq.asc', limit: PULL_LIMIT,
        });
        if (rows.length) {
          await apply(t, rows);
          pulled += rows.length;
          cursor = Number(rows[rows.length - 1].server_seq);
        }
        if (rows.length < PULL_LIMIT) {
          // كل ما رقمه ≤ head محفوظ فعلًا على الخادم (الكتابة في المحل بالترتيب)، فنقفز إليه
          cursor = Math.max(cursor, head);
          await meta.set(key, cursor);
          break;
        }
        await meta.set(key, cursor);
      }
    }
    return pulled;
  }

  async function apply(t, rawRows) {
    const rows = rawRows.map(normalizeTimestamps);
    const touched = new Set();
    const changed = await db.transaction('rw', [db.table(t.name), db.outbox, db.stock, db.movements], async () => {
      let n = 0;
      const locals = await db.table(t.name).bulkGet(rows.map((r) => r.id));
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const local = locals[i];
        if (t.mode === 'append') {
          if (local) continue;
        } else if (!remoteWins(local, row)) {
          continue;
        } else if (local) {
          // نسخة الخادم أحدث من تعديل محلي لم يُرفع بعد: التعديل المحلي خسر، فلا داعي لرفعه
          const pending = await db.outbox.where('key').equals(`${t.name}:${row.id}`).first();
          if (pending) await db.outbox.delete(pending.seq);
        }
        await db.table(t.name).put(row);
        if (t.name === 'movements') touched.add(row.product_id);
        n++;
      }
      // المخزون من الحركات: نعيد حساب الأصناف التي وصلتها حركات من جهاز آخر
      for (const pid of touched) await rebuildStock(pid);
      return n;
    });
    if (changed) emit({ tables: [t.name], source: 'remote' });
  }

  async function rebuildStock(productId) {
    const mv = await db.movements.where('product_id').equals(productId).toArray();
    const { qty, avgCost } = foldProduct(mv);
    let last = null;
    for (const m of mv) if (m.type === 'sale' && (!last || m.created_at > last)) last = m.created_at;
    await db.stock.put({ product_id: productId, qty, avgCost, last_sale_at: last });
  }

  // ---------- الدورة الكاملة ----------
  async function runOnce() {
    const ctx = getContext();
    if (!ctx || !ctx.shopId) return { skipped: 'no-shop' };
    setStatus({ state: 'syncing', error: null });
    try {
      await ensureSession();
      await ensureRemoteShop(ctx);
      const pushed = await push();
      const pulled = await pull(ctx);
      const pending = await db.outbox.count();
      const dead = await db.outbox.filter((e) => !!e.dead).count();
      const at = now();
      await meta.set('lastSyncAt', at);
      setStatus({ state: dead ? 'error' : 'synced', pending, lastSyncAt: at, error: dead ? `${dead} سجل لم يُقبل` : null });
      return { pushed, pulled, pending };
    } catch (err) {
      const offline = err instanceof HttpError && err.status === 0;
      setStatus({ state: offline ? 'offline' : 'error', pending: await db.outbox.count(), error: String(err?.message || err).slice(0, 300) });
      return { error: err };
    }
  }

  return {
    /** مزامنة واحدة؛ إن كانت جارية يرجع نفس الوعد (لا مزامنتان معًا). */
    run() {
      if (!running) running = runOnce().finally(() => { running = null; });
      return running;
    },
    get status() { return status; },
    onStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); },
    async refreshPending() { setStatus({ pending: await db.outbox.count() }); },
    // للاختبار
    _push: push, _pull: pull,
  };
}
