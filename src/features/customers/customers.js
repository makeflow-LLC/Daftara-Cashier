// الزبائن والديون — تُبنى في المرحلة 3 (كشف الحساب، الدفعات، تذكير واتساب، الاستيراد من دفترة).
import { h } from '../../ui/dom.js';
import { header, emptyState, syncBadge } from '../../ui/components.js';

export function renderCustomers(el) {
  el.append(
    header('الزبائن', { actions: [syncBadge()] }),
    h('div', { class: 'page' }, emptyState('users', 'لا زبائن بعد', 'الديون وكشوف الحساب والاستيراد من دفترة تأتي في المرحلة 3.')),
  );
}
