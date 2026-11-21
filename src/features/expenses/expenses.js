// المصاريف: كهرباء، إيجار، رواتب، مواصلات… كل مصروف بمبلغه وبنده وتاريخه، ومجموع الشهر حسب البند.
// المدفوع نقدًا يخرج من الدرج. ومجموع المصاريف يُطرح من ربح البضاعة في التقارير ← صافي الربح.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, button, input, field, money, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import {
  EXPENSE_CATEGORIES, SALARY, categoryName, categoryIcon, customCategories, expenseTotals,
  periodOf, addMonths, periodLabel, periodBounds,
} from '../../domain/expenses.js';
import { localDay } from '../../domain/offers.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';

const cur = () => app.shop?.base_currency || 'ILS';
const dayText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });

/** من أين دُفع: طرق الدفع (نقدًا = من الدرج) + «من خارج الصندوق». يرجع { el, get }. */
export function methodPicker(methods, currentId = undefined) {
  const list = methods.filter((m) => m.kind !== 'credit');
  let method = currentId === undefined ? (list.find((m) => m.kind === 'cash') || null) : (list.find((m) => m.id === currentId) || null);
  const el = h('div', { class: 'chips' });
  const paint = () => fill(el,
    ...list.map((m) => h('button', { class: `chip ${method === m ? 'on' : ''}`, type: 'button', onclick: () => { method = m; paint(); } }, m.kind === 'cash' ? 'من الدرج (نقدًا)' : m.name)),
    h('button', { class: `chip ${method ? '' : 'on'}`, type: 'button', onclick: () => { method = null; paint(); } }, 'من خارج الصندوق'));
  paint();
  return { el, get: () => method };
}

/** ورقة مصروف جديد أو تعديله. */
export async function expenseSheet(expense = null, { onSaved = null } = {}) {
  const minor = CURRENCIES[cur()].minor;
  const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0', value: expense ? formatDecimal(expense.amount, minor, { trim: true, group: false }) : '' });
  const note = input({ maxlength: 120, placeholder: 'مثال: فاتورة شهر 10 (اختياري)', value: expense ? expense.note || '' : '' });
  const date = input({ type: 'date', dir: 'ltr', value: expense ? localDay(new Date(expense.spent_at)) : localDay(), max: localDay() });
  const methods = await app.sales.paymentMethods();
  const pick = methodPicker(methods, expense ? expense.method_id : undefined);
  let category = expense ? expense.category : null;
  const cats = h('div', { class: 'chips' });
  const paintCats = () => {
    const custom = customCategories(app.shop?.settings?.expenseCategories);
    // بند قديم حُذف من القائمة يبقى ظاهرًا لمصروفه
    const extra = category && !EXPENSE_CATEGORIES.some((c) => c.key === category) && !custom.includes(category) ? [category] : [];
    fill(cats,
      ...EXPENSE_CATEGORIES.map((c) => h('button', { class: `chip ${category === c.key ? 'on' : ''}`, type: 'button', onclick: () => { category = c.key; paintCats(); } }, icon(c.icon, 16), c.name)),
      ...[...custom, ...extra].map((n) => h('button', { class: `chip ${category === n ? 'on' : ''}`, type: 'button', onclick: () => { category = n; paintCats(); } }, n)),
      h('button', { class: 'chip chip-ghost', type: 'button', onclick: newCategory }, icon('plus', 16), 'بند جديد'));
  };
  function newCategory() {
    const name = input({ maxlength: 30, placeholder: 'مثال: نظافة، ضيافة' });
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const n = customCategories([name.value])[0];
        if (!n) { feedback.error(); toast('اكتب اسم البند', { kind: 'error' }); return; }
        await app.updateShopSettings({ expenseCategories: customCategories([...(app.shop?.settings?.expenseCategories || []), n]) });
        category = n; close(); paintCats();
      },
    }, field('اسم البند', name), button('أضف البند', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: 'بند مصاريف جديد' });
    setTimeout(() => name.focus(), 150);
  }
  paintCats();
  let busy = false;
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      const v = parseMoney(amt.value || '', cur());
      if (!v || v <= 0) { feedback.error(); toast('اكتب مبلغ المصروف', { kind: 'error' }); amt.focus(); return; }
      if (!category) { feedback.error(); toast('اختر بند المصروف', { kind: 'error' }); return; }
      busy = true;
      try {
        // تاريخ اليوم = الآن؛ يوم سابق = ظهر ذلك اليوم
        const spent = date.value && date.value !== localDay() ? new Date(`${date.value}T12:00:00`).toISOString() : (expense && localDay(new Date(expense.spent_at)) === localDay() ? expense.spent_at : null);
        const saved = await app.expenses.save({
          id: expense ? expense.id : null, category, amount: v, method: pick.get(), note: note.value, spent_at: spent,
          employee_id: expense ? expense.employee_id : null, period: expense ? expense.period : null,
        });
        feedback.ok(); close();
        toast(expense ? 'عُدّل المصروف' : `سُجّل مصروف ${categoryName(category)}: ${formatMoney(v, cur())}`, { kind: 'ok' });
        if (onSaved) onSaved(saved);
      } catch (err) { busy = false; feedback.error(); toast(err.message || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  },
    field('المبلغ', amt),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'البند'), cats),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'من أين دُفع؟'), pick.el,
      h('span', { class: 'field-hint' }, '«من الدرج» ينقص النقد المتوقع في الصندوق.')),
    h('div', { class: 'grid-2' }, field('التاريخ', date), field('ملاحظة', note)),
    button(expense ? 'حفظ التعديل' : 'حفظ المصروف', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    expense ? h('button', {
      class: 'btn btn-text btn-block btn-danger-text', type: 'button',
      onclick: async () => {
        if (busy) return;
        busy = true;
        await app.expenses.remove(expense.id);
        feedback.ok(); close();
        toast('حُذف المصروف', { undo: () => app.expenses.restore(expense.id) });
        if (onSaved) onSaved(null);
      },
    }, icon('trash', 20), h('span', null, 'حذف هذا المصروف')) : null,
  ), { title: expense ? 'تعديل المصروف' : 'مصروف جديد' });
  if (!expense) setTimeout(() => amt.focus(), 150);
}

