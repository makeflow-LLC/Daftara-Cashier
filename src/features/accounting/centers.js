// مراكز التكلفة: «أي قسم يربح وأيها يخسر؟». المركز قسم أو فرع أو سيارة توزيع؛ تربط به تصنيفات أصنافه (فتُحسب مبيعاته
// وتكلفتها له)، وتختاره عند تسجيل مصروف أو سند. الصفحة تعرض لكل مركز: مبيعاته، تكلفتها، مصاريفه، وصافيه لأي مدة.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, field, money, emptyState, dataTable } from '../../ui/components.js';
import { isWide } from '../../ui/wide.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { formatMoney } from '../../domain/currency.js';
import { NO_CENTER } from '../../domain/centers.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { exportSections } from '../reports/reports.js';
import { cur, periodPicker, canBooks } from './common.js';

const plain = (v) => formatMoney(v, cur(), { symbol: false });

/**
 * شرائح اختيار مركز التكلفة لمصروف أو سند. لا تظهر (el = null) إن لم يُنشئ صاحب المحل مراكز.
 * يرجع { el, get() → معرّف المركز أو null }.
 */
export function centerPicker(selected = null) {
  const centers = app.accounting.centers().filter((c) => c.active || c.id === selected);
  if (!centers.length) return { el: null, get: () => null };
  let cur0 = selected && centers.some((c) => c.id === selected) ? selected : null;
  const chips = h('div', { class: 'chips' });
  const paint = () => fill(chips,
    h('button', { class: `chip ${cur0 ? '' : 'on'}`, type: 'button', onclick: () => { cur0 = null; paint(); } }, 'بلا مركز'),
    ...centers.map((c) => h('button', { class: `chip ${cur0 === c.id ? 'on' : ''}`, type: 'button', onclick: () => { cur0 = c.id; paint(); } }, c.name)));
  paint();
  return { el: h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'مركز التكلفة'), chips), get: () => cur0 };
}

/** ورقة مركز جديد أو تعديله: اسمه والتصنيفات التي تُحسب مبيعاتها له. */
export async function centerSheet(center = null, onSaved = null) {
  const name = input({ maxlength: 40, placeholder: 'مثال: قسم الخضار، فرع الرمال، سيارة التوزيع', value: center ? center.name : '' });
  const cats = (await app.db.categories.toArray()).filter((c) => !c.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const others = new Map();
  for (const c of app.accounting.centers()) if (!center || c.id !== center.id) for (const x of c.categories) others.set(x, c.name);
  const picked = new Set(center ? center.categories : []);
  const chips = h('div', { class: 'chips' });
  const paint = () => fill(chips, ...cats.map((c) => h('button', {
    class: `chip ${picked.has(c.id) ? 'on' : ''}`, type: 'button', title: others.has(c.id) ? `الآن في «${others.get(c.id)}»` : null,
    onclick: () => { if (picked.has(c.id)) picked.delete(c.id); else picked.add(c.id); paint(); },
  }, c.name, others.has(c.id) && !picked.has(c.id) ? h('span', { class: 'muted small' }, ` (${others.get(c.id)})`) : null)));
  paint();
  let busy = false;
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      try {
        const saved = await app.accounting.saveCenter({ id: center ? center.id : null, name: name.value, categories: [...picked] });
        feedback.ok(); close();
        toast(center ? 'عُدّل المركز' : `أُضيف مركز «${saved.name}»`, { kind: 'ok' });
        if (onSaved) onSaved(saved);
      } catch (err) { busy = false; feedback.error(); toast(err.errors?.name || 'تعذّر الحفظ', { kind: 'error' }); name.focus(); }
    },
  },
    field('اسم المركز', name),
    cats.length ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'تصنيفات أصنافه (مبيعاتها تُحسب له)'), chips,
      h('span', { class: 'field-hint' }, 'اختياري. التصنيف لمركز واحد: اختياره هنا ينقله من مركزه السابق. مركز بلا تصنيفات (سيارة، إدارة) له مصاريف فقط.')) : null,
    button(center ? 'حفظ' : 'أضف المركز', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    center && app.can('delete') ? h('button', { class: 'btn btn-text btn-block btn-danger-text', type: 'button', onclick: async () => {
      await app.accounting.closeCenter(center.id);
      feedback.ok(); close();
      toast(`أُغلق «${center.name}» — حركاته السابقة تبقى في تقريره`, { undo: async () => { await app.accounting.closeCenter(center.id, true); if (onSaved) onSaved(); } });
      if (onSaved) onSaved();
    } }, icon('trash', 20), h('span', null, 'أغلق هذا المركز')) : null,
  ), { title: center ? 'تعديل المركز' : 'مركز تكلفة جديد' });
  if (!center) setTimeout(() => name.focus(), 150);
}

