// الصندوق: كم يجب أن يكون في الدرج الآن، و«أغلق الصندوق» برقم واحد: المبلغ المعدود. النتيجة فورًا: مطابق، زيادة، أو عجز.
// «ابدأ اليوم» اختياري (نقد أول اليوم، ويُقترح ما بقي من آخر إغلاق). البيع لا يتوقف عليه.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, field, money, row } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { parseMoney, formatMoney, CURRENCIES } from '../../domain/currency.js';
import { formatDecimal } from '../../domain/money.js';
import { STATE_LABEL, closingText } from '../../domain/cash.js';
import { dateTimeText } from '../../domain/invoice.js';
import { whatsappLink } from '../../domain/ledger.js';
import { app } from '../../core/app.js';
import { bus } from '../../core/bus.js';
import { openLink } from '../customers/customers.js';

const cur = () => app.shop?.base_currency || 'ILS';

export function renderCash(el) {
  const top = h('div');
  const hist = h('div');
  el.append(header('الصندوق', { back: true }), h('div', { class: 'page' }, top, hist));

  async function load() {
    const s = await app.cash.summary();
    const kv = (label, value, cls = '') => h('div', { class: `rc-kv ${cls}` }, h('span', null, label), value);
    fill(top,
      h('div', { class: 'balance-card clear' },
        h('div', { class: 'hero-label' }, 'يجب أن يكون في الدرج الآن'),
        h('div', { class: 'hero-value' }, money(s.expectedCash)),
        h('div', { class: 'hero-mini-label' }, s.virtual ? ['محسوب منذ ', num(dateTimeText(s.since))] : ['منذ فتح الصندوق ', num(dateTimeText(s.since))])),
      h('div', { class: 'card' },
        kv('نقد أول اليوم', money(s.opening)), kv('دخل نقدًا (بيع ودفعات زبائن)', money(s.cashIn)), kv('خرج نقدًا (مشتريات، موردون، مرتجع)', money(s.cashOut)),
        ...s.methods.map((m) => kv(m.name, money(m.total))),
        s.credit ? kv('بيع آجل', money(s.credit)) : null),
      button('أغلق الصندوق', { block: true, size: 'lg', icon: 'check', onclick: () => closeSheet(s) }),
      s.virtual ? button('ابدأ اليوم بنقد في الدرج', { kind: 'outline', icon: 'cash', block: true, onclick: openSheetDay }) : null,
    );
    const list = await app.cash.history();
    fill(hist, list.length ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'الإغلاقات السابقة'),
      h('div', { class: 'list' }, ...list.map((c) => {
        const d = c.difference || 0;
        return row({
          icon: d === 0 ? 'check' : 'alert', tone: d < 0 ? 'danger' : d > 0 ? 'warn' : '',
          title: d === 0 ? 'مطابق' : d > 0 ? ['زيادة ', num(formatMoney(d, cur()))] : ['عجز ', num(formatMoney(-d, cur()))],
          sub: num(dateTimeText(c.closed_at)), end: money(c.counted?.cash ?? 0),
        });
      }))) : null);
  }

  async function openSheetDay() {
    const last = await app.cash.lastClosed();
    const minor = CURRENCIES[cur()].minor;
    const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0', value: last && last.counted?.cash ? formatDecimal(last.counted.cash, minor, { trim: true, group: false }) : '' });
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const v = amt.value.trim() ? parseMoney(amt.value, cur()) : 0;
        try { await app.cash.open(v); feedback.ok(); close(); load(); toast('بدأ اليوم — بالتوفيق', { kind: 'ok' }); }
        catch (err) { feedback.error(); toast(err.message, { kind: 'error' }); }
      },
    }, field('كم في الدرج الآن؟', amt, last ? 'اقترحنا ما عددته في آخر إغلاق' : null),
      button('ابدأ اليوم', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: 'نقد أول اليوم' });
    setTimeout(() => { amt.focus(); amt.select(); }, 150);
  }

  function closeSheet(s) {
    const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0' });
    const live = h('div');
    const paintLive = () => {
      const v = amt.value.trim() ? parseMoney(amt.value, cur()) : null;
      if (v === null) { fill(live); return; }
      const d = v - s.expectedCash;
      fill(live, h('div', { class: `pay-change ${d < 0 ? 'bad' : 'ok'}` }, h('span', null, d === 0 ? 'مطابق تمامًا' : d > 0 ? 'زيادة' : 'عجز'), money(Math.abs(d))));
    };
    amt.addEventListener('input', paintLive);
    let busy = false;
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (busy) return;
        const v = amt.value.trim() ? parseMoney(amt.value, cur()) : null;
        if (v === null || v < 0) { feedback.error(); toast('عُدّ النقد في الدرج واكتب المبلغ', { kind: 'error' }); amt.focus(); return; }
        busy = true;
        try { const r = await app.cash.close(v); feedback.ok(); close(); load(); result(r); }
        catch (err) { busy = false; feedback.error(); toast(err.message, { kind: 'error' }); }
      },
    }, h('div', { class: 'pay-total' }, h('span', null, 'المتوقع'), money(s.expectedCash)),
      field('عُدّ النقد في الدرج واكتب المبلغ', amt), live,
      button('أغلق الصندوق', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: 'إغلاق الصندوق' });
    setTimeout(() => amt.focus(), 150);
  }

  function result(r) {
    const text = closingText({ shopName: app.shop.name, session: r.session, summary: r.summary, currency: cur() });
    openSheet((close) => h('div', { class: 'done' },
      h('div', { class: `done-ic ${r.state === 'short' ? 'bad' : ''}` }, icon(r.state === 'match' ? 'check' : 'alert', 40)),
      h('div', { class: 'done-title' }, STATE_LABEL[r.state]),
      r.difference ? h('div', { class: 'done-total' }, money(Math.abs(r.difference))) : null,
      h('div', { class: 'muted' }, 'المتوقع ', num(formatMoney(r.summary.expectedCash, cur())), ' — المعدود ', num(formatMoney(r.session.counted_cash, cur()))),
      h('button', { class: 'btn btn-wa btn-block', type: 'button', onclick: () => openLink(whatsappLink(app.shop.phone, text)) }, icon('receipt', 22), h('span', null, 'أرسل الملخص واتساب')),
      button('تم', { block: true, size: 'lg', icon: 'check', onclick: close }),
    ), { title: null });
  }

  load();
  return bus.on('data', (e) => { if (e.tables.includes('payments') || e.tables.includes('cash_sessions')) load(); });
}
