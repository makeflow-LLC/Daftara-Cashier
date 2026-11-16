import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMono, trimBottom, escposRaster, toBase64, PAPER } from '../src/domain/printer.js';

function img(w, h, dark) {
  const a = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x, y] of dark) { const i = (y * w + x) * 4; a[i] = a[i + 1] = a[i + 2] = 0; }
  return a;
}

test('image to 1-bit rows (MSB first, padded to bytes; transparent is white)', () => {
  const m = toMono(img(10, 2, [[0, 0], [7, 0], [8, 0], [9, 1]]), 10, 2);
  assert.equal(m.bytesPerRow, 2);
  assert.deepEqual([...m.bits], [0b10000001, 0b10000000, 0, 0b01000000]);
  const clear = new Uint8ClampedArray(8 * 4); // RGBA كله صفر = شفاف
  assert.deepEqual([...toMono(clear, 8, 1).bits], [0]);
  const grey = new Uint8ClampedArray([150, 150, 150, 255, 200, 200, 200, 255]);
  assert.deepEqual([...toMono(grey, 2, 1).bits], [0b10000000], 'darker than threshold prints');
});

test('trim white rows at the bottom, keep at least one', () => {
  const m = toMono(img(8, 5, [[1, 1]]), 8, 5);
  assert.equal(trimBottom(m).height, 2);
  assert.equal(trimBottom(toMono(img(8, 3, []), 8, 3)).height, 1);
});

test('ESC/POS raster: init, GS v 0 bands with sizes, feed and cut', () => {
  const m = toMono(img(16, 5, [[0, 0]]), 16, 5);
  const b = escposRaster(m, { band: 2, feed: 3 });
  assert.deepEqual([...b.slice(0, 2)], [0x1b, 0x40]);
  assert.deepEqual([...b.slice(2, 10)], [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0], 'first band: 2 bytes wide, 2 rows');
  assert.equal(b[10], 0x80);
  // 3 شرائح (2+2+1): 2 + 3×8 رأس + 10 بايت صورة + 3 تغذية + 4 قص
  assert.equal(b.length, 2 + 3 * 8 + 10 + 3 + 4);
  assert.deepEqual([...b.slice(-7)], [0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0]);
  assert.equal(escposRaster(m, { cut: false }).length, 2 + 8 + 10 + 3);
  assert.equal(PAPER[58], 384);
  assert.equal(toBase64(new Uint8Array([0x1b, 0x40, 0xff])), 'G0D/');
});
