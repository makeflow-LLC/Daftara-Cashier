// التحديثات (نقي): مقارنة أرقام الإصدارات، و«ما الجديد» من سجل الإصدارات (CHANGELOG.md).
// البناء ينشر version.json على makeflow.tech مع كل إصدار (scripts/build-version-json.mjs)، والتطبيق يقارنه بنسخته.

/** 1.10.0 > 1.9.2 ؛ يرجع 1 أو 0 أو ‎-1. يتجاهل v في البداية وما بعد «-». */
export function compareVersions(a, b) {
  const parts = (v) => String(v || '').replace(/^v/i, '').split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** هل `latest` أحدث من `current`؟ (رقم غير صالح = لا) */
export function isNewer(latest, current) {
  const ok = (v) => /^v?\d+\.\d+(\.\d+)?/.test(String(v || ''));
  return ok(latest) && ok(current) && compareVersions(latest, current) > 0;
}

/** بنود «ما الجديد» لإصدار من CHANGELOG.md: السطور «- …» تحت «## 1.1.0». */
export function changelogNotes(markdown, version) {
  const v = String(version || '').replace(/^v/i, '');
  const lines = String(markdown || '').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${v}`);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) {
    const m = /^-\s+(.*)$/.exec(lines[i].trim());
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** أول جملة من البند (قبل «:») للعرض المختصر: «الموظفون والصلاحيات». */
export function noteTitle(note) {
  const i = note.indexOf(':');
  return (i > 0 && i < 60 ? note.slice(0, i) : note).trim();
}
