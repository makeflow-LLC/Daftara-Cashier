// رواتب الموظفين: لكل موظف راتب شهري ويوم دفع. الشاشة تقول من دُفع راتبه ومن تأخر، و«ادفع الراتب» بضغطة
// (كله أو جزءًا منه). الدفعة تُسجَّل مصروفًا ببند «رواتب» فتدخل في صافي الربح. لصاحب المحل وحده.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, button, input, field, money, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import { periodOf, addMonths, periodLabel, PAY_DAY_LAST, monthlyPayroll } from '../../domain/expenses.js';
import { dueText } from '../../domain/dues.js';
import { localDay } from '../../domain/offers.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { methodPicker } from './expenses.js';

const cur = () => app.shop?.base_currency || 'ILS';
const dayText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
const payDayText = (d) => (d >= PAY_DAY_LAST ? 'آخر يوم في الشهر' : `يوم ${d} من كل شهر`);

/** نص حالة الراتب ولونها. */
export function statusText(st) {
  if (st.state === 'paid') return { text: 'دُفع ✓', tone: 'ok' };
  const part = st.paid > 0 ? `الباقي ${formatMoney(st.remaining, cur())} — ` : '';
  if (st.state === 'unknown') return { text: `${part}لم يُسجَّل دفعه`, tone: '' };
  if (st.state === 'overdue') return { text: `${part}${dueText(st.days)}`, tone: 'bad' };
  if (st.state === 'today') return { text: `${part}موعده اليوم`, tone: 'bad' };
  return { text: `${part}موعده ${dueText(st.days)}`, tone: st.state === 'soon' ? 'warn' : '' };
}

