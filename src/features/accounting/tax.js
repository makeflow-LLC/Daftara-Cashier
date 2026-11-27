// الضريبة: إعدادها (الإعدادات ← الضريبة) وتقريرها (المحاسبة ← تقرير الضريبة).
// مطفأة حتى يشغّلها صاحب المحل المشتغل المرخّص. مع تشغيلها: كل فاتورة بيع تحمل ضريبتها (شاملة في السعر أو مضافة)،
// وفاتورة الشراء تسجّل ضريبتها المستردة، والتقرير يطرح هذه من تلك: كم عليك للدائرة عن أي مدة.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, section, switchRow, field, input, button, money, emptyState, row } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { formatMoney } from '../../domain/currency.js';
import { taxConfig, taxProblem, rateText, taxOn, DEFAULT_TAX_RATE, DEFAULT_TAX_NAME } from '../../domain/tax.js';
import { taxReport } from '../../domain/accounting.js';
import { periodLabel } from '../../domain/expenses.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { exportSections } from '../reports/reports.js';
import { voucherSheet } from './vouchers.js';
import { cur, periodPicker, canBooks } from './common.js';

const plain = (v) => formatMoney(v, cur(), { symbol: false });

export function renderTaxSettings(el) {
  const body = h('div');
  el.append(header('الضريبة', { back: true }), h('div', { class: 'page' }, body));
  const raw = () => app.shop?.settings?.tax || {};

  async function save(patch) {
    await app.updateShopSettings({ tax: { rate: DEFAULT_TAX_RATE, inclusive: true, ...raw(), ...patch } });
    paint();
  }
  function paint() {
    const t = raw();
    const on = !!taxConfig(app.shop?.settings);
    const rate = Number.isSafeInteger(t.rate) ? t.rate : DEFAULT_TAX_RATE;
    const inclusive = t.inclusive !== false;
    const rateIn = input({ dir: 'ltr', inputmode: 'decimal', value: String(rate / 100), 'aria-label': 'نسبة الضريبة' });
    rateIn.addEventListener('change', () => {
      const v = Math.round(Number(String(rateIn.value).replace(',', '.').replace('%', '')) * 100);
      const err = taxProblem({ rate: v });
      if (err) { feedback.error(); toast(err, { kind: 'error' }); rateIn.value = String(rate / 100); return; }
      save({ rate: v });
    });
    const number = input({ dir: 'ltr', inputmode: 'numeric', maxlength: 30, value: t.number || '', placeholder: 'رقم المشتغل المرخّص' });
    number.addEventListener('change', () => save({ number: number.value.trim() }));
    const name = input({ maxlength: 40, value: t.name || '', placeholder: DEFAULT_TAX_NAME });
    name.addEventListener('change', () => save({ name: name.value.trim() }));
    const chip = (v, label) => h('button', { class: `chip ${inclusive === v ? 'on' : ''}`, type: 'button', onclick: () => { feedback.tap(); save({ inclusive: v }); } }, label);
    const ex = taxOn(10000, rate, inclusive);
    fill(body,
      h('div', { class: 'list' }, switchRow({
        title: 'المحل يعمل بالضريبة', sub: 'لمن هو مشتغل مرخّص ويقدّم كشف ضريبة. مطفأ: لا ضريبة في أي فاتورة ولا شيء يتغير.',
        checked: on, onchange: (v) => save({ enabled: v }),
      })),
      !on ? h('p', { class: 'muted' }, 'معظم المحلات الصغيرة لا تحتاج هذا. شغّله فقط إن كان محاسبك أو دائرة الضريبة يطلبان كشفًا بضريبة مبيعاتك ومشترياتك.') : [
        section('النسبة', field('نسبة الضريبة %', rateIn)),
        section('أسعار البيع في المحل', h('div', { class: 'chips' }, chip(true, 'شاملة الضريبة'), chip(false, 'قبل الضريبة (تُضاف)')),
          h('p', { class: 'muted small' }, inclusive
            ? ['السعر الذي تكتبه للصنف هو ما يدفعه الزبون، والضريبة جزء منه. مثال: صنف بـ ', num(formatMoney(10000, cur())), ' فيه ضريبة ', num(formatMoney(ex.tax, cur())), '.']
            : ['الضريبة تُزاد فوق مجموع الفاتورة. مثال: فاتورة بـ ', num(formatMoney(10000, cur())), ' يدفع الزبون ', num(formatMoney(ex.gross, cur())), '.'])),
        section('على الفاتورة', field('رقم المشتغل المرخّص (يُطبع تحت اسم المحل)', number), field('اسم الضريبة على الفاتورة', name)),
        h('div', { class: 'card' },
          h('p', { class: 'muted small' }, 'عند الشراء اختر في نافذة الدفع إن كانت أسعار فاتورة التاجر شاملة الضريبة: تدخل البضاعة بتكلفتها قبل الضريبة، وضريبتها تُطرح مما عليك للدائرة.'),
          h('p', { class: 'muted small' }, 'الضريبة لا تُحسب ربحًا: تظهر في التقارير سطرًا مستقلًا. فواتيرك السابقة لا تتغير.')),
        canBooks() ? button(`تقرير الضريبة ${rateText(rate)}`, { kind: 'outline', block: true, icon: 'chart', onclick: () => navigate('/accounting/tax') }) : null,
      ]);
  }
  paint();
  return bus.on('shop', paint);
}

