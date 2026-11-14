// يبني tools/license-generator.html: ملف واحد يعمل بلا إنترنت (مكتبة التوقيع مضمّنة داخله).
//   node scripts/build-generator.mjs          يكتب الملف
//   import { buildGenerator }                  للاختبار (يتأكد أن الملف المحفوظ محدَّث)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
export function buildGenerator() {
  const tpl = readFileSync(new URL('scripts/generator.template.html', root), 'utf8');
  const nacl = readFileSync(new URL('vendor/nacl-fast.min.js', root), 'utf8').trim();
  return tpl.replace('/*NACL*/', () => nacl);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('tools/license-generator.html', root), buildGenerator());
  console.log('tools/license-generator.html written');
}
