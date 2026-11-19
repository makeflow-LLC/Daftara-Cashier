import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareVersions, isNewer, changelogNotes, noteTitle } from '../src/domain/updates.js';

test('version order', () => {
  assert.equal(compareVersions('1.1.0', '1.0.7'), 1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v1.1.0', '1.1'), 0);
  assert.equal(compareVersions('1.0.7', '1.1.0'), -1);
  assert.equal(isNewer('1.1.1', '1.1.0'), true);
  assert.equal(isNewer('1.1.0', '1.1.0'), false);
  assert.equal(isNewer('1.0.9', '1.1.0'), false);
  assert.equal(isNewer('1.2.0', '0.1.0.58'), true, 'preview build number');
  assert.equal(isNewer('', '1.0.0'), false);
  assert.equal(isNewer('garbage', '1.0.0'), false);
});

test('notes come from the real CHANGELOG section', () => {
  const md = readFileSync('CHANGELOG.md', 'utf8');
  const n = changelogNotes(md, 'v1.1.0');
  assert.ok(n.length >= 8);
  assert.match(n[0], /الموظفون/);
  assert.equal(noteTitle(n[0]), 'الموظفون والصلاحيات');
  assert.deepEqual(changelogNotes(md, '9.9.9'), []);
  assert.deepEqual(changelogNotes('## 1.0.0\n- a\n- b\n## 0.9\n- c', '1.0.0'), ['a', 'b']);
});
