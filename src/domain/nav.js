// القائمة الجانبية للشاشة العريضة (بيانات ومنطق نقي). ترسمها features/shell/shell.js.
// القائمة الجانبية: match = بدايات المسارات التي تُبقي العنصر مضاءً. perm كما في features/index.js.
export const SIDE = [
  { path: '/', icon: 'home', label: 'الرئيسية', match: [] },
  { path: '/products', icon: 'box', label: 'الأصناف', match: ['/products', '/settings/categories', '/tools', '/offers'] },
  { path: '/customers', icon: 'users', label: 'الديون', match: ['/customers', '/suppliers'] },
  { path: '/invoices', icon: 'receipt', label: 'الفواتير', match: ['/invoices', '/sale/returns'] },
  { path: '/inventory', icon: 'truck', label: 'المخزون', match: ['/inventory'], perm: 'purchases' },
  { path: '/reports', icon: 'chart', label: 'التقارير', match: ['/reports'], perm: 'reports' },
  { path: '/cash', icon: 'cash', label: 'الصندوق', match: ['/cash'], perm: 'cash' },
  { path: '/expenses', icon: 'coins', label: 'المصاريف', match: ['/expenses', '/payroll'], perm: 'cash' },
  { path: '/more', icon: 'more', label: 'المزيد', match: ['/more', '/settings', '/account', '/subscribe', '/chat', '/wallet'] },
  { path: '/help', icon: 'help', label: 'المساعدة', match: ['/help'] },
];

/** أي عنصر في القائمة يخص هذا المسار (أطول بداية مطابقة). نقي، للاختبار. */
export function sideItemFor(path, items = SIDE) {
  if (path === '/' || !path) return items[0];
  let best = null, len = 0;
  for (const it of items) {
    for (const m of it.match) {
      if ((path === m || path.startsWith(`${m}/`) || path.startsWith(`${m}?`)) && m.length > len) { best = it; len = m.length; }
    }
  }
  return best;
}
