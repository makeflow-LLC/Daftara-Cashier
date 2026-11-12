// يجمع ملفات التطبيق في مجلد واحد نظيف (www) يغلّفه Capacitor في تطبيق أندرويد.
// ويكتب www/config.js من متغيرات البيئة — لا عنوان خادم ولا مفاتيح في الكود:
//   SUPABASE_URL, SUPABASE_ANON_KEY   (بدونهما: التطبيق كامل على الجهاز، والمزامنة متوقفة)
//   VERSION_CODE                      رقم البناء (GitHub Actions)
//   node scripts/build-www.mjs <المجلد>
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRIES = ['index.html', 'styles', 'src', 'vendor', 'icons'];

if (!process.argv[2]) { console.error('usage: build-www.mjs <dir>'); process.exit(1); }
const out = resolve(process.argv[2]);
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const e of ENTRIES) cpSync(e, `${out}/${e}`, { recursive: true });

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const build = parseInt(process.env.VERSION_CODE || '0', 10) || 0;
const cfg = {
  supabaseUrl: (process.env.SUPABASE_URL || '').trim(),
  supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
  flavor: process.env.APP_FLAVOR || 'direct',
  version: `${pkg.version || '0.1.0'}${build ? `.${build}` : ''}`,
  build,
};
writeFileSync(`${out}/config.js`, `window.CASHIER_CONFIG = ${JSON.stringify(cfg)};\n`);
console.log(`www ready in ${out} — sync ${cfg.supabaseUrl ? 'ON' : 'OFF (no SUPABASE_URL)'}, version ${cfg.version}`);