export function renderPayroll(el) {
  let period = periodOf(localDay());
  const top = h('div');
  const list = h('div');
  el.append(header('رواتب الموظفين', { back: true }), h('div', { class: 'page split' }, top, list));

  async function load() {
    const sts = await app.payroll.statuses(period);
    const isNow = period === periodOf(localDay());
    const total = monthlyPayroll(sts.map((s) => s.employee));
    const paid = sts.reduce((a, s) => a + Math.min(s.paid, s.employee.salary), 0);
    fill(top,
      h('div', { class: 'month-nav' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'الشهر السابق', onclick: () => { period = addMonths(period, -1); load(); } }, icon('back')),
        h('strong', null, isNow ? `رواتب هذا الشهر (${periodLabel(period).replace('شهر ', '')})` : `رواتب ${periodLabel(period)}`),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'الشهر التالي', disabled: isNow, onclick: () => { period = addMonths(period, 1); load(); } }, icon('chevron'))),
      sts.length ? h('div', { class: `balance-card ${paid >= total ? 'clear' : 'owed'}` },
        h('div', { class: 'hero-label' }, paid >= total ? 'دُفعت كل الرواتب' : 'باقٍ من رواتب الشهر'),
        h('div', { class: 'hero-value' }, money(Math.max(0, total - paid))),
        h('div', { class: 'hero-mini-label' }, 'مجموع الرواتب ', num(formatMoney(total, cur())), ' — دُفع ', num(formatMoney(paid, cur())))) : null,
      button('موظف جديد', { block: true, size: 'lg', icon: 'plus', onclick: () => employeeSheet(null) }),
    );
    fill(list, sts.length && isWide() ? h('div', { class: 'section' }, dataTable({
      rows: sts,
      onRow: (st) => openEmployee(st),
      columns: [
        { key: 'name', label: 'الموظف', grow: true, by: (st) => st.employee.name, cell: (st) => h('span', { class: 'dt-name' }, h('span', { class: `avatar ${st.state === 'overdue' || st.state === 'today' ? 'owed' : ''}` }, st.employee.name.trim().charAt(0)), h('span', null, st.employee.name)) },
        { key: 'day', label: 'يوم الدفع', by: (st) => st.employee.payDay, cell: (st) => payDayText(st.employee.payDay) },
        { key: 'salary', label: 'الراتب', num: true, by: (st) => st.employee.salary, cell: (st) => money(st.employee.salary) },
        { key: 'paid', label: 'دُفع', num: true, by: (st) => st.paid, cell: (st) => (st.paid ? h('span', { class: 'credit' }, money(st.paid)) : h('span', { class: 'muted' }, '—')) },
        { key: 'rest', label: 'الباقي', num: true, by: (st) => st.remaining, cell: (st) => (st.remaining > 0 ? h('span', { class: 'owed' }, money(st.remaining)) : h('span', { class: 'muted' }, '—')) },
        { key: 'state', label: 'الحالة', by: (st) => st.state, cell: (st) => { const s = statusText(st); return h('span', { class: `pill pill-${s.tone}` }, s.text); } },
      ],
    })) : sts.length ? h('div', { class: 'list section' }, ...sts.map((st) => {
      const s = statusText(st);
      return h('button', { class: 'row row-tap', type: 'button', onclick: () => openEmployee(st) },
        h('span', { class: `avatar ${st.state === 'overdue' || st.state === 'today' ? 'owed' : ''}` }, st.employee.name.trim().charAt(0)),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, st.employee.name),
          h('span', { class: 'row-sub' }, 'الراتب ', num(formatMoney(st.employee.salary, cur())), ` · ${payDayText(st.employee.payDay)}`),
          h('span', null, h('span', { class: `pill pill-${s.tone}` }, s.text))),
        icon('chevron', 20, 'row-go'));
    }))
      : emptyState('users', 'لا موظفين بعد', 'أضف كل موظف براتبه ويوم دفعه: يذكّرك التطبيق بموعد الراتب، ويقول لك من دُفع له ومن تأخر.'));
  }

  // بطاقة الموظف: حالته هذا الشهر، ادفع، دفعاته السابقة، تعديل وحذف
  async function openEmployee(st) {
    const emp = st.employee;
    const pays = (await app.payroll.payments(emp.id)).slice(0, 12);
    const s = statusText(st);
    openSheet((close) => h('div', null,
      h('div', { class: `balance-card ${st.state === 'paid' ? 'clear' : 'owed'}` },
        h('div', { class: 'hero-label' }, st.state === 'paid' ? `راتب ${periodLabel(st.period)}` : `باقٍ من راتب ${periodLabel(st.period)}`),
        h('div', { class: 'hero-value' }, money(st.state === 'paid' ? emp.salary : st.remaining)),
        h('div', { class: 'hero-mini-label' }, st.state === 'paid' ? 'دُفع كاملًا' : s.text, ' · ', payDayText(emp.payDay))),
      st.remaining > 0 ? button(st.paid > 0 ? 'ادفع باقي الراتب' : 'ادفع الراتب', { block: true, size: 'lg', icon: 'cash', onclick: () => { close(); paySheet(st); } }) : null,
      st.remaining === 0 ? button('دفعة إضافية (سلفة أو مكافأة)', { kind: 'outline', block: true, icon: 'plus', onclick: () => { close(); paySheet(st, true); } }) : null,
      pays.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'ما دُفع له'),
        h('div', { class: 'list' }, ...pays.map((p) => h('div', { class: 'row' },
          h('span', { class: 'row-ic' }, icon('check', 20)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.period ? periodLabel(p.period) : 'دفعة'), h('span', { class: 'row-sub' }, num(dayText(p.spent_at)))),
          money(p.amount),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'حذف الدفعة', onclick: async () => {
            await app.expenses.remove(p.id);
            close(); feedback.ok();
            toast('حُذفت الدفعة', { undo: () => app.expenses.restore(p.id) });
          } }, icon('trash', 18)))))) : null,
      button('تعديل الراتب أو يوم الدفع', { kind: 'outline', block: true, icon: 'edit', onclick: () => { close(); employeeSheet(emp); } }),
      button('حذف الموظف', { kind: 'text', onclick: async () => {
        await app.payroll.removeEmployee(emp.id);
        close();
        toast(`حُذف «${emp.name}» من الرواتب`, { undo: () => app.payroll.restoreEmployee(emp.id) });
      } }),
    ), { title: emp.name });
  }

  async function paySheet(st, extra = false) {
    const emp = st.employee;
    const minor = CURRENCIES[cur()].minor;
    const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0', value: extra ? '' : formatDecimal(st.remaining, minor, { trim: true, group: false }) });
    const pick = methodPicker(await app.sales.paymentMethods());
    let busy = false;
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (busy) return;
        const v = parseMoney(amt.value || '', cur());
        if (!v || v <= 0) { feedback.error(); toast('اكتب المبلغ', { kind: 'error' }); amt.focus(); return; }
        busy = true;
        try {
          await app.payroll.pay(emp.id, { amount: v, period: st.period, method: pick.get() });
          feedback.ok(); close();
          const left = Math.max(0, st.remaining - v);
          toast(left && !extra ? `دُفع ${formatMoney(v, cur())} — الباقي له ${formatMoney(left, cur())}` : `دُفع راتب ${emp.name} ✓`, { kind: 'ok', ms: 3500 });
        } catch (err) { busy = false; feedback.error(); toast(err.message || 'تعذّر الحفظ', { kind: 'error' }); }
      },
    },
      h('p', { class: 'muted' }, `${periodLabel(st.period)} — الراتب `, num(formatMoney(emp.salary, cur())), st.paid ? [' — دُفع ', num(formatMoney(st.paid, cur()))] : null),
      field('المبلغ المدفوع الآن', amt, 'اكتب جزءًا من الراتب إن دفعت سلفة، والباقي يبقى ظاهرًا.'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'من أين دُفع؟'), pick.el),
      button('حفظ الدفعة', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    ), { title: `راتب ${emp.name}` });
    setTimeout(() => { amt.focus(); amt.select(); }, 150);
  }

  function employeeSheet(emp) {
    const minor = CURRENCIES[cur()].minor;
    const name = input({ maxlength: 60, placeholder: 'اسم الموظف', value: emp ? emp.name : '' });
    const salary = input({ dir: 'ltr', inputmode: 'decimal', placeholder: '0', value: emp ? formatDecimal(emp.salary, minor, { trim: true, group: false }) : '' });
    const day = input({ dir: 'ltr', inputmode: 'numeric', placeholder: '1', value: emp ? String(emp.payDay) : '1' });
    let staffId = emp ? emp.staffId || null : null;
    // موظفو التطبيق (أصحاب الرموز) الذين لم تُضف رواتبهم بعد: اختر الاسم بضغطة
    const linked = new Set(app.payroll.employees().map((e) => e.staffId).filter(Boolean));
    const members = emp ? [] : (app.shop?.settings?.staff?.members || []).filter((m) => m.active !== false && !linked.has(m.id));
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const saved = await app.payroll.saveEmployee({
            id: emp ? emp.id : null, name: name.value, salary: parseMoney(salary.value || '', cur()), payDay: Number(day.value), staffId,
          });
          feedback.ok(); close();
          toast(emp ? 'حُفظ التعديل' : `أُضيف «${saved.name}» — سنذكّرك بموعد راتبه`, { kind: 'ok' });
        } catch (err) { feedback.error(); toast(err.message || 'تعذّر الحفظ', { kind: 'error' }); }
      },
    },
      members.length ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'من موظفي التطبيق'),
        h('div', { class: 'chips' }, ...members.map((m) => h('button', { class: 'chip', type: 'button', onclick: () => { name.value = m.name; staffId = m.id; salary.focus(); } }, m.name)))) : null,
      field('الاسم', name),
      h('div', { class: 'grid-2' }, field('الراتب الشهري', salary), field('يوم الدفع في الشهر', day, '31 = آخر يوم في الشهر')),
      button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    ), { title: emp ? 'تعديل الموظف' : 'موظف جديد' });
    setTimeout(() => { if (!emp) name.focus(); }, 200);
  }

  load();
  const off = bus.on('data', (e) => { if (e.tables.includes('expenses')) load(); });
  const offShop = bus.on('shop', load);
  return () => { off(); offShop(); };
}
