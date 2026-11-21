// مكوّنات نظام التصميم المشتركة. كل شاشة تُبنى منها، فيبقى الشكل واحدًا في كل الوحدات.
import { h, num, fill } from './dom.js';
import { icon } from './icons.js';
import { bus } from '../core/bus.js';
import { app } from '../core/app.js';
import { formatMoney } from '../domain/currency.js';

// زر «شرح» في رأس كل صفحة: تسجّله وحدة المساعدة عند الإقلاع (features/help/sheet.js)، فلا تعرف المكوّنات عنها شيئًا.
let helpFactory = null;
export function setHelpButton(fn) {
  helpFactory = fn;
}
/** زر «شرح» للصفحة المفتوحة، أو null إن لم يكن لها شرح. opts: { compact, dark, topic }. */
export function helpButton(opts) {
  return helpFactory ? helpFactory(opts || {}) : null;
}

/** رأس الشاشة: عنوان، زر رجوع اختياري، وأزرار على اليسار. آخرها زر «شرح» لهذه الصفحة (help: false يخفيه). */
export function header(title, { back = false, actions = [], sub = null, help = true } = {}) {
  const shown = actions.filter(Boolean);
  // مع زرين أو أكثر في الرأس يصغر «شرح» إلى علامة الاستفهام وحدها حتى لا يُقصّ العنوان
  const helpBtn = help ? helpButton({ compact: shown.length >= 2 }) : null;
  return h('header', { class: 'topbar' },
    back ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'رجوع', onclick: () => history.back() }, icon('back')) : null,
    h('div', { class: 'topbar-title' }, h('h1', null, title), sub ? h('div', { class: 'topbar-sub' }, sub) : null),
    h('div', { class: 'topbar-actions' }, ...shown, helpBtn),
  );
}

export function iconButton(name, label, onclick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

export function button(label, { kind = 'primary', icon: ic = null, onclick, type = 'button', block = false, size = '' } = {}) {
  return h('button', { class: `btn btn-${kind} ${block ? 'btn-block' : ''} ${size ? `btn-${size}` : ''}`.trim(), type, onclick },
    ic ? icon(ic, 22) : null, h('span', null, label));
}

export function money(minor, code = app.shop?.base_currency || 'ILS', cls = '') {
  return num(formatMoney(minor, code), cls);
}

export function emptyState(ic, title, text = '', action = null) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-ic' }, icon(ic, 34)),
    h('div', { class: 'empty-title' }, title),
    text ? h('p', { class: 'empty-text' }, text) : null,
    action,
  );
}

export function section(title, ...children) {
  return h('section', { class: 'section' }, title ? h('h2', { class: 'section-title' }, title) : null, ...children);
}

export function card(...children) {
  return h('div', { class: 'card' }, ...children);
}

/** صف قائمة قابل للضغط: أيقونة، عنوان ووصف، وقيمة أو سهم. */
export function row({ icon: ic = null, title, sub = null, end = null, onclick = null, tone = '' }) {
  const tag = onclick ? 'button' : 'div';
  return h(tag, { class: `row ${tone ? `row-${tone}` : ''} ${onclick ? 'row-tap' : ''}`.trim(), type: onclick ? 'button' : null, onclick },
    ic ? h('span', { class: 'row-ic' }, icon(ic, 22)) : null,
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'row-sub' }, sub) : null),
    end !== null ? h('span', { class: 'row-end' }, end) : (onclick ? icon('chevron', 20, 'row-go') : null),
  );
}

/** مفتاح تشغيل/إيقاف بصف كامل قابل للمس. */
export function switchRow({ title, sub = null, checked, onchange }) {
  const input = h('input', { type: 'checkbox', class: 'switch-input', checked: !!checked, onchange: (e) => onchange(e.target.checked) });
  return h('label', { class: 'row row-tap switch-row' },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'row-sub' }, sub) : null),
    input, h('span', { class: 'switch', 'aria-hidden': 'true' }),
  );
}

/** حقل إدخال بعنوان. */
export function field(label, input, hint = null) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function input(props = {}) {
  return h('input', { class: 'input', autocomplete: 'off', ...props });
}

/** بطاقة رقم في لوحة الرئيسية. */
export function stat(label, valueEl, { tone = '', ic = null } = {}) {
  return h('div', { class: `stat ${tone ? `stat-${tone}` : ''}`.trim() },
    h('div', { class: 'stat-label' }, ic ? icon(ic, 16) : null, label),
    h('div', { class: 'stat-value' }, valueEl),
  );
}

