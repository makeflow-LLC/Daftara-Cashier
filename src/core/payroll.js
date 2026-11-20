// رواتب الموظفين: القائمة في إعدادات المحل settings.payroll (تتزامن بين الأجهزة)، ودفع الراتب مصروف ببند «رواتب».
// تذكير مرة في اليوم بما حان موعده أو تأخر (والرئيسية تعرضه في التنبيهات). المنطق في domain/expenses.js.
import { payrollEmployees, payrollDue, payrollSummary, employeeProblem, salaryStatus, periodOf, SALARY } from '../domain/expenses.js';
import { localDay } from '../domain/offers.js';
import { formatMoney } from '../domain/currency.js';
import { uuid } from './ids.js';

const TOLD_KEY = 'cashier-payroll-told';

export function createPayroll(app, { toast = () => {}, storage = globalThis.localStorage, today = () => localDay() } = {}) {
  const all = () => (app.shop?.settings?.payroll?.employees || []).filter((e) => e && e.id);
  const save = (employees) => app.updateShopSettings({ payroll: { employees } });
  /** الرواتب شأن صاحب المحل وحده. */
  const allowed = () => !app.staff || !!app.user?.owner;

  const p = {
    allowed,
    employees: () => payrollEmployees(app.shop?.settings),
    get: (id) => all().find((e) => e.id === id) || null,

    /** موظف جديد أو تعديله: { id?, name, salary, payDay, staffId?, phone? } */
    async saveEmployee(input) {
      const emp = {
        name: String(input.name || '').trim().slice(0, 60), salary: input.salary, payDay: input.payDay,
        staffId: input.staffId || null, phone: input.phone ? String(input.phone).trim() || null : null,
      };
      const err = employeeProblem(emp);
      if (err) throw new Error(err);
      const list = all();
      if (input.id) {
        await save(list.map((e) => (e.id === input.id ? { ...e, ...emp } : e)));
        return p.get(input.id);
      }
      const row = { id: uuid(), ...emp, since: today(), active: true };
      await save([...list, row]);
      return row;
    },
    /** لا يُمحى الموظف (رواتبه المدفوعة تبقى في المصاريف): يصير غير عامل. */
    async removeEmployee(id) { await save(all().map((e) => (e.id === id ? { ...e, active: false } : e))); },
    async restoreEmployee(id) { await save(all().map((e) => (e.id === id ? { ...e, active: true } : e))); },

    /** حالة كل موظف عن شهر (الحالي افتراضيًا). */
    async statuses(period = periodOf(today())) {
      const expenses = await app.expenses.all();
      return p.employees().map((e) => salaryStatus(e, expenses, today(), period));
    },
    /** يدفع راتبًا (كله أو جزءًا): مصروف ببند «رواتب» باسم الموظف وشهره. */
    async pay(employeeId, { amount, period = periodOf(today()), method = null, note = null }) {
      const emp = p.get(employeeId);
      if (!emp) throw new Error('الموظف غير موجود');
      return app.expenses.save({ category: SALARY, amount, method, period, employee_id: emp.id, note: note || `راتب ${emp.name}` });
    },
    /** دفعات موظف، الأحدث أولًا. */
    async payments(employeeId) {
      return (await app.expenses.all()).filter((e) => e.category === SALARY && e.employee_id === employeeId)
        .sort((a, b) => (a.spent_at < b.spent_at ? 1 : -1));
    },

    /** ما حان موعده أو اقترب ولم يُدفع. */
    async due(day = today()) {
      if (!app.shop || !allowed()) return [];
      const emps = p.employees();
      if (!emps.length) return [];
      return payrollDue(emps, await app.expenses.all(), day);
    },
    async check(day = today()) {
      const s = payrollSummary(await p.due(day));
      if (!s) return null;
      let told = null;
      try { told = storage.getItem(TOLD_KEY); } catch { /* */ }
      if (told === day) return s;
      try { storage.setItem(TOLD_KEY, day); } catch { /* */ }
      toast(`${s.title} — ${formatMoney(s.total, app.shop?.base_currency || 'ILS')}`, { kind: s.overdue ? 'error' : 'info', ms: 6000 });
      return s;
    },
    start() {
      setTimeout(() => p.check().catch(() => {}), 6000);
      setInterval(() => p.check().catch(() => {}), 30 * 60 * 1000);
    },
  };
  return p;
}
