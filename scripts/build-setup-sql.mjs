// يجمع كل ملفات supabase/migrations في ملف واحد supabase/setup.sql: نسخة ولصق واحدة في محرر SQL.
//   node scripts/build-setup-sql.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = new URL('../supabase/migrations/', import.meta.url);
export function buildSetupSql() {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  return `-- دفترة كاشير — إعداد الخادم كاملًا (${files.join(' + ')})\n`
    + '-- يُبنى تلقائيًا من supabase/migrations — لا تعدّله هنا. آمن لإعادة التشغيل.\n'
    + '-- Supabase Studio ← SQL Editor ← New query ← الصق كل الملف ← Run\n\n'
    + files.map((f) => `-- ===== ${f} =====\n${readFileSync(new URL(f, dir), 'utf8').trim()}\n`).join('\n')
    + "\nselect 'دفترة كاشير: تم تجهيز الخادم ✓' as result;\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../supabase/setup.sql', import.meta.url), buildSetupSql());
  console.log('supabase/setup.sql written');
}
