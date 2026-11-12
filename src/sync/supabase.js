// عميل Supabase صغير بـ fetch فقط (بدل مكتبة supabase-js الثقيلة): الدخول، PostgREST، والتخزين.
// يكفي ما يحتاجه التطبيق، ويعمل على WebView قديم وعلى شبكة ضعيفة (مهلة لكل طلب).

export class HttpError extends Error {
  constructor(status, body, where) {
    super(`${where}: HTTP ${status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
  /** خطأ مؤقت (شبكة، خادم مشغول) يستحق إعادة المحاولة لاحقًا، لا خطأ في البيانات. */
  get transient() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export function createSupabase({ url, anonKey, fetchImpl = globalThis.fetch.bind(globalThis), loadSession, saveSession, timeoutMs = 20000 }) {
  const base = url.replace(/\/+$/, '');
  let session = null;

  async function request(path, { method = 'GET', headers = {}, body, auth = true, raw = false } = {}) {
    const h = { apikey: anonKey, ...headers };
    if (auth) {
      const s = await getSession();
      h.Authorization = `Bearer ${s ? s.access_token : anonKey}`;
    }
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
      h['Content-Type'] = h['Content-Type'] || 'application/json';
      body = JSON.stringify(body);
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchImpl(base + path, { method, headers: h, body, signal: ctrl?.signal });
    } catch (e) {
      throw new HttpError(0, String(e?.message || e), `${method} ${path}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (raw && res.ok) return res;
    const text = await res.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* نص عادي */ }
    if (!res.ok) throw new HttpError(res.status, data, `${method} ${path}`);
    return data;
  }

  // ---------- الدخول ----------
  async function getSession() {
    if (!session && loadSession) session = await loadSession();
    if (session && session.expires_at && session.expires_at * 1000 < Date.now() + 60_000) {
      try { await refresh(); } catch (e) { if (!(e instanceof HttpError) || !e.transient) { await setSession(null); } else throw e; }
    }
    return session;
  }
  async function setSession(s) {
    session = s
      ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user_id: s.user?.id || s.user_id, anonymous: s.user ? !!s.user.is_anonymous : !!s.anonymous }
      : null;
    if (saveSession) await saveSession(session);
    return session;
  }
  async function refresh() {
    const r = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh_token } });
    return setSession(r);
  }

  const auth = {
    getSession,
    async userId() { return (await getSession())?.user_id || null; },
    /** حساب بلا بيانات (anonymous): المزامنة تعمل فورًا دون أن يكتب صاحب المحل شيئًا. */
    async signInAnonymously() {
      return setSession(await request('/auth/v1/signup', { method: 'POST', auth: false, body: { data: {} } }));
    },
    async signUp(email, password) {
      return setSession(await request('/auth/v1/signup', { method: 'POST', auth: false, body: { email, password } }));
    },
    async signInWithPassword(email, password) {
      return setSession(await request('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } }));
    },
    /** يحوّل الحساب المجهول إلى حساب برقم جوال وكلمة سر (للدخول من جوال آخر). */
    async updateUser(fields) {
      return request('/auth/v1/user', { method: 'PUT', body: fields });
    },
    async signOut() { await setSession(null); },
  };

  // ---------- PostgREST ----------
  function qs(params) {
    return Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }
  const rest = {
    /** رفع دفعة سجلات. append → يتجاهل الموجود؛ lww → يدمج (والخادم يرفض الأقدم). */
    upsert(table, rows, { ignoreDuplicates = false } = {}) {
      return request(`/rest/v1/${table}?on_conflict=id`, {
        method: 'POST',
        headers: { Prefer: `resolution=${ignoreDuplicates ? 'ignore' : 'merge'}-duplicates,return=minimal` },
        body: rows,
      });
    },
    select(table, params) {
      return request(`/rest/v1/${table}?${qs(params)}`);
    },
    rpc(fn, args = {}) {
      return request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
    },
  };

  // ---------- التخزين (صور الأصناف) ----------
  const storage = {
    upload(bucket, path, blob, contentType = 'image/webp') {
      return request(`/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'true' }, body: blob });
    },
    async download(bucket, path) {
      const res = await request(`/storage/v1/object/authenticated/${bucket}/${path}`, { raw: true });
      return res.blob();
    },
  };

  return { auth, rest, storage, request };
}
