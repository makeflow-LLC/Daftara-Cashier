// واجهة الحاسوب: أي عنصر في القائمة الجانبية يضيء لكل صفحة، وأي اختصار يعمل في أي حالة.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIDE, sideItemFor } from '../src/domain/nav.js';
import { matchShortcut } from '../src/ui/shortcuts.js';
import { WIDE_QUERY } from '../src/ui/wide.js';

const routes = [...readFileSync('src/features/index.js', 'utf8').matchAll(/\{ path: '([^']+)'/g)].map((m) => m[1]);

test('sidebar: every item opens a real screen and lights up for its own pages', () => {
  for (const it of SIDE) {
    assert.ok(routes.includes(it.path), `${it.path} is not a route`);
    assert.equal(sideItemFor(it.path), it, it.path);
  }
  assert.equal(sideItemFor('/').path, '/');
  assert.equal(sideItemFor('/products/edit').path, '/products');
  assert.equal(sideItemFor('/suppliers/view').path, '/customers');
  assert.equal(sideItemFor('/inventory/warehouses').path, '/inventory');
  assert.equal(sideItemFor('/settings/printer').path, '/more');
  assert.equal(sideItemFor('/sale/returns').path, '/invoices');
  assert.equal(sideItemFor('/sale'), null); // «بيع جديد» زر مستقل أعلى القائمة
  // موظف بلا صلاحية المخزون: العنصر غائب، فلا يضيء شيء بدلًا منه
  assert.equal(sideItemFor('/inventory', SIDE.filter((i) => i.perm !== 'purchases')), null);
});

test('shortcuts: page before global, F-keys work while typing, letters do not, sheets block unless allowed', () => {
  const page = [{ key: 'F10', id: 'pay' }, { key: 'Escape', id: 'clear' }];
  const global = [{ key: 'F2', id: 'sale', sheet: true }, { key: 'F10', id: 'never' }, { key: '/', id: 'search' }, { key: 'Ctrl+K', id: 'search2' }];
  const m = (name, state) => matchShortcut([page, global], name, state)?.id || null;
  assert.equal(m('F10'), 'pay');
  assert.equal(m('F10', { typing: true }), 'pay');
  assert.equal(m('/'), 'search');
  assert.equal(m('/', { typing: true }), null);   // يكتب «/» في الحقل
  assert.equal(m('Ctrl+K', { typing: true }), 'search2');
  assert.equal(m('F10', { sheet: true }), null);  // نافذة الدفع مفتوحة: لا تُفتح ثانية
  assert.equal(m('F2', { sheet: true }), 'sale');
  assert.equal(m('F7'), null);
});

test('the wide breakpoint is the same in JS and CSS', () => {
  const css = readFileSync('styles/app.css', 'utf8');
  assert.ok(css.includes(`@media ${WIDE_QUERY}{`), 'styles/app.css must use the query from src/ui/wide.js');
});
