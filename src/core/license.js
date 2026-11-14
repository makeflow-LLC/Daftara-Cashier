// خدمة الترخيص: تجمع ما يعرفه الجهاز (تاريخ التثبيت، كود التفعيل، اشتراك Google Play، آخر ردّ من الخادم)
// وتحسب الحالة عبر domain/license.js. الحالة تُقرأ فورًا (app.license.state) دون انتظار.
import { licenseState, trustedNow, deviceCode, verifyCode, unb64, LOCKED_TABLES, GRACE_DAYS } from '../domain/license.js';

/** المفتاح العام لـ MakeFlow (نفسه في supabase/migrations/0003_licensing.sql). الخاص عند MakeFlow وحدها. */
export const LICENSE_PUBLIC_KEY = 'LQAGz2YjhZJjLP4/6d91+KqTvqbopt+6rH4Lhumxsqc=';
const DAY = 86400000;
/** مفاتيح meta التي تبقى عند استعادة نسخة احتياطية. */
export const LICENSE_META = ['installedAt', 'lastSeen', 'license:server', 'license:code', 'license:codeSent', 'license:play'];

export class LicenseError extends Error {
  constructor() {
    super('انتهت مدة الاشتراك — التطبيق للقراءة فقط. اشترك لتكمل.');
    this.license = true;
  }
}

function loadNacl() {
  return new Promise((resolve, reject) => {
    if (globalThis.nacl?.sign) { resolve(globalThis.nacl); return; }
    const s = document.createElement('script');
    s.src = 'vendor/nacl-fast.min.js';
    s.onload = () => resolve(globalThis.nacl);
    s.onerror = reject;
    document.head.append(s);
  });
}

/**
 * meta: { get(key, def), set(key, value) }   info: { deviceKey?, installedAt?, flavor }
 * verifier: async () => (msg, sig, key) => boolean   (للاختبار؛ الافتراضي يحمّل nacl عند الحاجة)
 */
export function createLicense({ meta, info = {}, deviceId, shopCreatedAt = null, emit = () => {}, clock = Date.now, publicKey = LICENSE_PUBLIC_KEY, verifier = null, billing = null }) {
  const getVerify = verifier || (async () => { const n = await loadNacl(); return (m, s, k) => n.sign.detached.verify(m, s, k); });
  const deviceKey = String(info.deviceKey || String(deviceId || '').replace(/-/g, '')).slice(0, 32);
  const device = deviceCode(deviceKey);
  let installedAt = null, lastSeen = 0, server = null, code = null, play = null;
  let state = { status: 'trial', readOnly: false, daysLeft: 30, until: null, plan: 'trial' };

  function compute() {
    const now = trustedNow(clock(), lastSeen);
    if (now > lastSeen + 60000) { lastSeen = now; meta.set('lastSeen', now); }
    const next = licenseState({ now, installedAt, server, code, play });
    const changed = next.status !== state.status || next.daysLeft !== state.daysLeft || next.plan !== state.plan;
    state = next;
    if (changed) emit(state);
    return state;
  }

  async function init() {
    const stored = await meta.get('installedAt');
    const candidates = [stored, info.installedAt, shopCreatedAt ? Date.parse(shopCreatedAt) : null, clock()].filter((x) => Number.isFinite(x) && x > 0);
    installedAt = Math.min(...candidates);
    if (stored !== installedAt) await meta.set('installedAt', installedAt);
    lastSeen = Number(await meta.get('lastSeen', 0)) || 0;
    server = await meta.get('license:server');
    code = await meta.get('license:code');
    play = await meta.get('license:play');
    compute();
    if (code) recheckCode();
    if (billing) refreshPlay();
    return state;
  }

  /** كود محفوظ يُتحقق منه من جديد عند كل تشغيل: كود مكتوب يدويًا في قاعدة الجهاز لا يمرّ. */
  async function recheckCode() {
    try {
      const verify = await getVerify();
      const r = verifyCode(code.code, { device, publicKey: unb64(publicKey), verify, now: 0 });
      if (!r.ok) { code = null; await meta.set('license:code', null); compute(); }
    } catch { /* تعذّر تحميل المكتبة: نُبقي الحال */ }
  }

  /** لصق كود التفعيل (أو رسالة واتساب كاملة فيها الكود). */
  async function redeem(text) {
    const verify = await getVerify();
    const r = verifyCode(text, { device, publicKey: unb64(publicKey), verify, now: trustedNow(clock(), lastSeen) });
    if (!r.ok) return r;
    code = { code: r.code, expiresAt: r.expiresAt, plan: r.plan };
    await meta.set('license:code', code);
    compute();
    return r;
  }

  async function setPlay(p) {
    play = p && p.active ? { active: true, plan: p.plan || 'monthly', token: p.token || null, at: clock() } : null;
    await meta.set('license:play', play);
    compute();
  }

  async function refreshPlay() {
    try {
      const r = await billing.info();
      if (r && r.ok) await setPlay(r);
      return r;
    } catch { return null; }
  }

  async function buyPlay(plan) {
    const r = await billing.buy({ plan });
    if (r && r.ok && r.active) await setPlay(r);
    return r;
  }

  function serverOk(s) {
    if (!s) return true;
    if (s.is_active === false) return false;
    const now = Date.parse(s.server_now) || clock();
    const paid = s.expires_at ? Date.parse(s.expires_at) + GRACE_DAYS * DAY : 0;
    const trial = s.trial_ends_at ? Date.parse(s.trial_ends_at) : 0;
    return Math.max(paid, trial) > now;
  }

  /**
   * يُستدعى من محرك المزامنة قبل الرفع: يسجّل الكود/اشتراك Play عند الخادم، يسأله عن الحالة ويحفظها.
   * يرجع false إن كان الخادم سيرفض الكتابة (فلا نرفع، ويبقى كل شيء في الطابور حتى التجديد).
   */
  async function gate({ api, ctx }) {
    const soft = async (fn) => {
      try { return await fn(); } catch (e) { if (!e || e.status === undefined || e.transient) throw e; return null; }
    };
    if (code && (await meta.get('license:codeSent')) !== code.code) {
      // يُعلَّم «أُرسل» فقط إن قبله الخادم؛ وإلا نعيد المحاولة في المزامنة التالية
      const ok = await soft(() => api.rest.rpc('cashier_license_redeem', { p_shop: ctx.shopId, p_code: code.code }));
      if (ok) await meta.set('license:codeSent', code.code);
    }
    if (play && play.active && play.token) {
      await soft(() => api.rest.rpc('cashier_license_play', { p_shop: ctx.shopId, p_token: play.token, p_plan: play.plan }));
    }
    // خادم لم تُشغَّل عليه 0003 بعد يردّ 404: لا نوقف المزامنة
    const res = await soft(() => api.rest.rpc('cashier_license_checkin', { p_shop: ctx.shopId, p_device_key: deviceKey }));
    if (!res) return true;
    server = res;
    await meta.set('license:server', server);
    const sn = Date.parse(server.server_now);
    if (Number.isFinite(sn) && sn > lastSeen) { lastSeen = sn; await meta.set('lastSeen', sn); }
    compute();
    return serverOk(server);
  }

  return {
    init, compute, redeem, gate, refreshPlay, buyPlay,
    get state() { return state; },
    get device() { return device; },
    get deviceKey() { return deviceKey; },
    get hasBilling() { return !!billing; },
    /** يرمي LicenseError إن كان الجدول مقفلًا في وضع القراءة فقط. */
    guard(table) {
      if (state.readOnly && LOCKED_TABLES.includes(table)) throw new LicenseError();
    },
  };
}
