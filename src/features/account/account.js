// «حسابي»: حماية بيانات المحل برقم الهاتف وكلمة سر، والدخول بهما من جهاز جديد، و«نسيت كلمة السر».
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, field, input, button } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';
import { displayPhone, resetRequestMessage, MIN_PASSWORD } from '../../domain/account.js';
import { openLink } from '../customers/customers.js';
import { SUPPORT_PHONE } from '../help/feedback.js';

const phoneInput = (value = '') => input({ type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: '059xxxxxxx', maxlength: 20, autocomplete: 'tel', value });
const passInput = (ph = `${MIN_PASSWORD} أحرف أو أرقام على الأقل`, auto = 'current-password') => input({ type: 'password', dir: 'ltr', placeholder: ph, autocomplete: auto, maxlength: 64 });

/** زر يعرض «جارٍ…» أثناء العمل ويمنع الضغط المكرر. */
async function busy(btn, fn) {
  if (btn.disabled) return;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'لحظة…';
  try { await fn(); } catch (e) { feedback.error(); toast(e.message || 'حدث خطأ', { kind: 'error', ms: 5000 }); } finally { btn.disabled = false; btn.textContent = old; }
}

// ---------- الصفحة: حماية البيانات ----------
export function renderAccount(el) {
  const body = h('div');
  el.append(header('حسابي', { back: true }), h('div', { class: 'page' }, body));

  async function paint(editing = false) {
    if (!app.config.syncEnabled) {
      fill(body, h('div', { class: 'acc-card acc-warn' }, icon('alert', 28), h('div', null, h('strong', null, 'غير متاح في هذه النسخة'), h('span', null, 'هذه النسخة غير متصلة بالخادم.'))));
      return;
    }
    const phone = await app.account.phone();
    if (phone && !editing) {
      fill(body,
        h('div', { class: 'acc-card acc-ok' }, h('span', { class: 'acc-ic' }, icon('lock', 30)),
          h('div', null, h('strong', null, 'بياناتك محمية ✓'), h('span', null, 'برقم ', h('b', { class: 'num', dir: 'ltr' }, displayPhone(phone))))),
        h('div', { class: 'acc-help' },
          h('h2', { class: 'section-title' }, 'غيّرت جوالك أو تريد العمل من الحاسوب؟'),
          h('ol', null,
            h('li', null, 'ثبّت دفترة كاشير على الجهاز الجديد'),
            h('li', null, 'اضغط «عندي حساب — ادخل برقم الهاتف»'),
            h('li', null, 'اكتب رقمك وكلمة السر: يرجع محلك كاملًا'))),
        button('غيّر كلمة السر أو الرقم', { kind: 'outline', block: true, icon: 'edit', onclick: () => paint(true) }));
      return;
    }
    const ph = phoneInput(phone ? displayPhone(phone) : (app.shop?.phone || ''));
    const pw = passInput('كلمة سر جديدة', 'new-password');
    const pw2 = passInput('أعد كتابتها', 'new-password');
    const save = button(phone ? 'احفظ' : 'احمِ بياناتي', { type: 'submit', block: true, size: 'lg', icon: 'lock' });
    fill(body,
      phone ? null : h('div', { class: 'acc-card acc-info' }, h('span', { class: 'acc-ic' }, icon('cloudUp', 30)),
        h('div', null, h('strong', null, 'احمِ بياناتك برقم هاتفك'), h('span', null, 'إن ضاع الجوال أو تعطّل، تدخل برقمك على جوال جديد فيرجع محلك كاملًا. وتستطيع العمل من الحاسوب أيضًا.'))),
      h('form', {
        class: 'acc-form',
        onsubmit: (e) => {
          e.preventDefault();
          busy(save, async () => {
            await app.account.protect(ph.value, pw.value, pw2.value);
            feedback.ok();
            toast('بياناتك محمية الآن ✓ احفظ كلمة السر في مكان آمن', { kind: 'ok', ms: 5000 });
            paint();
          });
        },
      },
        field('رقم جوالك', ph),
        field('كلمة السر', pw, 'لا تحتاجها يوميًا — فقط عند الدخول من جهاز جديد'),
        field('تأكيد كلمة السر', pw2),
        save,
        phone ? button('إلغاء', { kind: 'text', block: true, onclick: () => paint() }) : null));
  }
  paint();
  app.account.refresh().then((p) => { if (p) paint(); });
}

// ---------- الدخول من جهاز جديد (من شاشة الإعداد الأول) ----------
export function openLogin() {
  const ph = phoneInput();
  const pw = passInput('كلمة السر');
  const go = button('ادخل', { type: 'submit', block: true, size: 'lg', icon: 'check' });
  openSheet((close) => h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      busy(go, async () => {
        go.textContent = 'ننزّل بيانات محلك…';
        const r = await app.account.login(ph.value, pw.value);
        feedback.ok();
        toast(`أهلًا من جديد — «${r.name}» ✓`, { kind: 'ok' });
        close();
        location.hash = '#/';
        location.reload();
      });
    },
  },
    h('p', { class: 'muted' }, 'اكتب الرقم وكلمة السر اللذين حميت بهما محلك. يلزم إنترنت لهذه الخطوة.'),
    field('رقم الجوال', ph),
    field('كلمة السر', pw),
    go,
    h('button', { class: 'btn btn-text btn-block', type: 'button', onclick: () => { close(); openForgot(ph.value); } }, 'نسيت كلمة السر؟'),
  ), { title: 'عندي حساب' });
  setTimeout(() => ph.focus(), 200);
}

