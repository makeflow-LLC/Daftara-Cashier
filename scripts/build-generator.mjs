// يبني tools/license-generator.html: ملف واحد يعمل بلا إنترنت (مكتبة التوقيع مضمّنة داخله).
//   node scripts/build-generator.mjs          يكتب الملف
//   import { buildGenerator }                  للاختبار (يتأكد أن الملف المحفوظ محدَّث)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
export function buildGenerator() {
  const tpl = readFileSync(new URL('scripts/generator.template.html', root), 'utf8');
  const nacl = readFileSync(new URL('vendor/nacl-fast.min.js', root), 'utf8').trim();
  const vault = readFileSync(new URL('scripts/license-vault.txt', root), 'utf8').trim();
  if (!/^DCV1\.[A-Za-z0-9+/=]+$/.test(vault)) throw new Error('scripts/license-vault.txt is not a sealed key');
  return tpl.replace('/*NACL*/', () => nacl).replace('/*VAULT*/', () => vault);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('tools/license-generator.html', root), buildGenerator());
  console.log('tools/license-generator.html written');
}
