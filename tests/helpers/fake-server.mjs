// خادم Supabase مزيّف في الذاكرة يحاكي ما يفعله المخطط الحقيقي (supabase/migrations):
// server_seq متزايد، آخر تعديل يفوز، الإضافة فقط، cashier_shop_heads، العضوية، وحروف الأجهزة.
// يرجع الأوقات بصيغة Postgres (+00:00) كما يفعل الخادم الحقيقي.
import { HttpError } from '../../src/sync/supabase.js';
import { TABLES } from '../../src/sync/tables.js';

const MODE = Object.fromEntries(TABLES.map((t) => [t.remote, t.mode]));

function pgTime(iso) {
  return typeof iso === 'string' && iso.endsWith('Z') ? iso.replace(/\.000Z$|Z$/, '+00:00') : iso;
}

export function createFakeServer() {
  const tables = new Map();
  const members = new Map(); // shopId → Set(userId)
  const devices = new Map(); // shopId → Map(deviceId → prefix)
  const heads = new Map();   // shopId → {table: seq}
  let seq = 0;
  let users = 0;
  const server = { offline: false, reject: null, requests: 0, tables, members };

  function tbl(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  }
  function guard(path) {
    server.requests++;
    if (server.offline) throw new HttpError(0, 'Failed to fetch', path);
  }
  function isMember(shopId, uid) {
    return !!members.get(shopId)?.has(uid);
  }
  function stamp(name, row) {
    row.server_seq = ++seq;
    row.server_at = new Date().toISOString();
    const h = heads.get(row.shop_id) || {};
    h[name] = row.server_seq;
    heads.set(row.shop_id, h);
  }

  server.api = function apiFor(sessionRef = { current: null }) {
    const auth = {
      async getSession() { return sessionRef.current; },
      async signInAnonymously() {
        guard('signup');
        sessionRef.current = { access_token: 't', user_id: `user-${++users}`, anonymous: true };
        return sessionRef.current;
      },
      async userId() { return sessionRef.current?.user_id || null; },
    };
    const uid = () => sessionRef.current?.user_id;
    const rest = {
      async upsert(name, rows, { ignoreDuplicates } = {}) {
        guard(name);
        const t = tbl(name);
        // تحقق كامل قبل أي كتابة (مثل معاملة Postgres واحدة)
        for (const r of rows) {
          if (!isMember(r.shop_id, uid())) throw new HttpError(403, { message: 'row-level security' }, name);
          if (server.reject && server.reject(name, r)) throw new HttpError(400, { message: 'check constraint' }, name);
          const ex = t.get(r.id);
          if (ex && ex.shop_id !== r.shop_id) throw new HttpError(403, { message: 'cannot move' }, name);
        }
        for (const r of rows) {
          const ex = t.get(r.id);
          const row = { ...r, created_at: pgTime(r.created_at), updated_at: pgTime(r.updated_at) };
          if (!('updated_at' in r)) delete row.updated_at;
          if (ex) {
            if (ignoreDuplicates || MODE[name] === 'append') continue;
            if (Date.parse(r.updated_at) < Date.parse(ex.updated_at)) continue;
          }
          stamp(name, row);
          t.set(r.id, row);
        }
        return null;
      },
      async select(name, params) {
        guard(name);
        const shopId = params.shop_id.replace(/^eq\./, '');
        if (!isMember(shopId, uid())) return [];
        if (name === 'cashier_shop_heads') return heads.has(shopId) ? [{ heads: { ...heads.get(shopId) } }] : [];
        const after = Number(String(params.server_seq || 'gt.0').replace(/^gt\./, ''));
        return [...tbl(name).values()]
          .filter((r) => r.shop_id === shopId && r.server_seq > after)
          .sort((a, b) => a.server_seq - b.server_seq)
          .slice(0, Number(params.limit || 1000))
          .map((r) => JSON.parse(JSON.stringify(r)));
      },
      async rpc(fn, a) {
        guard(fn);
        if (fn === 'cashier_create_shop') {
          if (members.has(a.p_id)) {
            if (!isMember(a.p_id, uid())) throw new HttpError(403, { message: 'shop belongs to another account' }, fn);
          } else {
            members.set(a.p_id, new Set([uid()]));
            const row = { id: a.p_id, shop_id: a.p_id, name: a.p_name, shop_type: a.p_type, updated_at: '1970-01-01T00:00:00+00:00' };
            stamp('cashier_shops', row);
            tbl('cashier_shops').set(a.p_id, row);
          }
          return { shop_id: a.p_id, role: 'owner' };
        }
        if (fn === 'cashier_register_device') {
          if (!isMember(a.p_shop, uid())) throw new HttpError(403, { message: 'not a member' }, fn);
          const d = devices.get(a.p_shop) || new Map();
          devices.set(a.p_shop, d);
          if (d.has(a.p_device)) return d.get(a.p_device);
          const used = new Set(d.values());
          let p = a.p_preferred && !used.has(a.p_preferred) ? a.p_preferred : null;
          for (let i = 0; !p; i++) { const c = String.fromCharCode(65 + i); if (!used.has(c)) p = c; }
          d.set(a.p_device, p);
          return p;
        }
        throw new HttpError(404, { message: `no rpc ${fn}` }, fn);
      },
    };
    return { auth, rest };
  };

  return server;
}
