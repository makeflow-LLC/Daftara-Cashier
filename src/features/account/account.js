// «حسابي»: حماية بيانات المحل برقم الهاتف وكلمة سر، والدخول بهما من جهاز جديد، و«نسيت كلمة السر».
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, field, input, button } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { PRIVACY_URL, TERMS_URL } from '../../core/account.js';
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
        phone ? button('إلغاء', { kind: 'text', block: true, onclick: () => paint() })
          : button('عندي حساب من قبل — ادخل به', { kind: 'text', block: true, onclick: () => openLogin(ph.value) })));
  }
  paint();
  app.account.refresh().then((p) => { if (p) paint(); });
}

// ---------- الدخول بحساب موجود: من شاشة الإعداد الأول، ومن «أنشئ حسابك»، ومن «حسابي» ----------
// على جهاز فيه محل (جرّب التطبيق هنا قبل أن يدخل): نقول له بوضوح أن بيانات هذا الجهاز تُستبدل ببيانات حسابه.
export async function openLogin(prefill = '') {
  const local = await app.account.localShop();
  const ph = phoneInput(prefill);
  const pw = passInput('كلمة السر');
  const go = button(local ? 'ادخل واستبدل بيانات هذا الجهاز' : 'ادخل', { type: 'submit', block: true, size: 'lg', icon: 'check' });
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
    local ? h('div', { class: 'acc-card acc-warn' }, icon('alert', 26),
      h('div', null, h('strong', null, 'ينزل محلك مكان ما على هذا الجهاز'),
        h('span', null, local.products || local.sales
          ? `على هذا الجهاز الآن «${local.name}» وفيه ${local.products} صنف و${local.sales} فاتورة بيع. بعد الدخول يُحذف من هذا الجهاز ويظهر محل حسابك بكل بياناته.`
          : 'المحل التجريبي الذي على هذا الجهاز يُستبدل بمحل حسابك بكل بياناته.'))) : null,
    field('رقم الجوال', ph),
    field('كلمة السر', pw),
    go,
    h('button', { class: 'btn btn-text btn-block', type: 'button', onclick: () => { close(); openForgot(ph.value); } }, 'نسيت كلمة السر؟'),
  ), { title: 'عندي حساب' });
  setTimeout(() => (prefill ? pw : ph).focus(), 200);
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

let lastFail = null; // آخر فشل (offline | server): يبقى خيار المتابعة ظاهرًا إن أُعيد رسم الشاشة

