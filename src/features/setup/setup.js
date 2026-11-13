// الإعداد الأول: اسم المحل ثم نوعه (ضغطة واحدة تنشئ كل شيء). يعمل بلا إنترنت.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { field, input, button } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { SHOP_TYPES } from '../../domain/features.js';
import { normalizeDigits } from '../../domain/money.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';

export function renderSetup(el) {
  const state = { name: '', phone: '' };

  function stepName() {
    const nameIn = input({ id: 'shop-name', placeholder: 'مثال: سوبرماركت الأمل', maxlength: 60, enterkeyhint: 'next', value: state.name });
    const phoneIn = input({ id: 'shop-phone', type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: '059xxxxxxx', maxlength: 20, value: state.phone });
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    function next(e) {
      e?.preventDefault();
      state.name = nameIn.value.trim();
      state.phone = normalizeDigits(phoneIn.value).replace(/[^\d+]/g, '');
      if (!state.name) {
        err.textContent = 'اكتب اسم المحل';
        err.hidden = false;
        feedback.error();
        nameIn.focus();
        return;
      }
      stepType();
    }
    fill(el, h('div', { class: 'setup' },
      hero('أهلًا بك في دفترة كاشير', 'بيع، مخزون، فواتير وأرباح — يعمل بلا إنترنت.'),
      h('form', { class: 'setup-body', onsubmit: next },
        field('اسم المحل', nameIn),
        field('رقم جوال المحل (اختياري)', phoneIn, 'يظهر على الفواتير'),
        err,
        h('div', { class: 'setup-bottom' }, button('التالي', { type: 'submit', block: true, size: 'lg' }),
          h('button', { class: 'btn btn-text', type: 'button', onclick: async () => (await import('../tools/tools.js')).restoreFromFile() }, 'لدي نسخة احتياطية — استعادة')),
      ),
    ));
    setTimeout(() => nameIn.focus(), 50);
  }

  function stepType() {
    let busy = false;
    async function choose(type) {
      if (busy) return;
      busy = true;
      feedback.tap();
      try {
        await app.createShop({ name: state.name, phone: state.phone, shopType: type });
        navigate('/', { replace: true });
        toast('محلك جاهز! ابدأ البيع من الزر الأخضر', { kind: 'ok' });
      } catch (e) {
        console.error(e);
        busy = false;
        feedback.error();
        toast('لم يُحفظ المحل، حاول مرة أخرى', { kind: 'error' });
      }
    }
    fill(el, h('div', { class: 'setup' },
      hero('ما نوع محلك؟', 'نُظهر لك ما يناسبه فقط، وتغيّره متى شئت من الإعدادات.'),
      h('div', { class: 'setup-body' },
        h('div', { class: 'type-grid' },
          ...Object.entries(SHOP_TYPES).map(([key, t]) =>
            h('button', { class: 'type-tile', type: 'button', dataset: { type: key }, onclick: () => choose(key) },
              icon(t.icon, 34), h('span', null, t.name))),
        ),
        h('button', { class: 'btn btn-text', type: 'button', onclick: stepName }, icon('back', 18), 'رجوع لاسم المحل'),
      ),
    ));
  }

  stepName();
}

function hero(title, sub) {
  return h('div', { class: 'setup-hero' },
    logo(64),
    h('h1', null, title),
    h('p', null, sub),
  );
}

export function logo(size = 48) {
  const span = h('span', { class: 'logo', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 120 120" width="${size}" height="${size}"><rect x="10" y="10" width="100" height="100" rx="28" fill="#fff"/><rect x="30" y="34" width="60" height="10" rx="5" fill="#d7d3d3"/><rect x="30" y="54" width="44" height="10" rx="5" fill="#2a996c"/><path d="M32 74v16M41 74v16M47 74v16M57 74v16M64 74v16M73 74v16M80 74v16M88 74v16" stroke="#0e7a51" stroke-width="4.5" stroke-linecap="round"/></svg>`;
  return span;
}
