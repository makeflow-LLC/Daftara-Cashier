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
  if (days < -2) return `متأخر ${-days} ${-days <= 10 ? 'أيام' : 'يومًا'}`;
  if (days === -2) return 'متأخر يومين';
  if (days === -1) return 'متأخر يومًا';
  if (days === 0) return 'اليوم';
  if (days === 1) return 'غدًا';
  if (days === 2) return 'بعد يومين';
  return `بعد ${days} ${days <= 10 ? 'أيام' : 'يومًا'}`;
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

/** هل هو تاريخ حقيقي بصيغة YYYY-MM-DD؟ */
export function isDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** يحذف مواعيد من لم يعد موجودًا أو لم يبقَ عليك له شيء (تبقى الإعدادات صغيرة). keep: معرّف يُحفظ دائمًا. */
export function pruneDues(dues, suppliers, keep = null) {
  const owing = new Set(suppliers.filter((s) => s.balance > 0).map((s) => s.id));
  const out = {};
  for (const [id, d] of Object.entries(dues || {})) if (d && isDay(d.date) && (owing.has(id) || id === keep)) out[id] = d;
  return out;
}

/**
 * سطر التذكير اليومي من قائمة supplierDues: { title, sub (بلا مبلغ منسّق: total بأصغر وحدة), supplierId, overdue }.
 * واحد: «اليوم موعد الدفع لأبو خالد»؛ أكثر: «3 دفعات للتجار حان موعدها».
 */
export function dueSummary(list) {
  if (!list || !list.length) return null;
  const total = list.reduce((t, d) => t + d.supplier.balance, 0);
  const overdue = list.filter((d) => d.state === 'overdue').length;
  if (list.length === 1) {
    const d = list[0];
    const when = d.state === 'today' ? 'اليوم موعد الدفع لـ' : d.state === 'overdue' ? `${dueText(d.days)}: الدفع لـ` : `${dueText(d.days)} موعد الدفع لـ`;
    return { title: `${when} ${d.supplier.name}`, total, supplierId: d.supplier.id, overdue };
  }
  const n = list.length;
  return { title: n === 2 ? 'دفعتان للتجار حان موعدهما' : `${n} ${n <= 10 ? 'دفعات' : 'دفعة'} للتجار حان موعدها`, total, supplierId: null, overdue };
}
