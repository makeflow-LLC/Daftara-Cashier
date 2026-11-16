// مواعيد الدفع للموردين (نقي): «متى أدفع لأبو خالد؟». الموعد في settings.supplierDues للمحل:
//   { [supplierId]: { date: 'YYYY-MM-DD', note } } — والمبلغ هو رصيد المورّد نفسه (ما عليك له).
const DAY = 86400000;

/** يوم + n أيام ('YYYY-MM-DD'، بلا مشاكل التوقيت الصيفي). */
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** الفرق بالأيام من today إلى day (سالب = مضى). */
export function daysBetween(today, day) {
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY);
}

/** { days, state: 'overdue'|'today'|'soon'|'later' } — soon = خلال 3 أيام. */
export function dueStatus(day, today, soonDays = 3) {
  const days = daysBetween(today, day);
  const state = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= soonDays ? 'soon' : 'later';
  return { days, state };
}

export function dueText(days) {
  if (days < -2) return `متأخر ${-days} أيام`;
  if (days === -2) return 'متأخر يومين';
  if (days === -1) return 'متأخر يومًا';
  if (days === 0) return 'اليوم';
  if (days === 1) return 'غدًا';
  if (days === 2) return 'بعد يومين';
  return `بعد ${days} أيام`;
}

/**
 * suppliers: [{ id, name, balance }] ← الموردون الذين عليك لهم وموعدهم قريب أو فات، الأقدم أولًا:
 * [{ supplier, date, days, state }]. من سُدّد رصيده لا يظهر حتى لو بقي له موعد.
 */
export function supplierDues(suppliers, dues, today, { soonDays = 3, all = false } = {}) {
  const out = [];
  for (const s of suppliers) {
    const d = dues && dues[s.id];
    if (!d || !d.date || !(s.balance > 0)) continue;
    const st = dueStatus(d.date, today, soonDays);
    if (!all && st.state === 'later') continue;
    out.push({ supplier: s, date: d.date, note: d.note || null, ...st });
  }
  return out.sort((a, b) => a.days - b.days);
}
