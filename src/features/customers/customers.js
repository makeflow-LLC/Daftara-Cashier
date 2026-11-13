// الزبائن والديون: القائمة (الأكثر دينًا أولًا)، صفحة الزبون (دفعة / دين بضغطتين)، كشف الحساب،
// تذكير وكشف عبر واتساب، والاستيراد من دفترة.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, iconButton, emptyState, syncBadge, button, money, input, field } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import { ENTRY_LABELS, normalizePhone, whatsappLink, reminderText, statementText, parseDaftaraBackup } from '../../domain/ledger.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { navigate } from '../../core/router.js';
import { showReceipt } from '../sale/receipt.js';

const cur = () => app.shop?.base_currency || 'ILS';
const dateText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** يفتح رابطًا خارجيًا (واتساب، اتصال): داخل التطبيق يسلّمه أندرويد للتطبيق المناسب. */
export function openLink(url) {
  const native = globalThis.Capacitor?.isNativePlatform?.();
  const w = native ? null : window.open(url, '_blank', 'noopener');
  if (!w) window.location.href = url;
}

// ============ القائمة ============
export function renderCustomers(el) {
  let all = [];
  let query = '';
  const search = input({ type: 'search', placeholder: 'ابحث بالاسم أو رقم الجوال', autocomplete: 'off', oninput: (e) => { query = e.target.value; paint(); } });
  const totalEl = h('div');
  const body = h('div');

  el.append(
    header('الزبائن', { actions: [syncBadge()] }),
    h('div', { class: 'page' },
      totalEl,
      h('div', { class: 'search-row' }, icon('search', 20), search),
      h('div', { class: 'product-actions' },
        button('زبون جديد', { icon: 'plus', onclick: () => editCustomer(null, (c) => navigate(`/customers/view?id=${c.id}`)) }),
        button('استيراد من دفترة', { kind: 'outline', icon: 'clipboard', onclick: () => importFromDaftara(load) }),
      ),
      body,
    ),
  );

  function paint() {
    const owing = all.filter((c) => c.balance > 0);
    const total = owing.reduce((a, c) => a + c.balance, 0);
    fill(totalEl, all.length ? h('div', { class: 'debt-card' },
      h('div', { class: 'hero-label' }, 'لك عند الزبائن'),
      h('div', { class: 'hero-value' }, money(total)),
      h('div', { class: 'hero-mini-label' }, `${owing.length} زبون عليه دين من ${all.length}`)) : null);
    if (!all.length) {
      fill(body, emptyState('users', 'لا زبائن بعد', 'أضف زبونًا، أو انقل زبائنك وديونهم من تطبيق دفترة بضغطة.'));
      return;
    }
    const items = app.customers.search(all, query);
    fill(body, items.length ? h('div', { class: 'list' }, ...items.slice(0, 200).map((c) => h('button', {
      class: 'row row-tap', type: 'button', onclick: () => navigate(`/customers/view?id=${c.id}`),
    }, h('span', { class: `avatar ${c.balance > 0 ? 'owed' : ''}` }, c.name.trim().charAt(0)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.name), c.phone ? h('span', { class: 'row-sub num' }, c.phone) : null),
      c.balance ? h('span', { class: `row-end ${c.balance > 0 ? 'owed' : 'credit'}` }, money(c.balance)) : h('span', { class: 'row-end muted small' }, 'لا دين'))))
      : emptyState('search', 'لا نتائج', `لا زبون يطابق «${query}»`));
  }

  async function load() { all = await app.customers.list(); paint(); }
  load();
  return bus.on('data', (e) => { if (e.tables.includes('customers') || e.tables.includes('customer_entries')) load(); });
}

