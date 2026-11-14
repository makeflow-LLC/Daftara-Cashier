import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyBuffer } from '../src/ui/keyscan.js';

test('USB barcode reader: fast digits + Enter is a scan, human typing is not', () => {
  const b = createKeyBuffer();
  let t = 1000;
  for (const k of '6291003000017') assert.equal(b.push(k, (t += 8)), null);
  assert.equal(b.push('Enter', (t += 10)), '6291003000017');
  // كتابة بشرية بطيئة
  for (const k of '62910') b.push(k, (t += 250));
  assert.equal(b.push('Enter', (t += 200)), null);
  // قصير جدًا
  for (const k of '12') b.push(k, (t += 5));
  assert.equal(b.push('Enter', (t += 5)), null);
  // مفتاح خاص يقطع المسح
  for (const k of '4006') b.push(k, (t += 5));
  b.push('Shift', (t += 5));
  for (const k of '381') b.push(k, (t += 5));
  assert.equal(b.push('Enter', (t += 5)), null);
});
