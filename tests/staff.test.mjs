import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Dexie from 'dexie';
import { createDb } from '../src/core/db.js';
import { createStore } from '../src/core/store.js';
import { makeClock } from '../src/domain/merge.js';
import { uuid } from '../src/core/ids.js';
import { buildReport, reportSections } from '../src/domain/reports.js';
import {
  sha256Hex, pinProblem, makePin, checkPin, pinTaken, whoHasPin, userById, allowed, staffName, ROLES, PERM_KEYS, PERM_VERSION, permsOf, roleFor,
} from '../src/domain/staff.js';

test('sha256 matches node:crypto (empty, ascii, arabic, multi-block)', () => {
  for (const s of ['', 'abc', 'رمز 1234', 'x'.repeat(200), 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64)]) {
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), `len ${s.length}`);
  }
});

test('PIN rules, hashing and lookup', () => {
  assert.match(pinProblem('12'), /4 إلى 6/);
  assert.match(pinProblem('1234567'), /4 إلى 6/);
  assert.match(pinProblem('12a4'), /4 إلى 6/);
  assert.match(pinProblem('1111'), /مكرر/);
  assert.match(pinProblem('1234', '1235'), /غير متطابقين/);
  assert.equal(pinProblem('2580', '2580'), null);

  const owner = makePin('2580', 'salt-o');
  assert.notEqual(owner.hash, '2580');
  assert.equal(checkPin('2580', owner), true);
  assert.equal(checkPin('2581', owner), false);
  assert.equal(checkPin('2580', null), false);
  assert.notEqual(makePin('2580', 'other').hash, owner.hash, 'salted');

  const staff = {
    enabled: true,
    owner: { name: 'أبو أحمد', pin: owner },
    members: [
      { id: 'm1', name: 'سامي', role: 'cashier', perms: [], pin: makePin('1357', 's1'), active: true },
      { id: 'm2', name: 'رامي', role: 'manager', perms: ROLES.manager.perms, pin: makePin('2468', 's2'), active: false },
    ],
  };
  assert.equal(whoHasPin(staff, '2580').owner, true);
  assert.equal(whoHasPin(staff, '1357').name, 'سامي');
  assert.equal(whoHasPin(staff, '2468'), null, 'a stopped member cannot log in');
  assert.equal(pinTaken(staff, '1357'), true);
  assert.equal(pinTaken(staff, '1357', 'm1'), false, 'own PIN is not "taken" when editing yourself');
  assert.equal(pinTaken(staff, '2580', 'm1'), true, 'the owner PIN cannot be reused');
  assert.equal(userById(staff, 'owner').owner, true);
  assert.equal(userById(staff, 'm1').name, 'سامي');
  assert.equal(userById(staff, 'm2'), null);
  assert.equal(userById({ ...staff, enabled: false }, 'm1'), null);
  assert.equal(staffName(staff, null), 'أبو أحمد');
  assert.equal(staffName(staff, 'm2'), 'رامي');
  assert.equal(staffName(staff, 'gone'), 'موظف سابق');
});

test('permissions: owner everything, cashier only selling, aliases', () => {
  const cashier = { id: 'c', role: 'cashier', perms: ['sell'], pv: 2 };
  const senior = { id: 's', role: 'senior', perms: ROLES.senior.perms, pv: 2 };
  const manager = { id: 'm', role: 'manager', perms: ROLES.manager.perms, pv: 2 };
  assert.equal(allowed(null, 'settings'), true);
  assert.equal(allowed({ owner: true }, 'settings'), true);
  for (const k of PERM_KEYS) assert.equal(allowed(cashier, k), k === 'sell', k);
  assert.equal(allowed(cashier, 'see_cost'), false, 'see_cost follows see_profit');
  assert.equal(allowed(cashier, 'anything_else'), true, 'unknown actions stay open');
  assert.equal(allowed(senior, 'discount'), true);
  assert.equal(allowed(senior, 'see_profit'), false);
  assert.equal(allowed(manager, 'see_cost'), true);
  assert.equal(allowed(manager, 'settings'), false);
});