// ============ صفحة الزبون ============
export async function renderCustomer(el, params) {
  let c = await app.customers.get(params.id);
  if (!c) { navigate('/customers', { replace: true }); return undefined; }
  const top = h('div');
  const list = h('div');
  const titleEl = h('h1', null, c.name);

  el.append(
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'رجوع', onclick: () => history.back() }, icon('back')),
      h('div', { class: 'topbar-title' }, titleEl),
      h('div', { class: 'topbar-actions' }, iconButton('edit', 'تعديل الزبون', () => editCustomer(c, load, async () => {
        await app.customers.remove(c.id);
        history.back();
        toast(`حُذف «${c.name}»`, { undo: () => app.customers.restore(c.id) });
      }))),
    ),
    h('div', { class: 'page' }, top, list),
  );

  function paint() {
    titleEl.textContent = c.name;
    const owes = c.balance > 0;
    const phone = normalizePhone(c.phone);
    const days = c.oldestUnpaidAt ? Math.floor((Date.now() - Date.parse(c.oldestUnpaidAt)) / 86400000) : 0;
    fill(top,
      h('div', { class: `balance-card ${owes ? 'owed' : 'clear'}` },
        h('div', { class: 'hero-label' }, owes ? 'عليه' : c.balance < 0 ? 'له عندك' : 'لا شيء عليه'),
        h('div', { class: 'hero-value' }, money(Math.abs(c.balance))),
        owes && days >= 1 ? h('div', { class: 'hero-mini-label' }, `أقدم دين منذ ${days} يوم`) : null,
        c.note ? h('div', { class: 'hero-mini-label' }, c.note) : null),
      h('div', { class: 'big-actions' },
        h('button', { class: 'big-btn pay', type: 'button', onclick: () => amountSheet('payment') }, icon('cash', 26), h('span', null, 'استلمت دفعة')),
        h('button', { class: 'big-btn debt', type: 'button', onclick: () => amountSheet('debt') }, icon('plus', 26), h('span', null, 'دين جديد'))),
      h('div', { class: 'mini-actions' },
        miniBtn('alert', 'تذكير واتساب', () => send(reminderText({ shopName: app.shop.name, customerName: c.name, balance: c.balance, currency: cur() })), !owes),
        miniBtn('receipt', 'كشف واتساب', () => send(statementText({ shopName: app.shop.name, customerName: c.name, entries: c.raw, currency: cur(), formatDate: dateText })), !c.entries.length),
        miniBtn('phone', 'اتصال', () => openLink(`tel:+${phone}`), !phone)),
    );
    fill(list, c.entries.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'كشف الحساب'),
      h('div', { class: 'list' }, ...c.entries.map((e) => {
        const tap = e.invoice_id ? () => showReceipt(e.invoice_id, { doneLabel: 'إغلاق', doneIcon: 'x' }) : null;
        return h(tap ? 'button' : 'div', { class: `row ${tap ? 'row-tap' : ''}`, type: tap ? 'button' : null, onclick: tap },
          h('span', { class: `row-ic ${e.amount > 0 ? 'ic-debt' : ''}` }, icon(e.amount > 0 ? 'plus' : 'check', 20)),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, ENTRY_LABELS[e.type] || '', e.note ? h('span', { class: 'muted' }, ` · ${e.note}`) : null),
            h('span', { class: 'row-sub' }, num(dateText(e.created_at)), ' · الرصيد ', num(formatMoney(e.balance, cur())))),
          h('span', { class: `row-end ${e.amount > 0 ? 'owed' : 'credit'}` }, num(`${e.amount > 0 ? '+' : '−'}${formatMoney(Math.abs(e.amount), cur(), { symbol: false })}`)));
      })))
      : emptyState('receipt', 'لا حركات بعد', 'سجّل دينًا أو دفعة، أو بِع له بالآجل من شاشة البيع.'));
  }

  function miniBtn(ic, label, onclick, disabled) {
    return h('button', { class: 'mini-btn', type: 'button', onclick, disabled: !!disabled }, icon(ic, 20), h('span', null, label));
  }

  function send(text) {
    if (!normalizePhone(c.phone)) toast('لا رقم جوال لهذا الزبون — اختر جهة الاتصال من واتساب');
    openLink(whatsappLink(c.phone, text));
  }

  // مبلغ بضغطتين: اكتب الرقم ← حفظ. للدفعة زر «كامل المبلغ».
  async function amountSheet(kind) {
    const isPay = kind === 'payment';
    const minor = CURRENCIES[cur()].minor;
    const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0' });
    const note = input({ maxlength: 80, placeholder: 'مثال: خضار، سجائر (اختياري)' });
    const methods = isPay ? (await app.sales.paymentMethods()).filter((m) => m.kind !== 'credit') : [];
    let method = methods.find((m) => m.kind === 'cash') || methods[0] || null;
    const chips = h('div', { class: 'chips' });
    const paintChips = () => fill(chips, ...methods.map((m) => h('button', { class: `chip ${method === m ? 'on' : ''}`, type: 'button', onclick: () => { method = m; paintChips(); } }, m.name)));
    paintChips();
    let busy = false;
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (busy) return;
        const v = parseMoney(amt.value || '', cur());
        if (!v || v <= 0) { feedback.error(); toast('اكتب المبلغ', { kind: 'error' }); amt.focus(); return; }
        busy = true;
        try {
          if (isPay) await app.customers.recordPayment(c.id, v, method);
          else await app.customers.addDebt(c.id, v, note.value);
          feedback.ok();
          close();
          await load();
          toast(isPay ? `استُلمت ${formatMoney(v, cur())} — الباقي عليه ${formatMoney(Math.max(0, c.balance), cur())}` : `سُجّل دين ${formatMoney(v, cur())}`, { kind: 'ok', ms: 3500 });
        } catch (err) { busy = false; feedback.error(); toast(err.errors?.amount || 'تعذّر الحفظ', { kind: 'error' }); }
      },
    },
      field(isPay ? 'المبلغ المستلم' : 'مبلغ الدين', amt),
      isPay && c.balance > 0 ? h('div', { class: 'chips pay-quick' }, h('button', { class: 'chip', type: 'button', onclick: () => { amt.value = formatDecimal(c.balance, minor, { trim: true, group: false }); } }, 'كامل المبلغ ', num(formatMoney(c.balance, cur())))) : null,
      isPay ? (methods.length > 1 ? h('div', { class: 'field' }, chips) : null) : field('ملاحظة', note),
      button(isPay ? 'حفظ الدفعة' : 'حفظ الدين', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    ), { title: isPay ? `دفعة من ${c.name}` : `دين على ${c.name}` });
    setTimeout(() => amt.focus(), 150);
  }

  async function load() {
    const next = await app.customers.get(params.id);
    if (next) { c = next; paint(); }
  }
  paint();
  return bus.on('data', (e) => { if (e.source === 'remote' && (e.tables.includes('customers') || e.tables.includes('customer_entries'))) load(); });
}

