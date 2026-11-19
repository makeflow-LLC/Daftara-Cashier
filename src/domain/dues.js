// مواعيد السداد للتجار (نقي): «وعدته أدفع الخميس». موعد واحد لكل تاجر (التاريخ المحلي YYYY-MM-DD)،
// يُنبَّه عليه قبل حلوله بـ ALERT_DAYS أيام، ويوم حلوله، وكل يوم بعده حتى يُسدَّد أو يُؤجَّل.
// الموعد بلا معنى إن لم يبقَ عليك شيء للتاجر، فيُتجاهل.
export const ALERT_DAYS = 3;
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

/** تاريخ اليوم المحلي: 2026-11-19 */
export function dateKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** هل هو تاريخ حقيقي بصيغة YYYY-MM-DD؟ */
export function isDateKey(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

const midnight = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

/** تاريخ بعد n يومًا من اليوم (لأزرار «بعد أسبوع»، «بعد شهر»). */
export function addDays(n, now = Date.now()) {
  const d = new Date(now);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime());
}

/** كم يومًا بقي للموعد (سالب = متأخر). الحساب بالأيام التقويمية لا بالساعات. */
export function daysUntil(due, now = Date.now()) {
  return Math.round((midnight(due) - midnight(dateKey(now))) / DAY);
}

/** state: overdue (فات) | today | soon (خلال ALERT_DAYS) | later. alert = يستحق التنبيه الآن. */
export function dueStatus(due, now = Date.now()) {
  const days = daysUntil(due, now);
  const state = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= ALERT_DAYS ? 'soon' : 'later';
  return { days, state, alert: state !== 'later' };
}

/** 1 يوم، يومين، 3 أيام، 11 يومًا */
export function daysText(n) {
  if (n === 1) return 'يوم';
  if (n === 2) return 'يومين';
  return n >= 3 && n <= 10 ? `${n} أيام` : `${n} يومًا`;
}

/** «اليوم»، «غدًا»، «بعد 3 أيام»، «متأخر يومين» */
export function dueText(status) {
  if (status.state === 'today') return 'اليوم';
  if (status.days === 1) return 'غدًا';
  if (status.days < 0) return `متأخر ${daysText(-status.days)}`;
  return `بعد ${daysText(status.days)}`;
}

/**
 * التجار الذين عليك لهم ولهم موعد سداد، الأقرب (والمتأخر) أولًا.
 * suppliers: [{ id, name, balance }]، dueMap: { id: 'YYYY-MM-DD' }.
 */
export function dueList(suppliers, dueMap, now = Date.now()) {
  const map = dueMap || {};
  return suppliers
    .filter((s) => s.balance > 0 && isDateKey(map[s.id]))
    .map((s) => ({ ...s, due: map[s.id], status: dueStatus(map[s.id], now) }))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : b.balance - a.balance));
}

/** ما يستحق التنبيه الآن: { items, total, overdue } أو null. */
export function dueAlerts(suppliers, dueMap, now = Date.now()) {
  const items = dueList(suppliers, dueMap, now).filter((s) => s.status.alert);
  if (!items.length) return null;
  return { items, total: items.reduce((t, s) => t + s.balance, 0), overdue: items.filter((s) => s.status.state === 'overdue').length };
}

/** يحذف من الخريطة مواعيد من لم يعد موجودًا أو لم يبقَ عليك له شيء (تبقى الإعدادات صغيرة). */
export function pruneDues(dueMap, suppliers) {
  const owing = new Set(suppliers.filter((s) => s.balance > 0).map((s) => s.id));
  const out = {};
  for (const [id, d] of Object.entries(dueMap || {})) if (owing.has(id) && isDateKey(d)) out[id] = d;
  return out;
}
