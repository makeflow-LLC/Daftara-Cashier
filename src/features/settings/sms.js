// الإعدادات ← رسائل SMS للزبائن: مطفأة حتى يشغّلها صاحب المحل. لكل حدث قالب يعدّله كما يحب.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, switchRow } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';
import { SMS_EVENTS, PLACEHOLDERS, DEFAULT_TEMPLATES, renderSms, smsParts } from '../../domain/sms.js';
import { WEEKDAYS, LAST_DAY, nextRun, whenText, customersText, isDue } from '../../domain/reminders.js';
import { navigate } from '../../core/router.js';

const SAMPLE = { name: 'أبو أحمد', amount: 2000, balance: 15000 };

export function renderSmsSettings(el) {
  const body = h('div');
  el.append(header('رسائل SMS للزبائن', { back: true }), h('div', { class: 'page' }, body));
  let s = app.sms.settings();

  async function save(next) {
    s = next;
    await app.sms.save(s);
  }

  function templateBox(key, title) {
    const ta = h('textarea', { class: 'input textarea sms-ta', rows: 3, maxlength: 300 }, s.templates[key]);
    const preview = h('div', { class: 'sms-preview' });
    const paint = () => {
      const text = renderSms(ta.value, { ...SAMPLE, shop: app.shop?.name, currency: app.shop?.base_currency || 'ILS' });
      const n = smsParts(text);
      fill(preview, h('span', { class: 'sms-bubble' }, text), h('small', null, n <= 1 ? 'رسالة واحدة' : `${n} رسائل من الرصيد`));
    };
    ta.addEventListener('input', paint);
    ta.addEventListener('change', () => save({ ...s, templates: { ...s.templates, [key]: ta.value.trim() || DEFAULT_TEMPLATES[key] } }));
    const chips = h('div', { class: 'chips sms-chips' }, ...PLACEHOLDERS.map((p) => h('button', {
      class: 'chip', type: 'button',
      onclick: () => {
        const at = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, at) + p + ta.value.slice(ta.selectionEnd ?? at);
        ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new Event('change')); ta.focus();
      },
    }, p)));
    const reset = h('button', { class: 'link-btn', type: 'button', onclick: () => { ta.value = DEFAULT_TEMPLATES[key]; ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new Event('change')); } }, 'رجّع النص الأصلي');
    paint();
    return h('div', { class: 'sms-box' }, title ? h('div', { class: 'sms-title' }, title) : null, ta, chips, preview, reset);
  }

  async function paint() {
    const auto = app.sms.canAuto;
    fill(body,
      h('div', { class: 'acc-card acc-info' }, h('span', { class: 'acc-ic' }, icon('chat', 30)),
        h('div', null, h('strong', null, 'رسالة للزبون بعد كل حركة'),
          h('span', null, 'مثلًا عند استلام دفعة: «شكرًا لك! استلمنا 20 ₪. الباقي عليك 150 ₪». تُرسل من شريحة جوالك وعلى رصيدها.'))),
      auto
        ? h('div', { class: 'list' }, switchRow({
          title: 'أرسل رسائل SMS تلقائيًا', sub: s.enabled ? 'مفعّلة' : 'مطفأة',
          checked: s.enabled,
          onchange: async (on) => {
            if (on && !(await app.sms.requestPermission())) {
              feedback.error(); toast('يلزم السماح للتطبيق بإرسال الرسائل', { kind: 'error' }); paint(); return;
            }
            await save({ ...s, enabled: on, events: on && !Object.values(s.events).some(Boolean) ? { debt: true, sale_credit: true, payment: true } : s.events });
            paint();
          },
        }))
        : h('div', { class: 'acc-card acc-warn' }, icon('info', 26), h('div', null, h('strong', null, 'الإرسال التلقائي غير متاح في هذه النسخة'),
          h('span', null, 'متاح في تطبيق الجوال المحمّل من makeflow.tech. هنا تستطيع إرسال رسالة بنفسك من زر «رسالة SMS» في صفحة الزبون.'))),
      auto && s.enabled ? h('div', null,
        h('h2', { class: 'section-title' }, 'متى تُرسل؟'),
        ...SMS_EVENTS.map((ev) => h('div', { class: 'sms-event' },
          h('div', { class: 'list' }, switchRow({
            title: ev.label, checked: s.events[ev.key],
            onchange: async (on) => { await save({ ...s, events: { ...s.events, [ev.key]: on } }); paint(); },
          })),
          s.events[ev.key] ? templateBox(ev.key) : null))) : null,
      scheduleSection(auto),
      h('h2', { class: 'section-title' }, 'نص رسالة التذكير'),
      templateBox('reminder'),
      h('p', { class: 'muted small' }, 'الرسالة العربية الواحدة 70 حرفًا؛ الأطول تُحسب رسالتين أو أكثر. تُرسل فقط لزبون له رقم جوال.'),
    );
  }
  // ---------- التذكير الدوري ----------
  function scheduleSection(auto) {
    const r = app.reminders.settings();
    const set = async (patch) => { await app.reminders.save(patch); paint(); app.reminders.check(); };
    const chip = (on, label, onclick) => h('button', { class: `chip ${on ? 'on' : ''}`, type: 'button', onclick }, label);
    const box = h('div', { class: 'sched' });
    if (!r.enabled) {
      fill(box, h('div', { class: 'list' }, switchRow({ title: 'ذكّر الزبائن بديونهم دوريًا', sub: 'مثلًا أول كل شهر: رسالة لكل من عليه دين', checked: false, onchange: (on) => set({ enabled: on }) })));
      return h('div', null, h('h2', { class: 'section-title' }, 'تذكير دوري بالديون'), box);
    }
    const days = r.freq === 'weekly'
      ? [6, 0, 1, 2, 3, 4, 5].map((d) => chip(r.day === d, WEEKDAYS[d], () => set({ day: d })))
      : [...Array.from({ length: 28 }, (_, i) => i + 1).map((d) => chip(r.day === d, String(d), () => set({ day: d }))), chip(r.day === LAST_DAY, 'آخر الشهر', () => set({ day: LAST_DAY }))];
    const next = nextRun(r, Date.now());
    fill(box,
      h('div', { class: 'list' }, switchRow({ title: 'ذكّر الزبائن بديونهم دوريًا', sub: 'مفعّل', checked: true, onchange: (on) => set({ enabled: on }) })),
      h('div', { class: 'sched-next' }, icon('star', 20), h('span', null, 'التذكير القادم: ', h('b', null, isDue(r, Date.now()) ? 'الآن — افتح الرئيسية' : whenText(next)))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'كل'),
        h('div', { class: 'chips' }, chip(r.freq === 'monthly', 'شهر', () => set({ freq: 'monthly', day: 1 })), chip(r.freq === 'weekly', 'أسبوع', () => set({ freq: 'weekly', day: 4 })))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, r.freq === 'weekly' ? 'في يوم' : 'في يوم (من الشهر)'),
        h('div', { class: `chips ${r.freq === 'monthly' ? 'day-grid' : ''}` }, ...days)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'الساعة'),
        h('div', { class: 'chips' }, ...[9, 10, 12, 16, 18, 20].map((hr) => chip(r.hour === hr, `${hr}:00`, () => set({ hour: hr }))))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'لمن عليه دين أكثر من'),
        h('div', { class: 'chips' }, ...[[100, 'أي مبلغ'], [1000, '10 ₪'], [5000, '50 ₪'], [10000, '100 ₪'], [50000, '500 ₪']].map(([v, l]) => chip(r.minBalance === v, l, () => set({ minBalance: v }))))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'وأقدم دين عليه منذ'),
        h('div', { class: 'chips' }, ...[[0, 'أي وقت'], [7, 'أسبوع'], [30, 'شهر'], [60, 'شهرين']].map(([v, l]) => chip(r.minDays === v, l, () => set({ minDays: v }))))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'عند الموعد'),
        h('div', { class: 'chips' },
          chip(r.mode === 'ask', 'اعرض لي القائمة لأراجعها', () => set({ mode: 'ask' })),
          auto ? chip(r.mode === 'auto', 'أرسل وحده وأبلغني', () => set({ mode: 'auto' })) : null),
        h('span', { class: 'field-hint' }, r.mode === 'auto' && auto ? 'يرسل SMS للجميع وحده عند الموعد، ثم يخبرك كم رسالة أُرسلت.' : 'تظهر لك لافتة على الرئيسية: تراجع القائمة وترسل بضغطة.')),
      h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: () => navigate('/customers/remind') }, icon('users', 20), h('span', null, 'شاهد من سيصله التذكير الآن')),
      r.log.length ? h('div', { class: 'sched-log' }, h('div', { class: 'field-label' }, 'آخر التذكيرات'),
        ...r.log.slice(0, 5).map((x) => h('div', { class: 'row-sub' }, `${new Date(x.at).toLocaleDateString('en-GB')} — ${x.count ? `أُرسل إلى ${customersText(x.count)}` : 'لا إرسال'}${x.note ? ` (${x.note})` : ''}`))) : null,
    );
    return h('div', null, h('h2', { class: 'section-title' }, 'تذكير دوري بالديون'), box);
  }

  paint();
}