export function renderExpenses(el) {
  let period = periodOf(localDay());
  const top = h('div');
  const list = h('div');
  // الرواتب شأن صاحب المحل: غيره لا يراها في القائمة ولا في المجموع
  const seeSalaries = app.payroll.allowed();

  el.append(header('المصاريف', { back: true }), h('div', { class: 'page split' }, top, list));

  async function load() {
    const { from, to } = periodBounds(period);
    const [items, methods] = await Promise.all([app.expenses.list(from, to), app.db.payment_methods.toArray()]);
    const shown = seeSalaries ? items : items.filter((e) => e.category !== SALARY);
    const t = expenseTotals(shown);
    const mName = new Map(methods.map((m) => [m.id, m.kind === 'cash' ? 'من الدرج' : m.name]));
    const isNow = period === periodOf(localDay());
    fill(top,
      h('div', { class: 'month-nav' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'الشهر السابق', onclick: () => { period = addMonths(period, -1); load(); } }, icon('back')),
        h('strong', null, isNow ? `هذا الشهر (${periodLabel(period).replace('شهر ', '')})` : periodLabel(period)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'الشهر التالي', disabled: isNow, onclick: () => { period = addMonths(period, 1); load(); } }, icon('chevron'))),
      h('div', { class: 'debt-card expense-card' },
        h('div', { class: 'hero-label' }, `مصاريف ${periodLabel(period)}`),
        h('div', { class: 'hero-value' }, money(t.total)),
        h('div', { class: 'hero-mini-label' }, t.count ? `${t.count} مصروف في ${t.byCategory.length} بند` : 'لا مصاريف مسجّلة')),
      button('مصروف جديد', { block: true, size: 'lg', icon: 'plus', onclick: () => expenseSheet(null) }),
      seeSalaries ? button('رواتب الموظفين', { kind: 'outline', block: true, icon: 'users', onclick: () => navigate('/payroll') }) : null,
      t.byCategory.length > 1 ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'حسب البند'),
        h('div', { class: 'list' }, ...t.byCategory.map((c) => h('div', { class: 'row' },
          h('span', { class: 'row-ic' }, icon(categoryIcon(c.key), 20)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.name), h('span', { class: 'row-sub' }, t.total ? `${Math.round((c.total / t.total) * 100)}% من المصاريف` : '')),
          h('span', { class: 'row-end strong' }, money(c.total)))))) : null,
    );
    fill(list, shown.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'كل المصاريف'),
      isWide() ? dataTable({
        rows: shown,
        onRow: (e) => expenseSheet(e),
        columns: [
          { key: 'date', label: 'التاريخ', by: (e) => e.spent_at, cell: (e) => num(dayText(e.spent_at)) },
          { key: 'cat', label: 'البند', by: (e) => categoryName(e.category), cell: (e) => h('span', { class: 'dt-name' }, h('span', { class: 'row-ic ic-debt' }, icon(categoryIcon(e.category), 18)), h('span', null, categoryName(e.category))) },
          { key: 'note', label: 'ملاحظة', grow: true, cell: (e) => e.note || '' },
          { key: 'method', label: 'دُفع من', by: (e) => (e.method_id ? (mName.get(e.method_id) || 'تحويل') : 'خارج'), cell: (e) => (e.method_id ? (mName.get(e.method_id) || 'تحويل') : h('span', { class: 'muted' }, 'من خارج الصندوق')) },
          { key: 'amount', label: 'المبلغ', num: true, by: (e) => e.amount, cell: (e) => h('span', { class: 'owed' }, money(e.amount)) },
        ],
      }) : h('div', { class: 'list' }, ...shown.map((e) => h('button', { class: 'row row-tap', type: 'button', onclick: () => expenseSheet(e) },
        h('span', { class: 'row-ic ic-debt' }, icon(categoryIcon(e.category), 20)),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, categoryName(e.category), e.note ? h('span', { class: 'muted' }, ` · ${e.note}`) : null),
          h('span', { class: 'row-sub' }, num(dayText(e.spent_at)), ' · ', e.method_id ? (mName.get(e.method_id) || 'تحويل') : 'من خارج الصندوق')),
        h('span', { class: 'row-end owed' }, money(e.amount))))))
      : emptyState('coins', 'لا مصاريف في هذا الشهر', 'سجّل الكهرباء والإيجار والمواصلات وكل ما يدفعه المحل، فيحسب التطبيق صافي ربحك الحقيقي.'));
  }

  load();
  const off = bus.on('data', (e) => { if (e.tables.includes('expenses')) load(); });
  const offShop = bus.on('shop', load);
  return () => { off(); offShop(); };
}
