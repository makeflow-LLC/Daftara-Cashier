// التوافق مع جوالات أندرويد 8 وما بعده بـ WebView قديم (الحد الأدنى Chrome 80):
// نمنع ميزات JavaScript و CSS الأحدث منه. وجد اختبار المحاكي (WebView 83) أن replaceChildren وحده يعطّل التطبيق كله.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir, ext) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

const JS_BANNED = [
  [/\.replaceChildren\(/, 'replaceChildren (Chrome 86) — use fill() from ui/dom.js'],
  [/\bstructuredClone\(/, 'structuredClone (Chrome 98)'],
  [/\.replaceAll\(/, 'String.replaceAll (Chrome 85)'],
  [/\.at\(-?\d/, 'Array/String .at() (Chrome 92)'],
  [/(\?\?|\|\||&&)=/, 'logical assignment ??= ||= &&= (Chrome 85)'],
  [/Object\.hasOwn\(/, 'Object.hasOwn (Chrome 93)'],
  [/\.findLast(Index)?\(/, 'findLast (Chrome 97)'],
  [/\.(toSorted|toReversed|toSpliced)\(/, 'change-array-by-copy (Chrome 110)'],
  [/^\s*#\w+\s*[=;(]/m, 'private class fields (Chrome 84)'],
  [/^await\s/m, 'top-level await (Chrome 89)'],
];
const CSS_BANNED = [
  [/(^|[;{\s])inset\s*:/, 'inset (Chrome 87)'],
  [/(padding|margin)-(inline|block)/, 'logical properties (Chrome 87)'],
  [/aspect-ratio/, 'aspect-ratio (Chrome 88)'],
  [/:has\(/, ':has() (Chrome 105)'],
  [/\bclamp\(/, 'clamp() ok since 79 — allowed'],
];

test('JavaScript runs on WebView 80+', () => {
  for (const f of files('src', '.js')) {
    const src = readFileSync(f, 'utf8');
    for (const [re, what] of JS_BANNED) assert.ok(!re.test(src), `${f}: ${what}`);
  }
});

test('CSS works on WebView 80+', () => {
  const css = readFileSync('styles/app.css', 'utf8');
  for (const [re, what] of CSS_BANNED.slice(0, 4)) assert.ok(!re.test(css), `styles/app.css: ${what}`);
});