// ---------- الحساب إلزامي: شاشة كاملة تظهر لكل محل بلا حساب (بعد الإعداد الأول، أو بعد التحديث) ----------
export function renderAccountRequired(el) {
  if (!app.account.required) { navigate('/', { replace: true }); return; }
  const ph = phoneInput(app.shop?.phone || '');
  const pw = passInput('كلمة سر جديدة', 'new-password');
  const pw2 = passInput('أعد كتابتها', 'new-password');
  const save = button('أنشئ حسابي', { type: 'submit', block: true, size: 'lg', icon: 'lock' });
  const offlineBox = h('div');
  const enter = (msg) => { navigate('/', { replace: true }); toast(msg, { kind: 'ok', ms: 4500 }); };
  // بلا إنترنت لا يتوقف البيع: يتابع هذه المرة، ونطلب الحساب عند الفتح القادم
  // (وكذلك إن تعذّر الخادم: لا نحبس صاحب المحل خارج تطبيقه)
  const showOffline = (server = false) => fill(offlineBox, h('div', { class: 'acc-card acc-warn' }, icon('cloudOff', 26),
    h('div', null, h('strong', null, server ? 'تعذّر إنشاء الحساب الآن' : 'لا يوجد إنترنت الآن'), h('span', null, server ? 'تابع عملك، وسنطلبه منك عند الفتح القادم. إن تكرر، راسلنا من «أرسل ملاحظة».' : 'إنشاء الحساب يحتاج إنترنت. تابع عملك، وسنطلبه منك عند الفتح القادم.'))),
  h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: () => { app.account.skipForNow(); enter('تابع عملك — أنشئ حسابك عند الفتح القادم'); } }, server ? 'تابع الآن' : 'تابع بلا إنترنت الآن'));

  // الرقم له حساب من قبل (صاحب المحل يعمل على جهاز آخر): لا ننشئ حسابًا ثانيًا، ندخله بحسابه
  const takenBox = h('div');
  const showTaken = () => fill(takenBox, h('div', { class: 'acc-card acc-info' }, icon('user', 26),
    h('div', null, h('strong', null, 'هذا الرقم له حساب من قبل'), h('span', null, 'إن كان حسابك، ادخل به فينزل محلك كاملًا على هذا الجهاز.'))),
  h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => openLogin(ph.value) }, icon('check', 22), h('span', null, 'ادخل بهذا الرقم')));

  el.append(h('div', { class: 'setup' },
    h('div', { class: 'setup-hero acc-hero' }, h('span', { class: 'acc-ic' }, icon('lock', 30)),
      h('h1', null, 'أنشئ حسابك'),
      h('p', null, 'جرّبت دفترة كاشير — الآن احفظ عملك. رقم جوالك وكلمة سر: بهما تحفظ بيانات محلك، وترجع كاملة إن ضاع الجوال أو غيّرته، وتعمل من الحاسوب أيضًا.')),
    h('form', {
      class: 'setup-body',
      onsubmit: (e) => {
        e.preventDefault();
        busy(save, async () => {
          fill(takenBox);
          try { await app.account.protect(ph.value, pw.value, pw2.value); } catch (err) {
            if (err.kind === 'offline' || err.kind === 'server') { lastFail = err.kind; showOffline(err.kind === 'server'); el.scrollTop = 0; window.scrollTo(0, 0); }
            if (err.kind === 'taken') { showTaken(); el.scrollTop = 0; window.scrollTo(0, 0); }
            throw err;
          }
          feedback.ok();
          enter('حسابك جاهز ✓ احفظ كلمة السر في مكان آمن');
        });
      },
    },
      offlineBox, // في الأعلى: ظاهر دائمًا حتى على الشاشات الصغيرة
      takenBox,
      field('رقم جوالك', ph),
      field('كلمة السر', pw, `${MIN_PASSWORD} أحرف أو أرقام على الأقل — تحتاجها فقط عند الدخول من جهاز جديد`),
      field('تأكيد كلمة السر', pw2),
      save,
      // من له حساب (يعمل على جوال آخر أو على الحاسوب) لا ينشئ حسابًا جديدًا: يدخل بحسابه
      h('div', { class: 'acc-or' }, h('span', null, 'أو')),
      h('button', { class: 'btn btn-outline btn-block btn-lg', type: 'button', onclick: () => openLogin(ph.value) }, icon('user', 22), h('span', null, 'عندي حساب — ادخل برقم الهاتف')),
      h('button', { class: 'btn btn-text btn-block', type: 'button', onclick: () => openLink(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent('مرحبًا، أحتاج مساعدة في حساب دفترة كاشير')}`) }, icon('chat', 20), h('span', null, 'تحتاج مساعدة؟ راسلنا على واتساب')),
      h('p', { class: 'muted small acc-legal' }, 'بإنشاء الحساب توافق على ',
        h('a', { href: TERMS_URL, target: '_blank', rel: 'noopener' }, 'شروط الاستخدام'), ' و',
        h('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener' }, 'سياسة الخصوصية'), '.'))));
  if (navigator.onLine === false) showOffline();
  else if (lastFail) showOffline(lastFail === 'server');
  // جهاز ثانٍ لمحل له حساب أصلًا: الخادم يعرف الرقم، فلا نطلب شيئًا
  app.account.refresh().then((p) => { if (p) enter('حسابك مفعّل ✓'); });
}

/** تذكير لطيف مرة واحدة بعد أول فواتير (مع «لاحقًا»): يُعرض في الرئيسية حين يكون صاحب المحل مرتاحًا. */
export async function maybeNudgeAccount() {
  if (!app.account.missing || (await app.account.check()) !== 'nudge') return;
  if (await app.meta.get('account:nudged')) return;
  await app.meta.set('account:nudged', true);
  openSheet((close) => h('div', { class: 'done' },
    h('span', { class: 'acc-ic' }, icon('cloudUp', 34)),
    h('h2', null, 'محلك بدأ يشتغل 👏'),
    h('p', null, 'سجّلت أول فواتيرك. احمِ تعبك برقم جوالك وكلمة سر: إن ضاع الجوال أو تعطّل يرجع محلك كاملًا، وتشتغل من الحاسوب أيضًا.'),
    button('احمِ بياناتي الآن', { block: true, size: 'lg', icon: 'lock', onclick: () => { close(); navigate('/account'); } }),
    button('لاحقًا', { kind: 'text', block: true, onclick: () => close() })));
}

/** لافتة صغيرة للرئيسية: تظهر بعد فترة التجول الأولى، حتى يحمي صاحب المحل بياناته. */
export function accountBanner() {
  const box = h('div');
  if (!app.config.syncEnabled) return box;
  Promise.all([app.account.phone(), app.account.check()]).then(([p, stage]) => {
    if (p || stage === 'explore') return;
    fill(box, h('button', { class: 'lic-banner lic-info', type: 'button', onclick: () => { location.hash = '#/account'; } },
      icon('lock', 26),
      h('span', { class: 'row-main' }, h('strong', null, 'احمِ بياناتك برقم هاتفك'), h('span', null, 'حتى لا تضيع إن ضاع الجوال')),
      h('span', { class: 'lic-cta' }, 'احمِ')));
  });
  return box;
}
