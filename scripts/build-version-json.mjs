// يكتب version.json لصفحة التنزيل (makeflow.tech/apps/cashier/version.json): التطبيق يقرؤه ليعرض «تحديث جديد متوفر».
//   node scripts/build-version-json.mjs v1.2.0 _site/version.json
import { readFileSync, writeFileSync } from 'node:fs';
import { changelogNotes } from '../src/domain/updates.js';

const [tag, out] = process.argv.slice(2);
if (!tag || !out) { console.error('usage: build-version-json.mjs <v1.2.3> <file>'); process.exit(1); }
const version = tag.replace(/^v/i, '');
const notes = changelogNotes(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version);
const base = 'https://makeflow.tech/apps/cashier';
writeFileSync(out, `${JSON.stringify({
  version,
  date: new Date().toISOString().slice(0, 10),
  notes,
  apk: `${base}/daftara-cashier.apk`,
  exe: `${base}/daftara-cashier-setup.exe`,
  play: 'https://play.google.com/store/apps/details?id=com.makeflow.daftara.cashier',
}, null, 2)}\n`);
console.log(`version.json: ${version} (${notes.length} notes)`);
