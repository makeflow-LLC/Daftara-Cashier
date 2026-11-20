// المصاريف والرواتب (نقي): بنود المصاريف (كهرباء، إيجار، رواتب، مواصلات…)، مجاميعها لفترة،
// ما خرج منها من الدرج، ورواتب الموظفين: لكل موظف راتب ويوم دفع، وهل دُفع راتب الشهر أم تأخر.
// الموظفون في settings.payroll للمحل: { employees: [{ id, name, salary, payDay, staffId, since, active }] }
// ودفع الراتب مصروف عادي ببند «رواتب» يحمل employee_id وشهر الراتب period (YYYY-MM).
import { sum } from './money.js';
import { dueStatus, isDay } from './dues.js';

export const SALARY = 'salary';

export const EXPENSE_CATEGORIES = Object.freeze([
  { key: 'rent', name: 'إيجار', icon: 'store' },
  { key: 'electricity', name: 'كهرباء', icon: 'flash' },
  { key: 'water', name: 'ماء', icon: 'drop' },
  { key: 'internet', name: 'إنترنت واتصالات', icon: 'phone' },
  { key: 'transport', name: 'مواصلات ونقل', icon: 'truck' },
  { key: SALARY, name: 'رواتب', icon: 'users' },
  { key: 'maintenance', name: 'صيانة', icon: 'sliders' },
  { key: 'supplies', name: 'مستلزمات المحل', icon: 'basket' },
  { key: 'taxes', name: 'رسوم وضرائب', icon: 'clipboard' },
  { key: 'other', name: 'أخرى', icon: 'tag' },
]);
const BY_KEY = new Map(EXPENSE_CATEGORIES.map((c) => [c.key, c]));

/** اسم البند للعرض: المعروف باسمه، والبند الذي كتبه صاحب المحل كما هو. */
export function categoryName(key) {
  if (!key) return 'أخرى';
  return BY_KEY.has(key) ? BY_KEY.get(key).name : String(key);
}
export function categoryIcon(key) {
  return BY_KEY.has(key) ? BY_KEY.get(key).icon : 'tag';
}

/** بنود المحل الخاصة (settings.expenseCategories) بعد التنظيف: بلا تكرار ولا أسماء البنود الثابتة. */
export function customCategories(list) {
  const fixed = new Set(EXPENSE_CATEGORIES.flatMap((c) => [c.key, c.name]));
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const n = String(x ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (n && !fixed.has(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/** رسالة خطأ أو null. */
export function expenseProblem({ amount, category, spent_at }) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'اكتب مبلغ المصروف';
  if (!category || !String(category).trim()) return 'اختر بند المصروف';
  if (!spent_at || Number.isNaN(Date.parse(spent_at))) return 'التاريخ غير صحيح';
  return null;
}

/** مصاريف فترة (حسب تاريخ الصرف spent_at، to غير شاملة)، الأحدث أولًا. المحذوف لا يدخل. */
export function expensesInRange(expenses, from, to) {
  return expenses.filter((e) => !e.deleted && e.spent_at >= from && e.spent_at < to)
    .sort((a, b) => (a.spent_at < b.spent_at ? 1 : a.spent_at > b.spent_at ? -1 : 0));
}

/** { total, count, byCategory: [{ key, name, total, count }] } — الأكبر أولًا. */
export function expenseTotals(expenses) {
  const by = new Map();
  for (const e of expenses) {
    if (e.deleted) continue;
    const key = e.category || 'other';
    const c = by.get(key) || { key, name: categoryName(key), total: 0, count: 0 };
    c.total += e.amount; c.count += 1;
    by.set(key, c);
  }
  const byCategory = [...by.values()].sort((a, b) => b.total - a.total);
  return { total: sum(byCategory, (c) => c.total), count: sum(byCategory, (c) => c.count), byCategory };
}

/**
 * ما خرج من الدرج نقدًا للمصاريف منذ since: المصروف المدفوع بطريقة نقدية والمسجَّل (created_at) بعد فتح الصندوق.
 * مصروف «من خارج الصندوق» (بلا طريقة دفع) أو بتحويل لا يمسّ الدرج.
 */
export function drawerExpenses(expenses, cashMethodIds, since) {
  return sum(expenses.filter((e) => !e.deleted && e.method_id && cashMethodIds.has(e.method_id) && e.created_at >= since), (e) => e.amount);
}

// ---------- الشهور ----------
/** '2026-11-20' أو ISO ← '2026-11' */
export function periodOf(day) {
  return String(day).slice(0, 7);
}
export function isPeriod(p) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p ?? ''));
}
export function addMonths(period, n) {
  const [y, m] = period.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
/** '2026-11' ← «شهر 11/2026» */
export function periodLabel(period) {
  const [y, m] = String(period).split('-');
  return `شهر ${Number(m)}/${y}`;
}
/** حدود الشهر بتوقيت الجهاز: { from, to } ISO (to غير شاملة). */
export function periodBounds(period) {
  const [y, m] = period.split('-').map(Number);
  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
}

// ---------- الرواتب ----------
export const PAY_DAY_LAST = 31; // «آخر يوم في الشهر»

/** يوم دفع الراتب في شهر معيّن: 'YYYY-MM-DD' (اليوم 31 أو أكبر من أيام الشهر = آخر يوم فيه). */
export function payDate(period, payDay) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(Math.max(1, Number(payDay) || 1), last);
  return `${period}-${String(d).padStart(2, '0')}`;
}

