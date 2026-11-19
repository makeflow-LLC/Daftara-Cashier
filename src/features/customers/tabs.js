// مفتاح «الديون» أعلى القائمتين: لك عند الزبائن / عليك للتجار. كل جهة بمجموعها، فيرى صاحب المحل
// الصورة كلها من نظرة، وينتقل بضغطة. (قسم التجار كان مدفونًا في «المزيد» فلا يجده أحد.)
import { h, fill } from '../../ui/dom.js';
import { money } from '../../ui/components.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';

export function debtTabs(active) {
  // موظف بلا صلاحية الشراء لا يرى ما على المحل للتجار: القائمة تبقى زبائن فقط بلا مفتاح
  if (!app.can('purchases')) return { el: null, refresh: async () => {} };
  const amounts = { customers: h('span', { class: 'debt-tab-amt' }), suppliers: h('span', { class: 'debt-tab-amt' }) };
  const tab = (id, title, sub, path) => h('button', {
    class: `debt-tab debt-tab-${id} ${active === id ? 'on' : ''}`, type: 'button', 'aria-pressed': active === id ? 'true' : 'false',
    onclick: () => { if (active !== id) navigate(path, { replace: true }); },
  }, h('span', { class: 'debt-tab-title' }, title), h('span', { class: 'debt-tab-sub' }, sub), amounts[id]);
  const el = h('div', { class: 'debt-tabs', role: 'group', 'aria-label': 'الديون' },
    tab('customers', 'الزبائن', 'لك عندهم', '/customers'),
    tab('suppliers', 'التجار', 'عليك لهم', '/suppliers'));
  async function refresh() {
    const [c, s] = await Promise.all([app.customers.totals(), app.inventory.supplierTotals()]);
    fill(amounts.customers, money(c.total));
    fill(amounts.suppliers, money(s.total));
  }
  refresh();
  return { el, refresh };
}
