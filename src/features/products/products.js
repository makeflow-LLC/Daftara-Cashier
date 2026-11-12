// الأصناف — تُبنى في المرحلة 1 (الإضافة السريعة بالمسح، الصور، الوحدات والعبوات).
import { h } from '../../ui/dom.js';
import { header, emptyState, syncBadge } from '../../ui/components.js';

export function renderProducts(el) {
  el.append(
    header('الأصناف', { actions: [syncBadge()] }),
    h('div', { class: 'page' }, emptyState('box', 'لا أصناف بعد', 'إضافة الأصناف بالمسح المتواصل والصور والوحدات تأتي في المرحلة 1.')),
  );
}