/** شارة حالة المزامنة: صغيرة وهادئة، لا تمنع المستخدم من أي شيء. */
export function syncBadge() {
  const el = h('button', { class: 'sync-badge', type: 'button', 'aria-label': 'حالة المزامنة', onclick: () => { location.hash = '#/settings/sync'; } });
  function paint(s) {
    const map = {
      disabled: ['cloudOff', 'على الجهاز', 'muted'],
      offline: ['cloudOff', s.pending ? `${s.pending} بانتظار الإنترنت` : 'بلا إنترنت', 'muted'],
      syncing: ['refresh', 'مزامنة…', 'busy'],
      synced: ['cloud', 'محفوظ', 'ok'],
      idle: ['cloud', s.pending ? `${s.pending} للرفع` : 'محفوظ', s.pending ? 'muted' : 'ok'],
      error: ['alert', 'تحقق من المزامنة', 'warn'],
    };
    let [ic, text, tone] = map[s.state] || map.idle;
    if (s.state === 'synced' && s.pending) { ic = 'cloudUp'; text = `${s.pending} للرفع`; tone = 'muted'; }
    el.className = `sync-badge sync-${tone}`;
    fill(el, icon(ic, 16), h('span', null, text));
  }
  paint(app.sync?.status || { state: 'idle', pending: 0 });
  // يلغي الاشتراك وحده حين تُغلق الشاشة التي تحمله
  const off = bus.on('sync', (s) => (el.isConnected || !el.dataset.seen ? paint(s) : off()));
  requestAnimationFrame(() => { el.dataset.seen = '1'; });
  return el;
}

/**
 * جدول بأعمدة للشاشة العريضة (الحاسوب): ترتيب بالضغط على رأس العمود، وتنقّل بالأسهم و Enter.
 * columns: [{ key, label, cell: (row) => عنصر أو نص, by: (row) => قيمة الترتيب (اختياري), num: true لعمود أرقام, grow: true للعمود الرئيسي }]
 * rows تُعرض بترتيبها حتى يختار المستخدم عمودًا. onRow(row) عند الضغط أو Enter.
 */
export function dataTable({ columns, rows, onRow = null, pageSize = 100, rowClass = null, sort = null }) {
  let state = sort; // { key, dir: 1 | -1 }
  let shown = pageSize;
  const head = h('tr');
  const tbody = h('tbody');
  const more = h('button', { class: 'btn btn-outline dt-more', type: 'button', onclick: () => { shown += pageSize * 2; paintBody(); } });
  const wrap = h('div', { class: 'dt-wrap' }, h('table', { class: 'dt' }, h('thead', null, head), tbody), more);

  function ordered() {
    const col = state && columns.find((c) => c.key === state.key);
    if (!col || !col.by) return rows;
    const val = (r) => { const v = col.by(r); return v === null || v === undefined ? '' : v; };
    return rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ar', { numeric: true });
      return d * state.dir;
    });
  }

  function paintHead() {
    fill(head, ...columns.map((c) => {
      const on = state && state.key === c.key;
      const cls = `${c.num ? 'dt-num' : ''} ${c.grow ? 'dt-grow' : ''}`.trim();
      if (!c.by) return h('th', { class: `dt-plain ${cls}`.trim(), scope: 'col' }, c.label);
      return h('th', { class: cls, scope: 'col', 'aria-sort': on ? (state.dir > 0 ? 'ascending' : 'descending') : 'none' },
        h('button', { class: `dt-sort ${on ? 'on' : ''}`, type: 'button', title: 'رتّب حسب هذا العمود',
          onclick: () => { state = on ? (state.dir > 0 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }; paintHead(); paintBody(); } },
        c.label, h('span', { class: 'dt-arrow', 'aria-hidden': 'true' }, on ? (state.dir > 0 ? '▲' : '▼') : '↕')));
    }));
  }

  function paintBody() {
    const list = ordered();
    fill(tbody, ...list.slice(0, shown).map((r) => {
      const tr = h('tr', { class: `${onRow ? 'dt-tap' : ''} ${rowClass ? rowClass(r) || '' : ''}`.trim(), tabindex: onRow ? '0' : null },
        ...columns.map((c) => h('td', { class: `${c.num ? 'dt-num' : ''} ${c.grow ? 'dt-grow' : ''}`.trim() }, c.cell(r))));
      if (onRow) {
        tr.addEventListener('click', () => onRow(r));
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); onRow(r); }
          const to = e.key === 'ArrowDown' ? tr.nextElementSibling : e.key === 'ArrowUp' ? tr.previousElementSibling : null;
          if (to) { e.preventDefault(); to.focus(); }
        });
      }
      return tr;
    }));
    more.hidden = list.length <= shown;
    more.textContent = `اعرض المزيد (${Math.max(0, list.length - shown)})`;
  }

  paintHead();
  paintBody();
  return wrap;
}