/** رسالة خطأ أو null. */
export function employeeProblem({ name, salary, payDay }) {
  if (!String(name ?? '').trim()) return 'اكتب اسم الموظف';
  if (!Number.isSafeInteger(salary) || salary <= 0) return 'اكتب الراتب الشهري';
  if (!Number.isInteger(payDay) || payDay < 1 || payDay > PAY_DAY_LAST) return 'يوم الدفع بين 1 و 31';
  return null;
}

/** موظفو الرواتب العاملون من إعداد المحل. */
export function payrollEmployees(settings) {
  const list = settings && settings.payroll && Array.isArray(settings.payroll.employees) ? settings.payroll.employees : [];
  return list.filter((e) => e && e.id && e.active !== false);
}

/** ما دُفع لموظف عن شهر (مجموع مصاريف الرواتب غير المحذوفة). */
export function salaryPaid(expenses, employeeId, period) {
  return sum(expenses.filter((e) => !e.deleted && e.category === SALARY && e.employee_id === employeeId && e.period === period), (e) => e.amount);
}

/**
 * حالة راتب موظف عن شهر: { period, dueDate, paid, remaining, days, state }
 * state: 'paid' دُفع كاملًا | 'overdue' تأخر | 'today' اليوم موعده | 'soon' خلال 3 أيام | 'later' لم يحن.
 *        'unknown' موعد سبق إضافة الموظف إلى التطبيق ولم يُسجَّل دفعه.
 */
export function salaryStatus(emp, expenses, today, period = periodOf(today), soonDays = 3) {
  const dueDate = payDate(period, emp.payDay);
  const paid = salaryPaid(expenses, emp.id, period);
  const remaining = Math.max(0, emp.salary - paid);
  const st = dueStatus(dueDate, today, soonDays);
  // موعد سبق إضافة الموظف إلى التطبيق: لا نعدّه «متأخرًا» (قد يكون دُفع قبل استعمال التطبيق) — 'unknown'
  const before = st.state === 'overdue' && isDay(emp.since) && dueDate < emp.since;
  return { employee: emp, period, dueDate, paid, remaining, days: st.days, state: remaining === 0 ? 'paid' : before ? 'unknown' : st.state };
}

/**
 * الرواتب التي حان موعدها أو اقترب ولم تُدفع كاملة: الشهر الحالي وما قبله (back شهور)،
 * ولا نطالب بشهر سبق إضافة الموظف (since). الأقدم أولًا.
 */
export function payrollDue(employees, expenses, today, { soonDays = 3, back = 2 } = {}) {
  const out = [];
  const now = periodOf(today);
  for (const emp of employees) {
    if (emp.active === false) continue;
    for (let i = back; i >= 0; i--) {
      const st = salaryStatus(emp, expenses, today, addMonths(now, -i), soonDays);
      if (st.state === 'paid' || st.state === 'later' || st.state === 'unknown') continue;
      out.push(st);
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

/** سطر التذكير اليومي: { title, total, overdue } أو null. */
export function payrollSummary(list) {
  if (!list || !list.length) return null;
  const total = sum(list, (s) => s.remaining);
  const overdue = list.filter((s) => s.state === 'overdue').length;
  if (list.length === 1) {
    const s = list[0];
    const title = s.state === 'overdue' ? `راتب ${s.employee.name} متأخر` : s.state === 'today' ? `اليوم موعد راتب ${s.employee.name}` : `اقترب موعد راتب ${s.employee.name}`;
    return { title, total, overdue };
  }
  return { title: `${list.length} رواتب حان موعدها`, total, overdue };
}

/** مجموع الرواتب الشهرية للموظفين العاملين. */
export function monthlyPayroll(employees) {
  return sum(employees.filter((e) => e.active !== false), (e) => e.salary);
}
