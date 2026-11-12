// الرئيسية: مبيعات اليوم وربحه، عدد الفواتير، النقد في الدرج، وأهم التنبيهات.
import { h, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, money, stat, section, row, syncBadge, emptyState } from '../../ui/components.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { todaySummary, stockAlerts } from '../../core/queries.js';
import { navigate } from '../../core/router.js';
import { logo } from '../setup/setup.js';

export function renderHome(el) {
  const kpis = h('div', { class: 'kpis' });
  const alerts = h('div');
  const today = new Date();
  const dateText = today.toLocaleDateString('ar-PS-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });

  el.append(
    header(app.shop?.name || 'محلي', { sub: dateText, actions: [syncBadge()] }),
    h('div', { class: 'page' },
      kpis,
      h('div', { class: 'quick' },
        quick('scan', 'بيع جديد', () => navigate('/sale'), 'brand'),
        quick('box', 'الأصناف', () => navigate('/products')),
        quick('users', 'الزبائن والديون', () => navigate('/customers')),
        quick('sliders', 'الإعدادات', () => navigate('/settings')),
      ),
      section('تنبيهات', alerts),
    ),
  );

  async function paint() {
    const s = await todaySummary(app.db);
    const showProfit = app.can('see_profit');
    kpis.replaceChildren(
      h('div', { class: 'hero-card' },
        logo(40),
        h('div', { class: 'hero-label' }, 'مبيعات اليوم'),
        h('div', { class: 'hero-value' }, money(s.salesTotal)),
        h('div', { class: 'hero-row' },
          showProfit ? h('div', null, h('span', { class: 'hero-mini-label' }, 'الربح'), money(s.profit, undefined, s.profit < 0 ? 'neg' : '')) : null,
          h('div', null, h('span', { class: 'hero-mini-label' }, 'الفواتير'), num(String(s.invoiceCount))),
        ),
      ),
      h('div', { class: 'stats' },
        stat('النقد في الدرج', money(s.drawer), { ic: 'cash' }),
        stat('الوردية', h('span', { class: 'stat-text' }, s.sessionOpen ? 'مفتوحة' : 'لم تُفتح بعد'), { ic: 'receipt' }),
      ),
    );
    const a = await stockAlerts(app.db, { expiry: app.feature('expiry') });
    const items = [
      ...a.out.slice(0, 3).map((p) => row({ icon: 'alert', title: p.name, sub: 'نفد من المخزون', tone: 'danger' })),
      ...a.low.slice(0, 3).map((p) => row({ icon: 'box', title: p.name, sub: 'المخزون منخفض', tone: 'warn' })),
      ...a.expiring.slice(0, 3).map((p) => row({ icon: 'alert', title: p.name, sub: `ينتهي ${p.expiry_date}`, tone: 'warn' })),
    ];
    alerts.replaceChildren(items.length
      ? h('div', { class: 'list' }, ...items)
      : emptyState('check', 'لا تنبيهات الآن', 'ننبهك هنا حين ينخفض مخزون صنف أو يقترب انتهاؤه.'));
  }

  paint();
  const off = bus.on('data', (e) => {
    if (e.tables.some((t) => ['invoices', 'payments', 'cash_sessions', 'movements', 'products'].includes(t))) paint();
  });
  const offShop = bus.on('shop', paint);
  return () => { off(); offShop(); };
}

function quick(ic, label, onclick, tone = '') {
  return h('button', { class: `quick-btn ${tone ? `quick-${tone}` : ''}`.trim(), type: 'button', onclick }, icon(ic, 26), h('span', null, label));
}
