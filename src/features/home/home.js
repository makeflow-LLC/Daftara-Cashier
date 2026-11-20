// الرئيسية: مبيعات اليوم وربحه، عدد الفواتير، النقد في الدرج، وأهم التنبيهات.
import { h, num, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { money, section, row, syncBadge, emptyState, helpButton } from '../../ui/components.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { todaySummary } from '../../core/queries.js';
import { navigate } from '../../core/router.js';
import { openFeedback } from '../help/feedback.js';
import { licenseBanner } from '../subscribe/subscribe.js';
import { accountBanner, maybeNudgeAccount } from '../account/account.js';
import { reminderBanner } from '../customers/remind.js';
import { userChip } from '../staff/staff.js';
import { dailyReportBanner } from '../reports/daily.js';
import { updateBanner } from '../settings/update.js';
import { daysLeftText } from '../../domain/inventory.js';
import { supplierDues, dueText } from '../../domain/dues.js';
import { localDay } from '../../domain/offers.js';
import { formatMoney } from '../../domain/currency.js';
import { formatQty } from '../../domain/units.js';
import { shouldShowInstallHint, dismissInstallHint, isIos } from '../../core/pwa.js';

export function renderHome(el) {
  assistantMemo = null; // كل فتح للرئيسية بأرقام جديدة؛ إعادة الرسم بعد كل بيع تستعمل المحفوظ
  const kpis = h('div', { class: 'kpis' });
  const alerts = h('div');
  const stats = h('div', { class: 'stats' });
  const today = new Date();
  const dateText = today.toLocaleDateString('ar-PS-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });

  const guide = h('div');
  const dailyBox = h('div', null, dailyReportBanner());
  const chatBox = h('div');
  const updateBox = updateBanner();
  const hour = today.getHours();
  const greet = hour < 12 ? 'صباح الخير' : hour < 17 ? 'نهارك سعيد' : 'مساء الخير';

  el.append(
    h('div', { class: 'home-top' },
      h('div', { class: 'home-head' },
        h('div', { class: 'topbar-title' }, h('div', { class: 'home-greet' }, `${greet} 👋`), h('h1', null, app.shop?.name || 'محلي'), h('div', { class: 'home-date' }, dateText)),
        h('div', { class: 'home-badges' }, userChip(), syncBadge(), helpButton({ dark: true }))),
      kpis),
    h('div', { class: 'page home-page' },
      updateBox,
      installBanner(),
      updateBox,
      licenseBanner(),
      chatBox,
      reminderBanner(),
      dailyBox,
      accountBanner(),
      stats,
      h('div', { class: 'quick' },
        quick('scan', 'بيع جديد', () => navigate('/sale'), 'brand'),
        app.can('purchases') ? quick('truck', 'شراء بضاعة', () => navigate('/inventory/purchase')) : null,
        app.can('purchases') ? quick('box', 'المخزون', () => navigate('/inventory')) : null,
        quick('users', 'الديون: لك وعليك', () => navigate('/customers')),
      ),
      // استلام أي مبلغ من أي مشترٍ بالمحفظة (غير مرتبط بزبون). بلا رقم محفظة: الشاشة تقود إلى الإعدادات
      h('button', { class: 'wallet-btn', type: 'button', onclick: () => navigate('/wallet') },
        icon('wallet', 26), h('span', { class: 'row-main' }, h('strong', null, 'استلام بالمحفظة (QR)'), h('span', null, 'جوال باي وبال باي: الزبون يمسح الرمز ويحوّل')), icon('chevron', 20)),
      guide,
      section('تنبيهات', alerts),
      h('button', { class: 'beta-banner', type: 'button', onclick: () => openFeedback('note') },
        icon('chat', 26), h('span', { class: 'row-main' }, h('strong', null, app.config.release ? 'رأيك يهمنا' : 'نسخة تجريبية — رأيك يهمنا'), h('span', null, 'بلّغ عن مشكلة أو اطلب ميزة بضغطة')), icon('chevron', 20)),
    ),
  );

  maybeNudgeAccount();

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
    const owed = app.can('purchases') ? await app.inventory.supplierTotals() : null;
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
      h('button', { class: 'stat stat-tap', type: 'button', onclick: () => navigate('/customers') }, h('div', { class: 'stat-label' }, icon('users', 18), 'لك عند الزبائن'), h('div', { class: 'stat-value' }, money(debts.total))),
      // ما عليك للتجار: ظاهر دائمًا في الرئيسية بجانب ما لك (كان مدفونًا في «المزيد»)
      owed ? h('button', { class: 'stat stat-tap', type: 'button', onclick: () => navigate('/suppliers') }, h('div', { class: 'stat-label' }, icon('truck', 18), 'عليك للتجار'), h('div', { class: 'stat-value' }, money(owed.total))) : null,
    );
    paintGuide();
    const a = await app.inventory.alerts({ expiry: app.feature('expiry') });
    // المساعد: ما يخلص قريبًا حسب سرعة البيع (أوضح من «منخفض»)
    const soon = app.can('purchases') ? (await assistantCached()).soon.filter((x) => x.p.qty > 0).slice(0, 3) : [];
    const soonIds = new Set(soon.map((x) => x.p.id));
    // مواعيد الدفع للموردين: متأخر أو خلال 3 أيام
    const dues = app.can('purchases') ? supplierDues(await app.inventory.suppliers(), app.shop?.settings?.supplierDues, localDay()) : [];
    // رواتب الموظفين: ما حان موعده أو تأخر (لصاحب المحل)
    const salaries = await app.payroll.due();
    const cur0 = app.shop?.base_currency || 'ILS';
    const items = [
      ...salaries.slice(0, 3).map((st) => row({ icon: 'users', title: `راتب ${st.employee.name}: ${formatMoney(st.remaining, cur0)}`, sub: `موعده ${dueText(st.days)}`, tone: st.state === 'soon' ? 'warn' : 'danger', onclick: () => navigate('/payroll') })),
      ...dues.slice(0, 3).map((d) => row({ icon: 'truck', title: `ادفع لـ ${d.supplier.name}: ${formatMoney(d.supplier.balance, app.shop?.base_currency || 'ILS')}`, sub: `موعد الدفع ${dueText(d.days)}`, tone: d.state === 'overdue' || d.state === 'today' ? 'danger' : 'warn', onclick: () => navigate(`/suppliers/view?id=${d.supplier.id}`) })),
      ...soon.map((x) => row({ icon: 'bulb', title: x.p.name, sub: `${daysLeftText(x.daysLeft)} — اطلب ${formatQty(x.qty)}`, tone: 'warn', onclick: () => navigate('/inventory/assistant') })),
      ...a.out.slice(0, 3).map((p) => row({ icon: 'alert', title: p.name, sub: 'نفد من المخزون', tone: 'danger' })),
      ...a.low.filter((p) => !soonIds.has(p.id)).slice(0, 3).map((p) => row({ icon: 'box', title: p.name, sub: 'المخزون منخفض', tone: 'warn' })),
      ...a.expiring.slice(0, 3).map((p) => row({ icon: 'alert', title: p.name, sub: `ينتهي ${p.expiry_date}`, tone: 'warn' })),
    ];
    fill(alerts, items.length
      ? h('div', null, h('div', { class: 'list' }, ...items), h('button', { class: 'btn btn-text', type: 'button', onclick: () => navigate('/inventory?tab=alerts') }, 'كل التنبيهات وطلب البضاعة'))
      : emptyState('check', 'لا تنبيهات الآن', 'ننبهك هنا حين ينخفض مخزون صنف أو يقترب انتهاؤه.'));
  }

  // تعميم جديد أو رسائل غير مقروءة: لافتة في أعلى الرئيسية
  async function paintChat() {
    const u = await app.chat.unread();
    fill(chatBox, u.latest ? h('button', { class: 'beta-banner chat-banner', type: 'button', onclick: () => navigate('/chat?tab=ann') },
      icon('megaphone', 26), h('span', { class: 'row-main' }, h('strong', null, `تعميم جديد من ${u.latest.from_name || 'صاحب المحل'}`), h('span', null, u.latest.body.replace(/\s+/g, ' ').slice(0, 70))), icon('chevron', 20))
      : u.chats ? h('button', { class: 'beta-banner chat-banner', type: 'button', onclick: () => navigate('/chat') },
        icon('chat', 26), h('span', { class: 'row-main' }, h('strong', null, u.chats === 1 ? 'رسالة جديدة في المحادثة' : `${u.chats} رسائل جديدة في المحادثة`), h('span', null, 'اضغط لقراءتها والرد')), icon('chevron', 20)) : null);
  }

  paint();
  paintChat();
  const offChat = bus.on('chat', paintChat);
  const off = bus.on('data', (e) => {
    if (e.tables.some((t) => ['invoices', 'payments', 'cash_sessions', 'movements', 'products', 'customer_entries', 'customers', 'supplier_entries', 'suppliers', 'expenses'].includes(t))) paint();
    if (e.tables.includes('messages')) paintChat();
  });
  const offShop = bus.on('shop', paint);
  const offDaily = bus.on('dailyReport', () => fill(dailyBox, dailyReportBanner()));
  return () => { off(); offChat(); offShop(); offDaily(); if (updateBox.cleanup) updateBox.cleanup(); };
}