// ============ إضافة / تعديل ============
export function editCustomer(c, onSaved, onDelete = null) {
  const name = input({ value: c ? c.name : '', maxlength: 60, placeholder: 'اسم الزبون' });
  const phone = input({ value: c ? c.phone || '' : '', type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: '059xxxxxxx' });
  const note = input({ value: c ? c.note || '' : '', maxlength: 120, placeholder: 'اختياري' });
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const data = { name: name.value, phone: phone.value, note: note.value };
        const saved = c ? await app.customers.update(c.id, data) : await app.customers.create(data);
        feedback.ok();
        close();
        if (onSaved) onSaved(saved);
      } catch (err) { feedback.error(); toast(err.errors?.name || 'تعذّر الحفظ', { kind: 'error' }); }
    },
  },
    field('الاسم', name), field('رقم الجوال (للتذكير وإرسال الفواتير على واتساب)', phone), field('ملاحظة', note),
    button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    c && onDelete ? button('حذف الزبون', { kind: 'text', onclick: () => { close(); onDelete(); } }) : null,
  ), { title: c ? 'تعديل الزبون' : 'زبون جديد' });
  setTimeout(() => { if (!c) name.focus(); }, 200);
}

// ============ الاستيراد من دفترة ============
export function importFromDaftara(onDone) {
  const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  document.body.append(file);
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.remove();
    if (!f) return;
    let list;
    try { list = parseDaftaraBackup(JSON.parse(await f.text())); }
    catch (e) { feedback.error(); toast(e.message.includes('دفترة') ? e.message : 'الملف غير مقروء — اختر ملف نسخة دفترة (daftara-….json)', { kind: 'error', ms: 5000 }); return; }
    const total = list.reduce((a, c) => a + Math.max(0, c.balance), 0);
    openSheet((close) => h('div', null,
      h('div', { class: 'debt-card' }, h('div', { class: 'hero-label' }, `في الملف ${list.length} زبون، مجموع ديونهم`), h('div', { class: 'hero-value' }, money(total))),
      h('p', { class: 'muted' }, 'يُنقل اسم كل زبون ورقمه ورصيده الحالي. من استوردته سابقًا لا يتكرر. تطبيق دفترة نفسه لا يتغير.'),
      button('استورد الآن', {
        block: true, size: 'lg', icon: 'check',
        onclick: async () => {
          const r = await app.customers.importDaftara(list);
          feedback.ok();
          close();
          toast(r.added ? `استُورد ${r.added} زبون${r.skipped ? ` (${r.skipped} موجود من قبل)` : ''}` : 'كل زبائن الملف موجودون من قبل', { kind: 'ok', ms: 4000 });
          if (onDone) onDone();
        },
      }),
    ), { title: 'استيراد من دفترة' });
  });
  openSheet((close) => h('div', null,
    h('ol', { class: 'steps' },
      h('li', null, 'افتح تطبيق دفترة ← الإعدادات ← «احفظ نسخة احتياطية».'),
      h('li', null, 'ارجع إلى هنا واضغط «اختر الملف».'),
      h('li', null, 'اختر الملف الذي اسمه daftara-…‎.json (تجده أيضًا في Documents/Daftara).')),
    button('اختر الملف', { block: true, size: 'lg', icon: 'clipboard', onclick: () => { close(); file.click(); } }),
  ), { title: 'استيراد من دفترة' });
}
