// دليل الاستخدام: كل صفحة في التطبيق لها شرح (زر «شرح» لا يغيب عن صفحة جديدة)، وكل صورة وزر في الدليل يدل على شيء موجود.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { GUIDE_CATS, TOPICS, SHOT_CAPTIONS, topicById, topicForPath, topicsOf, searchTopics, faqFor } from '../src/domain/guide.js';
import { FAQ } from '../src/domain/faq.js';
import { normalizeArabic } from '../src/domain/product.js';

// المسارات المسجّلة، من نص features/index.js (استيراده يحتاج DOM)
const routes = [...readFileSync('src/features/index.js', 'utf8').matchAll(/\{ path: '([^']+)'/g)].map((m) => m[1]);

test('every screen has a help topic', () => {
  assert.ok(routes.length > 40);
  for (const r of routes) assert.ok(topicForPath(r), `no guide topic for ${r} — add it to routes in src/domain/guide.js`);
  assert.equal(topicForPath('/customers/view?id=1').id, 'customer');
  assert.equal(topicForPath('/nope'), null);
});

test('topics are complete and point at real screens and images', () => {
  const ids = new Set();
  const seenRoutes = new Set();
  for (const t of TOPICS) {
    assert.ok(!ids.has(t.id), `duplicate topic ${t.id}`);
    ids.add(t.id);
    assert.ok(GUIDE_CATS.some((c) => c.id === t.cat), `${t.id}: unknown category`);
    assert.ok(t.title && t.icon && t.why.length > 30, `${t.id}: title, icon and why`);
    assert.ok(t.steps.length >= 2 && t.steps.every((s) => s.length > 5), `${t.id}: steps`);
    assert.ok(Array.isArray(t.tips) && Array.isArray(t.shots), t.id);
    for (const r of t.routes) {
      assert.ok(routes.includes(r), `${t.id}: route ${r} does not exist`);
      assert.ok(!seenRoutes.has(r), `${r} is explained by two topics`);
      seenRoutes.add(r);
    }
    if (t.open) assert.ok(routes.includes(t.open.split('?')[0]), `${t.id}: open ${t.open}`);
    for (const s of t.shots) {
      assert.ok(SHOT_CAPTIONS[s], `${t.id}: no caption for image ${s}`);
      assert.ok(existsSync(`guide/${s}.webp`), `${t.id}: guide/${s}.webp is missing — run npm run guide:shots`);
    }
  }
  for (const c of GUIDE_CATS) assert.ok(topicsOf(c.id).length, `empty category ${c.id}`);
  assert.equal(topicById('sale').title, 'شاشة البيع');
});

test('search finds topics by Arabic words, title matches first', () => {
  const find = (q) => searchTopics(q, normalizeArabic).map((t) => t.id);
  assert.equal(find('جرد')[0], 'count');
  assert.ok(find('الصندوق').includes('cash'));
  assert.ok(find('إغلاق').includes('cash')); // من keys، مع توحيد الهمزات
  assert.ok(find('راتب سلفة').includes('payroll'));
  assert.deepEqual(find('   '), []);
  assert.deepEqual(find('ققققق'), []);
});

test('FAQ entries are complete and link to real screens and topics', () => {
  const qs = new Set();
  for (const g of FAQ) {
    assert.ok(g.group && g.icon && g.items.length);
    for (const it of g.items) {
      assert.ok(it.q && it.a.length > 20, it.q);
      assert.ok(!qs.has(it.q), `duplicate question: ${it.q}`);
      qs.add(it.q);
      if (it.go) assert.ok(routes.includes(it.go[0].split('?')[0]) && it.go[1], `${it.q}: ${it.go[0]}`);
      if (it.t) assert.ok(topicById(it.t), `${it.q}: unknown topic ${it.t}`);
    }
  }
  assert.ok(faqFor(topicById('sale'), FAQ).length >= 5);
  assert.ok(faqFor(topicById('supplier'), FAQ).some((it) => it.q.includes('موعد الدفع')));
});