// ---------- نسيت كلمة السر ----------
export function openForgot(prefill = '') {
  const ph = phoneInput(prefill);
  const step = h('div');
  const next = button('التالي', { type: 'submit', block: true, size: 'lg' });
  openSheet((close) => {
    function stepCode(phone, request) {
      const code = input({ dir: 'ltr', placeholder: 'DCR-…', autocapitalize: 'off', spellcheck: 'false' });
      const pw = passInput('كلمة سر جديدة', 'new-password');
      const pw2 = passInput('أعد كتابتها', 'new-password');
      const save = button('غيّر كلمة السر وادخل', { type: 'submit', block: true, size: 'lg', icon: 'check' });
      fill(step, h('form', {
        onsubmit: (e) => {
          e.preventDefault();
          busy(save, async () => {
            await app.account.reset(phone, code.value, pw.value, pw2.value);
            save.textContent = 'ننزّل بيانات محلك…';
            await app.account.login(phone, pw.value);
            feedback.ok();
            close();
            location.hash = '#/';
            location.reload();
          });
        },
      },
        h('div', { class: 'lic-steps' },
          h('div', null, h('b', { class: 'num' }, '1'), 'أرسل لنا الطلب على واتساب'),
          h('div', null, h('b', { class: 'num' }, '2'), 'نتأكد أنك صاحب المحل ونرسل لك كودًا'),
          h('div', null, h('b', { class: 'num' }, '3'), 'الصق الكود واختر كلمة سر جديدة')),
        h('button', { class: 'btn btn-wa btn-block btn-lg', type: 'button', onclick: () => openLink(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(resetRequestMessage({ phone, request }))}`) },
          icon('chat', 22), h('span', null, 'أرسل الطلب عبر واتساب')),
        field('الكود الذي وصلك', code),
        field('كلمة السر الجديدة', pw),
        field('تأكيد كلمة السر', pw2),
        save));
    }
    fill(step, h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        busy(next, async () => { const r = await app.account.resetRequest(ph.value); stepCode(r.phone, r.request); });
      },
    }, h('p', { class: 'muted' }, 'اكتب الرقم الذي حميت به محلك.'), field('رقم الجوال', ph), next));
    return step;
  }, { title: 'نسيت كلمة السر' });
  setTimeout(() => ph.focus(), 200);
}

/**
 * بعد أول بيع: يطلب حماية البيانات مرة واحدة فقط (مع «لاحقًا»). يرجع true إن فُتحت النافذة.
 * onClose تُستدعى عند إغلاقها (لإعادة تشغيل الكاميرا في شاشة البيع).
 */
export async function askProtectOnce({ onClose = null } = {}) {
  if (!app.config.syncEnabled || !app.account) return false;
  if ((await app.account.phone()) || (await app.meta.get('account:asked'))) return false;
  await app.meta.set('account:asked', true);
  const ph = phoneInput(app.shop?.phone || '');
  const pw = passInput('كلمة سر جديدة', 'new-password');
  const pw2 = passInput('أعد كتابتها', 'new-password');
  const save = button('احمِ بياناتي', { type: 'submit', block: true, size: 'lg', icon: 'lock' });
  openSheet((close) => h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      busy(save, async () => {
        await app.account.protect(ph.value, pw.value, pw2.value);
        feedback.ok();
        close();
        toast('بياناتك محمية الآن ✓ احفظ كلمة السر في مكان آمن', { kind: 'ok', ms: 5000 });
      });
    },
  },
    h('div', { class: 'acc-card acc-info' }, h('span', { class: 'acc-ic' }, icon('lock', 30)),
      h('div', null, h('strong', null, 'مبروك أول بيع! 🎉'), h('span', null, 'احمِ بياناتك الآن برقم هاتفك: إن ضاع الجوال أو تعطّل يرجع محلك كاملًا على جوال جديد.'))),
    field('رقم جوالك', ph),
    field('كلمة السر', pw, 'لا تحتاجها يوميًا — فقط عند الدخول من جهاز جديد'),
    field('تأكيد كلمة السر', pw2),
    save,
    h('button', { class: 'btn btn-text btn-block', type: 'button', onclick: () => { close(); toast('تجدها لاحقًا في المزيد ← حسابي'); } }, 'لاحقًا'),
  ), { title: 'احمِ بياناتك', onClose });
  // لا نفتح الكيبورد وحده: يرى التاجر النافذة كاملة وزر «لاحقًا» ثم يقرر
  return true;
}

/** لافتة صغيرة للرئيسية: تظهر حتى يحمي صاحب المحل بياناته. */
export function accountBanner() {
  const box = h('div');
  if (!app.config.syncEnabled) return box;
  app.account.phone().then((p) => {
    if (p) return;
    fill(box, h('button', { class: 'lic-banner lic-info', type: 'button', onclick: () => { location.hash = '#/account'; } },
      icon('lock', 26),
      h('span', { class: 'row-main' }, h('strong', null, 'احمِ بياناتك برقم هاتفك'), h('span', null, 'حتى لا تضيع إن ضاع الجوال')),
      h('span', { class: 'lic-cta' }, 'احمِ')));
  });
  return box;
}
