// أعمدة src/sync/tables.js يجب أن تطابق مخطط الخادم supabase/migrations حرفيًا،
// وإلا رفض الخادم الرفع أو ضاع عمود بصمت.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TABLES } from '../src/sync/tables.js';

const sql = readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');

function columnsOf(table) {
  const m = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  assert.ok(m, `table ${table} not found in migrations`);
  const cols = new Set();
  const body = m[1].replace(/--[^\n]*/g, '');
  // نقسم على الفواصل خارج الأقواس
  let depth = 0, cur = '';
  const parts = [];
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  for (const p of parts) {
    const w = p.trim().split(/\s+/)[0];
    if (!w || ['constraint', 'primary', 'unique', 'check', 'foreign'].includes(w)) continue;
    cols.add(w);
  }
  cols.delete('server_seq');
  cols.delete('server_at');
  return cols;
}

for (const t of TABLES) {
  test(`columns match server: ${t.remote}`, () => {
    assert.deepEqual([...columnsOf(t.remote)].sort(), Object.keys(t.columns).sort());
  });
}

test('every synced server table is registered on the device', () => {
  // القائمة تتكرر في 0003 (سياسات الترخيص): نأخذ كل جدول مرة، ونتأكد أن التكرار متطابق
  const all = [...sql.matchAll(/\('(cashier_[a-z_]+)', '(lww|append)'\)/g)].map((m) => [m[1], m[2]]);
  const modes = new Map();
  for (const [remote, mode] of all) { assert.ok(!modes.has(remote) || modes.get(remote) === mode, `${remote} mode differs between migrations`); modes.set(remote, mode); }
  assert.equal(all.length, modes.size * 2, 'licensing policies cover every synced table');
  const synced = [...modes];
  assert.equal(synced.length, TABLES.length);
  for (const [remote, mode] of synced) {
    const t = TABLES.find((x) => x.remote === remote);
    assert.ok(t, `${remote} missing from tables.js`);
    assert.equal(t.mode, mode, `${remote} mode`);
  }
});

test('supabase/setup.sql is the up-to-date concatenation of all migrations', async () => {
  const { buildSetupSql } = await import('../scripts/build-setup-sql.mjs');
  assert.equal(readFileSync('supabase/setup.sql', 'utf8'), buildSetupSql(), 'run: node scripts/build-setup-sql.mjs');
});