export function renderTaxReport(el) {
  if (!canBooks()) {
    el.append(header('تقرير الضريبة', { back: true }), h('div', { class: 'page' }, emptyState('lock', 'للمحاسب وصاحب المحل', 'يفتحه صاحب المحل ومن أعطاه «التقارير» و«يرى الأرباح».')));
    return undefined;
  }
  const body = h('div');
  let range = null;
  let rep = null;
  const picker = periodPicker((r) => { range = r; load(); }, 'month');
  range = picker.range();
  el.append(header('تقرير الضريبة', { back: true }), h('div', { class: 'page' }, picker.el, body));

  async function load() {
    const cfg = taxConfig(app.shop?.settings);
    const b = await app.accounting.books();
    rep = taxReport(b.entries, range);
    if (!cfg && !rep.balance && !rep.output && !rep.input) {
      fill(body, emptyState('chart', 'المحل لا يعمل بالضريبة', 'شغّلها من الإعدادات ← الضريبة إن كنت مشتغلًا مرخّصًا.', button('إعداد الضريبة', { icon: 'sliders', onclick: () => navigate('/settings/tax') })));
      return;
    }
    const kv = (ic, title, v, tone = '') => row({ icon: ic, title, end: h('span', { class: tone }, money(v)) });
    fill(body,
      h('div', { class: `balance-card ${rep.net > 0 ? 'owed' : 'clear'}` },
        h('div', { class: 'hero-label' }, rep.net >= 0 ? 'عليك للدائرة عن هذه المدة' : 'لك عند الدائرة عن هذه المدة'),
        h('div', { class: 'hero-value' }, money(Math.abs(rep.net))),
        h('div', { class: 'hero-mini-label' }, range.label, cfg ? ` · ${cfg.name} ${rateText(cfg.rate)}` : '')),
      h('div', { class: 'product-actions' },
        button('PDF', { kind: 'outline', icon: 'receipt', onclick: () => doExport('pdf') }),
        button('Excel', { kind: 'outline', icon: 'clipboard', onclick: () => doExport('xlsx') })),
      h('div', { class: 'list' },
        kv('receipt', 'ضريبة المبيعات (بعد المرتجعات)', rep.output),
        kv('truck', 'ضريبة المشتريات (تُسترد)', rep.input),
        kv('scale', 'الصافي عن المدة', rep.net, rep.net > 0 ? 'owed' : ''),
        rep.paid ? kv('check', 'دُفع للدائرة في المدة', rep.paid) : null),
      h('div', { class: 'card acc-totals' }, h('div', { class: 'rc-kv' }, h('span', null, rep.balance >= 0 ? 'الباقي عليك للدائرة الآن (كل المدة)' : 'لك عند الدائرة الآن (كل المدة)'), money(Math.abs(rep.balance)))),
      rep.balance > 0 && app.can('cash') ? button('سجّل دفع الضريبة (سند صرف)', { block: true, icon: 'minus', onclick: () => voucherSheet('payment', { preset: { party: 'vat' }, onSaved: load }) }) : null,
      rep.months.length > 1 ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'شهرًا بشهر'),
        h('div', { class: 'list' }, ...rep.months.map((m) => h('div', { class: 'row' },
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, periodLabel(m.month)), h('span', { class: 'row-sub' }, 'مبيعات ', num(plain(m.output)), ' · مشتريات ', num(plain(m.input)))),
          h('span', { class: `row-end strong ${m.net > 0 ? 'owed' : ''}` }, money(m.net)))))) : null,
      h('p', { class: 'muted small' }, icon('info', 16), ' الأرقام من فواتير البيع والشراء نفسها. اضغط «الضريبة» في دليل الحسابات لترى كل حركة.'));
  }
  function doExport(type) {
    exportSections({ type, title: 'تقرير الضريبة', sub: `${app.shop.name} — ${range.label}`, name: 'tax', sections: [
      { title: 'الملخص', head: ['البند', 'المبلغ'], rows: [['ضريبة المبيعات', plain(rep.output)], ['ضريبة المشتريات', plain(rep.input)], ['الصافي عن المدة', plain(rep.net)], ['دُفع للدائرة في المدة', plain(rep.paid)], ['الباقي الآن', plain(rep.balance)]] },
      ...(rep.months.length ? [{ title: 'شهرًا بشهر', head: ['الشهر', 'المبيعات', 'المشتريات', 'الصافي'], rows: rep.months.map((m) => [periodLabel(m.month), plain(m.output), plain(m.input), plain(m.net)]) }] : []),
    ] });
  }
  load();
  const off = bus.on('data', load);
  const offShop = bus.on('shop', load);
  return () => { off(); offShop(); };
}
