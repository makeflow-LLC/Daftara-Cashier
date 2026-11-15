// الإعدادات ← رسائل SMS للزبائن: مطفأة حتى يشغّلها صاحب المحل. لكل حدث قالب يعدّله كما يحب.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, switchRow } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';
import { SMS_EVENTS, PLACEHOLDERS, DEFAULT_TEMPLATES, renderSms, smsParts } from '../../domain/sms.js';

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
      h('h2', { class: 'section-title' }, 'رسالة التذكير (زر «رسالة SMS» في صفحة الزبون)'),
      templateBox('reminder'),
      h('p', { class: 'muted small' }, 'الرسالة العربية الواحدة 70 حرفًا؛ الأطول تُحسب رسالتين أو أكثر. تُرسل فقط لزبون له رقم جوال.'),
    );
  }
  paint();
}
