// الرئيسية: مبيعات اليوم وربحه، عدد الفواتير، النقد في الدرج، وأهم التنبيهات.
import { h, num, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { money, section, row, syncBadge, emptyState } from '../../ui/components.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { todaySummary } from '../../core/queries.js';
import { navigate } from '../../core/router.js';
import { openFeedback } from '../help/feedback.js';
import { licenseBanner } from '../subscribe/subscribe.js';

export function renderHome(el) {
  const kpis = h('div', { class: 'kpis' });
  const alerts = h('div');
  const stats = h('div', { class: 'stats' });
  const today = new Date();
  const dateText = today.toLocaleDateString('ar-PS-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });

  const guide = h('div');
  const hour = today.getHours();
  const greet = hour < 12 ? 'صباح الخير' : hour < 17 ? 'نهارك سعيد' : 'مساء الخير';

  el.append(
    h('div', { class: 'home-top' },
      h('div', { class: 'home-head' },
        h('div', { class: 'topbar-title' }, h('div', { class: 'home-greet' }, `${greet} 👋`), h('h1', null, app.shop?.name || 'محلي'), h('div', { class: 'home-date' }, dateText)),
        syncBadge()),
      kpis),
    h('div', { class: 'page home-page' },
      licenseBanner(),
      stats,
      h('div', { class: 'quick' },
        quick('scan', 'بيع جديد', () => navigate('/sale'), 'brand'),
        quick('truck', 'شراء بضاعة', () => navigate('/inventory/purchase')),
        quick('box', 'المخزون', () => navigate('/inventory')),
        quick('users', 'الزبائن والديون', () => navigate('/customers')),
      ),
      guide,
      section('تنبيهات', alerts),
      h('button', { class: 'beta-banner', type: 'button', onclick: () => openFeedback('note') },
        icon('chat', 26), h('span', { class: 'row-main' }, h('strong', null, app.config.release ? 'رأيك يهمنا' : 'نسخة تجريبية — رأيك يهمنا'), h('span', null, 'بلّغ عن مشكلة أو اطلب ميزة بضغطة')), icon('chevron', 20)),
    ),
  );

  // «ابدأ من هنا»: ثلاث خطوات للمحل الجديد، تختفي حين تكتمل أو يخفيها صاحب المحل
  async function paintGuide() {
    if (await app.meta.get('guideDismissed')) { fill(guide); return; }
    const [products, sales, customers] = await Promise.all([app.db.products.count(), app.db.invoices.where('type').equals('sale').count(), app.db.customers.count()]);
    const steps = [
      { done: products > 0, title: 'أضف أصنافك', sub: 'امسح الباركود واكتب الاسم والسعر', go: '/products/rapid' },
      { done: sales > 0, title: 'بِع أول فاتورة', sub: 'من الزر الأخضر «بيع»', go: '/sale' },
      { done: customers > 0, title: 'أضف زبائنك', sub: 'أو انقلهم من تطبيق دفترة', go: '/customers' },
    ];
    const doneCount = steps.filter((x) => x.done).length;
    if (doneCount === steps.length) { fill(guide); return; }
    const next = steps.findIndex((x) => !x.done);
    fill(guide, h('div', { class: 'guide' },
      h('div', { class: 'guide-head' }, icon('rocket', 24), h('strong', null, 'ابدأ من هنا'), h('span', { class: 'guide-count num' }, `${doneCount}/3`),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'إخفاء', onclick: async () => { await app.meta.set('guideDismissed', true); fill(guide); } }, icon('x', 18))),
      h('div', { class: 'guide-bar' }, h('span', { style: { width: `${Math.round((doneCount / 3) * 100)}%` } })),
      ...steps.map((st, i) => h('button', { class: `guide-step ${st.done ? 'done' : ''} ${i === next ? 'next' : ''}`, type: 'button', onclick: () => navigate(st.go) },
        h('span', { class: 'guide-dot' }, st.done ? icon('check', 18) : h('span', { class: 'num' }, String(i + 1))),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, st.title), h('span', { class: 'row-sub' }, st.sub)),
        st.done ? null : icon('chevron', 20)))));
  }

  async function paint() {
    const s = await todaySummary(app.db);
    const debts = await app.customers.totals();
    const drawer = await app.cash.summary();
    const showProfit = app.can('see_profit');
    fill(kpis,
      h('button', { class: 'hero-main', type: 'button', onclick: () => navigate('/reports') },
        h('span', { class: 'hero-label' }, 'مبيعات اليوم'), h('span', { class: 'hero-value' }, money(s.salesTotal))),
      h('div', { class: 'hero-row' },
        showProfit ? h('button', { class: 'hero-pill', type: 'button', onclick: () => navigate('/reports') }, h('span', { class: 'hero-mini-label' }, 'الربح'), money(s.profit, undefined, s.profit < 0 ? 'neg' : '')) : null,
        h('button', { class: 'hero-pill', type: 'button', onclick: () => navigate('/invoices?range=today') }, h('span', { class: 'hero-mini-label' }, 'الفواتير'), num(String(s.invoiceCount))),
        h('button', { class: 'hero-pill', type: 'button', onclick: () => navigate('/reports') }, h('span', { class: 'hero-mini-label' }, 'التقارير'), icon('chart', 22))),
    );
    fill(stats,
      h('button', { class: 'stat stat-tap', type: 'button', onclick: () => navigate('/cash') }, h('div', { class: 'stat-label' }, icon('cash', 18), 'النقد في الدرج'), h('div', { class: 'stat-value' }, money(drawer.expectedCash))),
      h('button', { class: 'stat stat-tap', type: 'button', onclick: () => navigate('/customers') }, h('div', { class: 'stat-label' }, icon('users', 18), 'ديون الزبائن'), h('div', { class: 'stat-value' }, money(debts.total))),
    );
    paintGuide();
    const a = await app.inventory.alerts({ expiry: app.feature('expiry') });
    const items = [
      ...a.out.slice(0, 3).map((p) => row({ icon: 'alert', title: p.name, sub: 'نفد من المخزون', tone: 'danger' })),
      ...a.low.slice(0, 3).map((p) => row({ icon: 'box', title: p.name, sub: 'المخزون منخفض', tone: 'warn' })),
      ...a.expiring.slice(0, 3).map((p) => row({ icon: 'alert', title: p.name, sub: `ينتهي ${p.expiry_date}`, tone: 'warn' })),
    ];
    fill(alerts, items.length
      ? h('div', null, h('div', { class: 'list' }, ...items), h('button', { class: 'btn btn-text', type: 'button', onclick: () => navigate('/inventory') }, 'كل التنبيهات وطلب البضاعة'))
      : emptyState('check', 'لا تنبيهات الآن', 'ننبهك هنا حين ينخفض مخزون صنف أو يقترب انتهاؤه.'));
  }

  paint();
  const off = bus.on('data', (e) => {
    if (e.tables.some((t) => ['invoices', 'payments', 'cash_sessions', 'movements', 'products', 'customer_entries', 'customers'].includes(t))) paint();
  });
  const offShop = bus.on('shop', paint);
  return () => { off(); offShop(); };
}

function quick(ic, label, onclick, tone = '') {
  return h('button', { class: `quick-btn ${tone ? `quick-${tone}` : ''}`.trim(), type: 'button', onclick }, icon(ic, 26), h('span', null, label));
}
