// «تذكير الزبائن»: كل من عليه دين في قائمة واحدة. SMS للكل بضغطة (نسخة التحميل المباشر)، أو واتساب/SMS لكل زبون.
// تُفتح يدويًا من صفحة الزبائن، أو من لافتة الرئيسية حين يحين موعد التذكير الدوري.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, money, emptyState } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { whatsappLink, normalizePhone } from '../../domain/ledger.js';
import { daysSince, customersText } from '../../domain/reminders.js';
import { smsLink } from '../../domain/sms.js';
import { openLink } from './customers.js';

export async function renderRemind(el, params) {
  const fromSchedule = params.due === '1';
  const body = h('div');
  const bar = h('div', { class: 'remind-bar' });
  el.append(header('تذكير الزبائن', { back: true }), h('div', { class: 'page remind-page' }, body), bar);
  const s = app.reminders.settings();
  let showAll = !fromSchedule;
  let list = [];
  const excluded = new Set(s.excluded);
  const now = Date.now();

  async function load() {
    const all = await app.customers.debtors();
    list = showAll ? all : await app.reminders.recipients({ ...s, excluded: [] }, now);
    paint();
  }
  const chosen = () => list.filter((c) => !excluded.has(c.id) && normalizePhone(c.phone));

  function paint() {
    const pick = chosen();
    const total = pick.reduce((t, c) => t + c.balance, 0);
    fill(body,
      h('div', { class: 'debt-card' },
        h('div', { class: 'hero-label' }, fromSchedule ? 'حان موعد التذكير الدوري' : 'سيصلهم تذكير'),
        h('div', { class: 'hero-value' }, money(total)),
        h('div', { class: 'hero-mini-label' }, `${customersText(pick.length)} من ${list.length}`)),
      h('div', { class: 'chips remind-filter' },
        h('button', { class: `chip ${!showAll ? 'on' : ''}`, type: 'button', onclick: () => { showAll = false; load(); } }, 'حسب إعدادات التذكير'),
        h('button', { class: `chip ${showAll ? 'on' : ''}`, type: 'button', onclick: () => { showAll = true; load(); } }, 'كل من عليه دين')),
      list.length ? h('div', { class: 'list' }, ...list.map((c) => {
        const phone = normalizePhone(c.phone);
        const days = daysSince(c.oldestUnpaidAt, now);
        const box = h('input', {
          type: 'checkbox', class: 'remind-check', checked: !excluded.has(c.id) && !!phone, disabled: !phone,
          onchange: (e) => { if (e.target.checked) excluded.delete(c.id); else excluded.add(c.id); app.reminders.save({ excluded: [...excluded] }); paint(); },
        });
        return h('div', { class: `row remind-row ${excluded.has(c.id) || !phone ? 'off' : ''}` },
          h('label', { class: 'remind-pick' }, box),
          h('button', { class: 'row-main', type: 'button', onclick: () => navigate(`/customers/view?id=${c.id}`) },
            h('span', { class: 'row-title' }, c.name),
            h('span', { class: 'row-sub' }, phone ? num(c.phone) : 'لا رقم جوال', days ? ` · منذ ${days} يوم` : '')),
          h('span', { class: 'row-end owed' }, money(c.balance)),
          phone ? h('span', { class: 'remind-acts' },
            h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'واتساب', onclick: () => openLink(whatsappLink(c.phone, app.reminders.text(c, now))) }, icon('chat', 18)),
            h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'SMS', onclick: () => openLink(smsLink(phone, app.reminders.text(c, now))) }, icon('phone', 18))) : null);
      })) : emptyState('check', 'لا أحد عليه دين يستحق التذكير', 'غيّر الشروط من الإعدادات ← رسائل SMS للزبائن.'),
      h('p', { class: 'muted small' }, 'الزبون الذي تزيل علامته لا تصله تذكيرات دورية حتى تعيدها. نص الرسالة من الإعدادات ← رسائل SMS للزبائن.'),
    );
    paintBar(pick);
  }

  function paintBar(pick) {
    const auto = app.sms.canAuto;
    fill(bar,
      auto ? h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', disabled: !pick.length, onclick: sendAll }, icon('chat', 22), h('span', null, `أرسل SMS إلى ${customersText(pick.length)}`))
        : h('p', { class: 'muted small remind-hint' }, 'اضغط واتساب أو SMS بجانب كل زبون. (الإرسال للكل بضغطة متاح في تطبيق الجوال من makeflow.tech)'),
      fromSchedule ? h('button', { class: 'btn btn-text btn-block', type: 'button', onclick: async () => { await app.reminders.markDone(0, 'تُخطّي'); toast('لن نذكّرك حتى الموعد القادم'); history.back(); } }, auto ? 'ليس هذه المرة' : 'انتهيت — لا تذكّرني حتى الموعد القادم') : null);
  }

  async function sendAll() {
    const pick = chosen();
    if (!pick.length) return;
    if (!(await app.sms.permission()) && !(await app.sms.requestPermission())) { feedback.error(); toast('يلزم السماح للتطبيق بإرسال الرسائل', { kind: 'error' }); return; }
    const status = h('div', { class: 'remind-progress' }, 'نرسل…');
    fill(bar, status);
    const res = await app.reminders.sendAll(pick, (i, n) => { status.textContent = `أُرسل ${i} من ${n}…`; });
    if (fromSchedule) await app.reminders.markDone(res.sent, res.failed ? `${res.failed} لم تُرسل` : null);
    feedback.ok();
    toast(`أُرسل التذكير إلى ${customersText(res.sent)} ✓${res.failed ? ` — ${res.failed} لم تُرسل (رصيد الشريحة؟)` : ''}`, { kind: res.failed ? 'error' : 'ok', ms: 5000 });
    paint();
  }

  load();
}

/** لافتة الرئيسية حين يحين موعد «اسألني أولًا». */
export function reminderBanner() {
  const box = h('div');
  const paint = () => {
    const d = app.reminders && app.reminders.due;
    fill(box, d ? h('button', { class: 'lic-banner lic-warn', type: 'button', onclick: () => navigate('/customers/remind?due=1') },
      icon('chat', 26),
      h('span', { class: 'row-main' }, h('strong', null, 'حان موعد تذكير الزبائن بديونهم'), h('span', null, `${customersText(d.count)} — المجموع `, money(d.total))),
      h('span', { class: 'lic-cta' }, 'راجع وأرسل')) : null);
  };
  paint();
  app.bus.on('reminders', paint);
  return box;
}
