// التحديثات — منطق نقي: مقارنة أرقام الإصدارات ومن أين تُنزَّل كل نسخة.
export const RELEASES_API = 'https://api.github.com/repos/makeflow-LLC/Daftara-Cashier/releases/latest';
export const CHECK_EVERY_MS = 24 * 3600 * 1000; // الفحص التلقائي مرة في اليوم

/** "v1.2.3" أو "1.2" ← [1, 2, 3] ؛ null لغير الأرقام ("dev"، "preview"). */
export function parseVersion(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}

/** هل latest أحدث من current؟ (false إن لم يُفهم أحدهما: لا ندعو لتحديث بلا يقين) */
export function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** من رد GitHub «آخر إصدار» ← رقم الإصدار للزبائن، أو null (النسخ التجريبية لا تُعرض تحديثًا). */
export function releaseVersion(json) {
  if (!json || json.draft || json.prerelease) return null;
  const v = parseVersion(json.tag_name);
  return v ? v.join('.') : null;
}

/** أين يُنزَّل التحديث لكل نسخة. الويب يتحدّث وحده (عامل الخدمة) فلا رابط له. */
export function updateTarget(flavor) {
  if (flavor === 'play') return { url: 'https://play.google.com/store/apps/details?id=com.makeflow.daftara.cashier', label: 'افتح Google Play' };
  if (flavor === 'desktop') return { url: 'https://makeflow.tech/apps/cashier/daftara-cashier-setup.exe', label: 'نزّل التحديث' };
  if (flavor === 'web') return null;
  return { url: 'https://makeflow.tech/apps/cashier/daftara-cashier.apk', label: 'نزّل التحديث' };
}