export function renderCenters(el) {
  if (!canBooks()) {
    el.append(header('مراكز التكلفة', { back: true }), h('div', { class: 'page' }, emptyState('lock', 'للمحاسب وصاحب المحل', 'يفتحه صاحب المحل ومن أعطاه «التقارير» و«يرى الأرباح».')));
    return undefined;
  }
  const body = h('div');
  let rep = null;
  const picker = periodPicker((r) => { range = r; load(); }, 'month');
  let range = picker.range();
  el.append(header('مراكز التكلفة', { back: true }), h('div', { class: 'page' }, picker.el, body));

  async function load() {
    const centers = app.accounting.centers();
    const add = button('مركز جديد', { kind: 'outline', block: true, icon: 'plus', onclick: () => centerSheet(null, load) });
    if (!centers.length) {
      fill(body, emptyState('chart', 'أي قسم يربح وأيها يخسر؟', 'أنشئ مركزًا لكل قسم أو فرع أو سيارة توزيع. اربط به تصنيفات أصنافه، واختره عند تسجيل مصاريفه، فترى ربحه وحده.', add));
      return;
    }
    rep = await app.accounting.centerReport(range);
    const byId = new Map(centers.map((c) => [c.id, c]));
    const edit = (r) => { if (r.id !== NO_CENTER && byId.has(r.id)) centerSheet(byId.get(r.id), load); };
    const best = rep.rows.filter((r) => r.id !== NO_CENTER).sort((a, b) => b.net - a.net)[0];
    fill(body,
      h('div', { class: `balance-card ${rep.total.net < 0 ? 'owed' : 'clear'}` },
        h('div', { class: 'hero-label' }, rep.total.net < 0 ? 'صافي الخسارة — كل المراكز' : 'صافي الربح — كل المراكز'),
        h('div', { class: 'hero-value' }, money(Math.abs(rep.total.net))),
        h('div', { class: 'hero-mini-label' }, range.label, best && best.net > 0 ? ` · الأربح: ${best.name}` : '')),
      h('div', { class: 'product-actions' },
        button('PDF', { kind: 'outline', icon: 'receipt', onclick: () => doExport('pdf') }),
        button('Excel', { kind: 'outline', icon: 'clipboard', onclick: () => doExport('xlsx') })),
      isWide() ? dataTable({
        rows: rep.rows, onRow: edit, pageSize: 200,
        columns: [
          { key: 'name', label: 'المركز', grow: true, by: (r) => r.name, cell: (r) => (r.id === NO_CENTER ? h('span', { class: 'muted' }, r.name) : r.name) },
          { key: 'sales', label: 'المبيعات', num: true, by: (r) => r.sales, cell: (r) => num(plain(r.sales)) },
          { key: 'cost', label: 'تكلفة البضاعة', num: true, by: (r) => r.cost, cell: (r) => num(plain(r.cost)) },
          { key: 'other', label: 'إيرادات أخرى', num: true, by: (r) => r.other, cell: (r) => (r.other ? num(plain(r.other)) : '') },
          { key: 'exp', label: 'المصاريف', num: true, by: (r) => r.expenses, cell: (r) => num(plain(r.expenses)) },
          { key: 'net', label: 'الصافي', num: true, by: (r) => r.net, cell: (r) => h('strong', { class: r.net < 0 ? 'owed' : '' }, num(plain(r.net))) },
        ],
      }) : h('div', { class: 'list' }, ...rep.rows.map((r) => h(r.id === NO_CENTER ? 'div' : 'button', { class: `row ${r.id === NO_CENTER ? '' : 'row-tap'}`, type: r.id === NO_CENTER ? null : 'button', onclick: () => edit(r) },
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, r.name),
          h('span', { class: 'row-sub' }, 'مبيعات ', num(plain(r.sales)), ' · تكلفة ', num(plain(r.cost)), ' · مصاريف ', num(plain(r.expenses)))),
        h('span', { class: `row-end strong ${r.net < 0 ? 'owed' : ''}` }, money(r.net))))),
      add,
      h('p', { class: 'muted small' }, 'مبيعات المركز من تصنيفات أصنافه بعد الخصم والضريبة، وتكلفته بضاعته المباعة والتالفة، ومصاريفه ما اخترته له عند تسجيلها. «بلا مركز»: كل ما لم يُنسب لمركز. اضغط المركز لتعديله.'));
  }
  function doExport(type) {
    const rows = rep.rows.map((r) => [r.name, plain(r.sales), plain(r.cost), plain(r.other), plain(r.expenses), plain(r.net)]);
    rows.push(['المجموع', plain(rep.total.sales), plain(rep.total.cost), plain(rep.total.other), plain(rep.total.expenses), plain(rep.total.net)]);
    exportSections({ type, title: 'مراكز التكلفة', sub: `${app.shop.name} — ${range.label}`, name: 'cost-centers', sections: [{ title: 'ربح كل مركز', head: ['المركز', 'المبيعات', 'التكلفة', 'إيرادات أخرى', 'المصاريف', 'الصافي'], rows }] });
  }
  load();
  const off = bus.on('data', load);
  const offShop = bus.on('shop', load);
  return () => { off(); offShop(); };
}