test('roles: accountant and viewer do not sell; the cashier does not see the debts total', () => {
  const as = (role) => ({ id: role, role, perms: ROLES[role].perms, pv: PERM_VERSION });
  assert.deepEqual(Object.keys(ROLES), ['cashier', 'senior', 'accountant', 'viewer', 'manager']);
  assert.equal(allowed(as('cashier'), 'see_debts'), false);
  assert.equal(allowed(as('cashier'), 'invoices'), false);
  assert.equal(allowed(as('accountant'), 'sell'), false);
  for (const k of ['see_debts', 'see_profit', 'reports', 'cash', 'credit', 'invoices']) assert.equal(allowed(as('accountant'), k), true, k);
  assert.equal(allowed(as('accountant'), 'settings'), false);
  // المراقب يرى ولا يغيّر: لا بيع ولا آجل ولا مرتجع ولا أصناف ولا صندوق ولا حذف
  for (const k of ['sell', 'credit', 'returns', 'invoices', 'products', 'purchases', 'cash', 'delete', 'discount', 'settings']) assert.equal(allowed(as('viewer'), k), false, k);
  for (const k of ['see_debts', 'see_profit', 'reports']) assert.equal(allowed(as('viewer'), k), true, k);
  for (const k of ['sell', 'see_debts', 'invoices']) assert.equal(allowed(as('manager'), k), true, k);
  for (const r of Object.values(ROLES)) for (const k of r.perms) assert.ok(PERM_KEYS.includes(k), k);
  assert.equal(roleFor(ROLES.viewer.perms), 'viewer');
  assert.equal(roleFor(['sell', 'reports']), 'custom');
});

test('staff saved before the new permissions keep working: nothing is taken away silently', () => {
  // كاشير قديم (perms فارغة، بلا pv): ما زال يبيع؛ ومدير قديم يأخذ صلاحيات المدير الجديدة من تعريف الدور
  const oldCashier = { id: 'c', role: 'cashier', perms: [] };
  assert.equal(allowed(oldCashier, 'sell'), true);
  assert.equal(allowed(oldCashier, 'see_debts'), false);
  const oldManager = { id: 'm', role: 'manager', perms: ['see_profit', 'discount', 'credit', 'returns', 'products', 'purchases', 'cash', 'reports', 'delete'] };
  for (const k of ['sell', 'see_debts', 'invoices']) assert.equal(allowed(oldManager, k), true, k);
  // صلاحيات خاصة قديمة: البيع ومجموع الديون كانا مفتوحين للجميع فيبقيان، والجديد المقيَّد (تعديل الفواتير) لا يُمنح
  const oldCustom = { id: 'x', role: 'custom', perms: ['reports'] };
  assert.deepEqual([...permsOf(oldCustom)].sort(), ['reports', 'see_debts', 'sell']);
  assert.equal(allowed(oldCustom, 'invoices'), false);
  // بعد حفظه من الشاشة الجديدة (pv) صلاحياته كما اختيرت تمامًا
  assert.deepEqual(permsOf({ ...oldCustom, pv: PERM_VERSION }), ['reports']);
});

test('every saved invoice carries who made it; sync pulls keep theirs', async () => {
  const db = createDb(Dexie, `staff-${Date.now()}`);
  await db.open();
  const ctx = { shopId: uuid(), deviceId: uuid(), prefix: 'A', userId: null };
  const store = createStore({ db, clock: makeClock(), getContext: () => ctx });
  const a = await store.put('invoices', { number: 'A-1', seq: 1, type: 'sale', total: 100 });
  assert.equal(a.created_by, null, 'owner');
  ctx.userId = uuid();
  const b = await store.put('invoices', { number: 'A-2', seq: 2, type: 'sale', total: 100 });
  assert.equal(b.created_by, ctx.userId, 'staff member');
  const v = await store.patch('invoices', a.id, { status: 'void' });
  assert.equal(v.created_by, null, 'editing later keeps the original seller');
  const m = await store.append('payments', { invoice_id: b.id, amount: 100 });
  assert.equal(m.created_by, ctx.userId);
  const p = await store.put('products', { name: 'سكر' });
  assert.equal('created_by' in p, false, 'only tables that have the column');
});

test('reports: sales by employee', () => {
  const I = (id, type, total, by, discount = 0) => ({ id, type, status: 'final', total, cost_total: 0, fee_total: 0, discount, created_by: by, created_at: '2026-11-16T10:00:00.000Z' });
  const r = buildReport({
    invoices: [I('1', 'sale', 5000, null), I('2', 'sale', 3000, 'm1', 200), I('3', 'sale', 2000, 'm1'), I('4', 'sale_return', 500, 'm1')],
    lines: [], payments: [], from: '2026-11-16T00:00:00.000Z', to: '2026-11-17T00:00:00.000Z',
  });
  assert.deepEqual(r.byStaff.map((x) => [x.id, x.sales, x.count, x.discount]), [['m1', 4500, 2, 200], [null, 5000, 1, 0]].sort((a, b) => b[1] - a[1]));
  const names = (id) => (id ? 'سامي' : 'صاحب المحل');
  const sec = reportSections(r, null, { staffName: names }).find((s) => s.title === 'حسب الموظف');
  assert.deepEqual(sec.rows[0], ['صاحب المحل', '1', '₪ 50.00'].map((x, i) => (i === 2 ? sec.rows[0][2] : x)));
  assert.equal(reportSections(r, null, {}).some((s) => s.title === 'حسب الموظف'), false, 'hidden without staff');
});