// الرئيسية تُرسم من جديد بعد كل بيع: حساب «يخلص قريبًا» (حركات 30 يومًا) يكفي مرة في الدقيقة وهي مفتوحة
let assistantMemo = null;
function assistantCached() {
  if (!assistantMemo || Date.now() - assistantMemo.at > 60000) assistantMemo = { at: Date.now(), p: app.inventory.assistant() };
  return assistantMemo.p;
}

function quick(ic, label, onclick, tone = '') {
  return h('button', { class: `quick-btn ${tone ? `quick-${tone}` : ''}`.trim(), type: 'button', onclick }, icon(ic, 26), h('span', null, label));
}

// نسخة الويب في المتصفح: كيف تضعها على الشاشة الرئيسية فتفتح كتطبيق وتعمل بلا إنترنت
function installBanner() {
  if (!shouldShowInstallHint()) return null;
  const how = isIos()
    ? 'اضغط زر المشاركة ⬆︎ في سفاري ثم «إضافة إلى الشاشة الرئيسية».'
    : 'من قائمة المتصفح ⋮ اختر «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».';
  const el = h('div', { class: 'beta-banner install-banner' },
    icon('phone', 26),
    h('span', { class: 'row-main' }, h('strong', null, 'ضع دفترة كاشير على شاشة جوالك'), h('span', null, how)),
    h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'إخفاء', onclick: () => { dismissInstallHint(); el.remove(); } }, icon('x', 18)));
  return el;
}
