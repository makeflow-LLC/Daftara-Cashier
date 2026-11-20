// المصاريف على الجهاز: إضافة وتعديل وحذف (مع تراجع)، وقراءة مصاريف فترة. ودفع راتب موظف = مصروف ببند «رواتب».
// المصروف المدفوع نقدًا يخرج من الدرج (features/cash/repo.js يطرحه من المتوقع).
import { expenseProblem, expensesInRange, SALARY, isPeriod } from '../../domain/expenses.js';

export function createExpenseRepo({ db, store, clock }) {
  function invalid(message) { return Object.assign(new Error(message), { errors: { amount: message } }); }
  async function openSessionId() {
    const s = (await db.cash_sessions.orderBy('opened_at').reverse().limit(5).toArray()).find((x) => !x.deleted && !x.closed_at);
    return s ? s.id : null;
  }

  const repo = {
    /** كل المصاريف غير المحذوفة (للتقارير والرواتب). */
    async all() {
      return (await db.expenses.toArray()).filter((e) => !e.deleted);
    },
    /** مصاريف فترة، الأحدث أولًا. */
    async list(from, to) {
      return expensesInRange(await db.expenses.where('spent_at').between(from, to, true, false).toArray(), from, to);
    },
    /**
     * يحفظ مصروفًا جديدًا أو يعدّله (id).
     * method: طريقة الدفع { id, kind } — نقدًا تخرج من الدرج؛ null = من خارج الصندوق.
     */
    async save({ id = null, category, amount, method = null, note = null, spent_at = null, employee_id = null, period = null }) {
      const row = {
        category: String(category || '').trim() || null, amount,
        method_id: method ? method.id : null,
        note: note ? String(note).trim().slice(0, 200) || null : null,
        spent_at: spent_at || clock(),
        employee_id: employee_id || null, period: period && isPeriod(period) ? period : null,
      };
      const err = expenseProblem(row);
      if (err) throw invalid(err);
      if (row.category === SALARY && row.employee_id && !row.period) throw invalid('اختر شهر الراتب');
      if (id) return store.patch('expenses', id, row);
      return store.put('expenses', { ...row, cash_session_id: method && method.kind === 'cash' ? await openSessionId() : null });
    },
    remove(id) { return store.remove('expenses', id); },
    restore(id) { return store.patch('expenses', id, { deleted: false }); },
  };
  return repo;
}
