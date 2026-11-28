// المحاسبة: صفحة واحدة تجيب «أين مالي؟» — النقد في الصناديق، ما لك عند الناس، البضاعة، وما عليك.
// لصاحب المحل البسيط: ثلاثة أزرار (قبض، صرف، تحويل) والشيكات والصناديق. وللمحاسب: «أدوات المحاسب» تفتح الدفاتر.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, money, row, switchRow } from '../../ui/components.js';
import { chequesSummary } from '../../domain/cheques.js';
import { localDay } from '../../domain/offers.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { voucherSheet, transferSheet } from './vouchers.js';
import { canBooks } from './common.js';

const ADVANCED_KEY = 'acc:advanced';

export function renderAccounting(el) {
  const top = h('div');
  const tools = h('div');
  const pro = h('div');
  const go = (p) => () => navigate(p);
  const tile = (ic, label, tone, onclick, badge = null) => h('button', { class: `hub-tile hub-${tone}`, type: 'button', onclick },
    h('span', { class: 'hub-ic' }, icon(ic, 28)), h('span', { class: 'hub-label' }, label), badge ? h('span', { class: 'badge' }, String(badge)) : null);
  const canWrite = app.can('cash');
  const books = canBooks();

  el.append(header('المحاسبة', { back: true }), h('div', { class: 'page split' }, h('div', null, top), h('div', null, tools, pro)));

  async function load() {
    const [p, due] = await Promise.all([app.accounting.position(), app.accounting.chequesDue(localDay())]);
    const dueSum = chequesSummary(due);
    const line = (ic, title, value, onclick, tone = '') => row({ icon: ic, title, end: h('span', { class: tone }, money(value)), onclick, tone: '' });
    fill(top,
      // صافي ما يملكه المحل يكشف الربح والتكلفة: لمن يراهما فقط
      books ? h('div', { class: `balance-card ${p.net < 0 ? 'owed' : 'clear'}` },
        h('div', { class: 'hero-label' }, 'صافي ما يملكه المحل الآن'),
        h('div', { class: 'hero-value' }, money(p.net)),
        h('div', { class: 'hero-mini-label' }, 'النقد والبضاعة وما لك عند الناس، ناقص ما عليك')) : null,
      dueSum ? h('button', { class: `notice-row ${dueSum.overdue ? 'danger' : 'warn'}`, type: 'button', onclick: go('/accounting/cheques') },
        icon('cheque', 22), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, dueSum.title), h('span', { class: 'row-sub' }, 'اضغط لفتح الشيكات')), money(dueSum.total)) : null,
      h('h2', { class: 'section-title' }, 'أين مال المحل؟'),
      h('div', { class: 'list' },
        line('cash', 'النقد في الصناديق والبنوك', p.cash, go('/accounting/boxes')),
        app.can('see_debts') ? line('users', 'لك عند الزبائن', p.receivables, go('/customers')) : null, // مجموع الديون لمن يراه فقط
        p.chequesIn ? line('cheque', 'شيكات لك لم تُصرف', p.chequesIn, go('/accounting/cheques')) : null,
        books ? line('box', 'البضاعة بسعر التكلفة', p.inventory, app.can('purchases') ? go('/inventory') : null) : null,
        app.can('purchases') ? line('truck', 'عليك للتجار', p.payables, go('/suppliers'), p.payables > 0 ? 'owed' : '') : null,
        p.chequesOut ? line('cheque', 'شيكات عليك لم تُصرف', p.chequesOut, go('/accounting/cheques?dir=out'), 'owed') : null,
        p.tax ? line('receipt', p.tax > 0 ? 'ضريبة عليك للدائرة' : 'ضريبة لك عند الدائرة', Math.abs(p.tax), books ? go('/accounting/tax') : null, p.tax > 0 ? 'owed' : '') : null),
    );
    fill(tools,
      h('h2', { class: 'section-title' }, 'ماذا تريد أن تسجّل؟'),
      h('div', { class: 'hub' },
        canWrite ? tile('plus', 'سند قبض (مال دخل)', 'green', () => voucherSheet('receipt', { onSaved: load })) : null,
        canWrite ? tile('minus', 'سند صرف (مال خرج)', 'pink', () => voucherSheet('payment', { onSaved: load })) : null,
        canWrite ? tile('swap', 'تحويل بين الصناديق', 'blue', () => transferSheet({ onSaved: load })) : null,
        tile('cheque', 'الشيكات', 'amber', go('/accounting/cheques'), due.length || null),
        tile('safe', 'الصناديق', 'teal', go('/accounting/boxes')),
        tile('receipt', 'كل السندات', 'violet', go('/accounting/vouchers'))),
    );
  }

  async function paintPro() {
    if (!books) { fill(pro); return; }
    const on = !!(await app.meta.get(ADVANCED_KEY, false));
    fill(pro,
      h('div', { class: 'list' }, switchRow({
        title: 'أدوات المحاسب', sub: 'ميزان المراجعة، دفتر الأستاذ، قيود اليومية، الميزانية، مراكز التكلفة، الضريبة — الدفاتر تُكتب وحدها من عملك اليومي',
        checked: on, onchange: async (v) => { await app.meta.set(ADVANCED_KEY, v); paintPro(); },
      })),
      on ? h('div', { class: 'hub hub-pro' },
        tile('scale', 'ميزان المراجعة', 'green', go('/accounting/trial')),
        tile('book', 'دفتر الأستاذ ودليل الحسابات', 'blue', go('/accounting/ledger')),
        tile('clipboard', 'قيود اليومية', 'violet', go('/accounting/journal')),
        tile('chart', 'قائمة الدخل والميزانية', 'amber', go('/accounting/statements')),
        tile('tag', 'مراكز التكلفة', 'teal', go('/accounting/centers')),
        // تقرير الضريبة لمن يعمل بها فقط (الإعدادات ← الضريبة)
        app.shop?.settings?.tax?.enabled ? tile('receipt', 'تقرير الضريبة', 'pink', go('/accounting/tax')) : null) : null,
    );
  }

  load();
  paintPro();
  const off = bus.on('data', load);
  const offShop = bus.on('shop', load);
  return () => { off(); offShop(); };
}
