// الموظفون: شاشة القفل (من أنت؟ ثم الرمز)، وإدارة الموظفين وصلاحياتهم (لصاحب المحل فقط).
// كل بيع ودفعة وحركة تُحفظ باسم من دخل، فيعرف صاحب المحل من باع ماذا (التقارير وتقرير اليوم).
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, field, switchRow, emptyState, helpButton } from '../../ui/components.js';
import { toast, openSheet } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { PERMISSIONS, ROLES, pinProblem, makePin, checkPin, pinTaken, PIN_MAX } from '../../domain/staff.js';
import { uuid } from '../../core/ids.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { logo } from '../setup/setup.js';

const salt = () => uuid().replace(/-/g, '').slice(0, 16);
const people = (st) => [{ id: 'owner', owner: true, name: st.owner?.name || 'صاحب المحل' }, ...(st.members || []).filter((m) => m.active !== false)];
const roleName = (m) => (m.owner ? 'صاحب المحل' : ROLES[m.role]?.name || 'صلاحيات خاصة');

/** يحفظ إعداد الموظفين كاملًا. */
async function saveStaff(next) {
  await app.updateShopSettings({ staff: next });
}

// محاولات خاطئة: بعد 5 ينتظر الجهاز 30 ثانية (تتضاعف)
let wrong = 0;
let waitUntil = 0;

/** لوحة أرقام الرمز. onDone(pin) ← true إن قُبل. */
function pinPad({ title, sub = null, onDone }) {
  let pin = '';
  const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
  const msg = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const paint = () => fill(dots, ...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('span', { class: i < pin.length ? 'on' : '' })));
  async function submit() {
    if (Date.now() < waitUntil) { msg.textContent = `انتظر ${Math.ceil((waitUntil - Date.now()) / 1000)} ثانية`; msg.hidden = false; return; }
    if (pin.length < 4) return;
    const ok = await onDone(pin);
    if (ok) { wrong = 0; return; }
    wrong++;
    if (wrong >= 5) waitUntil = Date.now() + 30000 * 2 ** Math.min(4, wrong - 5);
    feedback.error();
    msg.textContent = wrong >= 5 ? 'محاولات كثيرة — انتظر قليلًا' : 'الرمز غير صحيح';
    msg.hidden = false;
    pin = ''; paint();
  }
  const key = (d) => h('button', { class: 'pin-key', type: 'button', onclick: () => { if (pin.length < PIN_MAX) { pin += d; feedback.tap(); paint(); msg.hidden = true; } } }, d);
  const pad = h('div', { class: 'pin-pad' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key),
    h('button', { class: 'pin-key pin-del', type: 'button', 'aria-label': 'امسح', onclick: () => { pin = pin.slice(0, -1); paint(); } }, '⌫'),
    key('0'),
    h('button', { class: 'pin-key pin-ok', type: 'button', 'aria-label': 'دخول', onclick: submit }, icon('check', 24)));
  const onKey = (e) => {
    if (/^[0-9]$/.test(e.key) && pin.length < PIN_MAX) { pin += e.key; paint(); msg.hidden = true; }
    else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); }
    else if (e.key === 'Enter') submit();
  };
  paint();
  const el = h('div', { class: 'pin-box' }, h('h2', null, title), sub ? h('p', { class: 'muted' }, sub) : null, dots, msg, pad);
  return { el, onKey };
}

// ---------- شاشة القفل ----------
export function renderLock(el) {
  const st = app.staff;
  if (!st) { navigate('/', { replace: true }); return undefined; }
  const box = h('div', { class: 'setup-body' });
  let off = null;
  el.append(h('div', { class: 'setup lock' },
    h('div', { class: 'setup-hero' }, h('div', { class: 'setup-help' }, helpButton({ dark: true, topic: 'lock' })), logo(56), h('h1', null, app.shop?.name || 'دفترة كاشير'), h('p', null, 'من يستعمل الجهاز الآن؟')),
    box));

  function choose() {
    if (off) { off(); off = null; }
    fill(box, h('div', { class: 'people' }, ...people(st).map((p) => h('button', { class: 'person', type: 'button', onclick: () => ask(p) },
      h('span', { class: `person-av ${p.owner ? 'owner' : ''}` }, p.name.trim().charAt(0) || '؟'),
      h('span', { class: 'person-name' }, p.name), h('span', { class: 'person-role' }, roleName(p))))));
  }

  function ask(p) {
    const pad = pinPad({
      title: p.name, sub: 'اكتب رمزك',
      onDone: async (pin) => {
        const rec = p.owner ? st.owner?.pin : p.pin;
        if (!checkPin(pin, rec)) return false;
        await app.setUser(p.id);
        feedback.ok();
        navigate('/', { replace: true });
        toast(`أهلًا ${p.name} 👋`, { kind: 'ok' });
        return true;
      },
    });
    document.addEventListener('keydown', pad.onKey);
    off = () => document.removeEventListener('keydown', pad.onKey);
    fill(box, pad.el,
      h('button', { class: 'btn btn-text', type: 'button', onclick: choose }, icon('back', 18), 'شخص آخر'),
      p.owner ? h('button', { class: 'btn btn-text', type: 'button', onclick: () => forgotOwner() }, 'نسيت رمزي') : null);
  }

  choose();
  return () => { if (off) off(); };
}

// صاحب المحل نسي رمزه: كلمة سر الحساب (رقم الجوال) تفتح الجهاز
async function forgotOwner() {
  const phone = await app.account.phone();
  if (!phone) {
    openSheet(h('div', null, h('p', null, 'لا حساب لهذا المحل بعد، فلا نستطيع التحقق منك. راسل MakeFlow من «المساعدة» لفتح الجهاز.')), { title: 'نسيت الرمز' });
    return;
  }
  const pw = input({ type: 'password', dir: 'ltr', autocomplete: 'current-password', placeholder: 'كلمة سر الحساب' });
  openSheet((close) => h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await app.account.login(phone, pw.value);
        if (r.shopId !== app.ctx.shopId) throw new Error('هذا حساب محل آخر');
        await app.setUser('owner');
        close(); feedback.ok();
        navigate('/settings/staff', { replace: true });
        toast('دخلت كصاحب المحل — غيّر رمزك الآن', { kind: 'ok', ms: 4500 });
      } catch (err) { feedback.error(); toast(err.message || 'كلمة السر غير صحيحة', { kind: 'error' }); }
    },
  }, h('p', { class: 'muted' }, 'اكتب كلمة سر حسابك (التي تدخل بها من جهاز جديد). تحتاج إنترنت.'), field('كلمة السر', pw),
    button('ادخل', { type: 'submit', block: true, size: 'lg', icon: 'lock' })), { title: 'نسيت الرمز' });
  setTimeout(() => pw.focus(), 150);
}

/** «قفل / تبديل المستخدم»: يرجع لشاشة «من أنت؟». */
export async function lockNow() {
  await app.setUser(null);
  navigate('/lock', { replace: true });
}

// ---------- إدارة الموظفين ----------
export function renderStaff(el) {
  const body = h('div');
  el.append(header('الموظفون', { back: true }), h('div', { class: 'page' }, body));

  function paint() {
    const st = app.shop?.settings?.staff;
    if (!st || !st.enabled) {
      fill(body,
        h('div', { class: 'acc-card acc-info' }, h('span', { class: 'acc-ic' }, icon('users', 30)),
          h('div', null, h('strong', null, 'عندك عامل في المحل؟'),
            h('span', null, 'كل شخص يدخل برمز من 4 أرقام. الكاشير يبيع فقط ولا يرى الأرباح ولا يحذف — وأنت تعرف من باع ماذا في التقارير وتقرير اليوم.'))),
        h('ul', { class: 'feature-list' },
          h('li', null, 'تحدد لكل موظف ما يستطيعه: خصم، آجل، مرتجع، أصناف، صندوق…'),
          h('li', null, 'كل فاتورة تحمل اسم من باعها'),
          h('li', null, 'زر «قفل» يرجع الجهاز لشاشة الرمز')),
        button('فعّل الموظفين', { block: true, size: 'lg', icon: 'lock', onclick: enable }));
      return;
    }
    const members = st.members || [];
    fill(body,
      h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'صاحب المحل'),
        h('div', { class: 'list' }, h('button', { class: 'row row-tap', type: 'button', onclick: editOwner },
          h('span', { class: 'person-av sm owner' }, (st.owner?.name || 'ص').charAt(0)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, st.owner?.name || 'صاحب المحل'), h('span', { class: 'row-sub' }, 'كل الصلاحيات · غيّر الاسم أو الرمز')),
          icon('chevron', 20)))),
      h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'الموظفون'),
        members.length ? h('div', { class: 'list' }, ...members.map((m) => h('button', { class: `row row-tap ${m.active === false ? 'muted' : ''}`, type: 'button', onclick: () => editMember(m) },
          h('span', { class: 'person-av sm' }, m.name.charAt(0)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, m.name),
            h('span', { class: 'row-sub' }, m.active === false ? 'موقوف' : `${roleName(m)} · ${m.perms.length ? `${m.perms.length} صلاحية` : 'يبيع فقط'}`)),
          icon('chevron', 20))))
          : emptyState('users', 'لا موظفين بعد', 'أضف أول موظف واختر ما يستطيعه.'),
        button('موظف جديد', { block: true, icon: 'plus', onclick: () => editMember(null) })),
      button('أوقف نظام الموظفين', { kind: 'text', block: true, onclick: disable }));
  }

  function enable() {
    const name = input({ value: 'صاحب المحل', maxlength: 30 });
    const pin = input({ type: 'password', inputmode: 'numeric', dir: 'ltr', maxlength: PIN_MAX, autocomplete: 'new-password', placeholder: '••••' });
    const pin2 = input({ type: 'password', inputmode: 'numeric', dir: 'ltr', maxlength: PIN_MAX, autocomplete: 'new-password', placeholder: '••••' });
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const bad = pinProblem(pin.value, pin2.value);
        if (bad) { feedback.error(); toast(bad, { kind: 'error' }); return; }
        await saveStaff({ enabled: true, owner: { name: name.value.trim() || 'صاحب المحل', pin: makePin(pin.value, salt()) }, members: app.shop?.settings?.staff?.members || [] });
        await app.setUser('owner');
        close(); feedback.ok(); paint();
        toast('فُعّل نظام الموظفين — أضف موظفيك الآن', { kind: 'ok', ms: 4000 });
      },
    }, h('p', { class: 'muted' }, 'أولًا رمزك أنت: به تفتح كل شيء. لا تعطه لأحد.'),
      field('اسمك', name), h('div', { class: 'grid-2' }, field('رمزك (4–6 أرقام)', pin), field('أعد كتابته', pin2)),
      button('فعّل', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: 'رمز صاحب المحل' });
    setTimeout(() => pin.focus(), 150);
  }

  function editOwner() {
    const st = app.shop.settings.staff;
    const name = input({ value: st.owner?.name || 'صاحب المحل', maxlength: 30 });
    const pin = input({ type: 'password', inputmode: 'numeric', dir: 'ltr', maxlength: PIN_MAX, autocomplete: 'new-password', placeholder: 'اتركه فارغًا لإبقاء الرمز' });
    const pin2 = input({ type: 'password', inputmode: 'numeric', dir: 'ltr', maxlength: PIN_MAX, autocomplete: 'new-password' });
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        let p = st.owner.pin;
        if (pin.value) {
          const bad = pinProblem(pin.value, pin2.value) || (pinTaken(st, pin.value, 'owner') ? 'هذا الرمز لموظف آخر' : null);
          if (bad) { feedback.error(); toast(bad, { kind: 'error' }); return; }
          p = makePin(pin.value, salt());
        }
        await saveStaff({ ...st, owner: { name: name.value.trim() || 'صاحب المحل', pin: p } });
        await app.setUser('owner');
        close(); feedback.ok(); paint(); toast('حُفظ', { kind: 'ok' });
      },
    }, field('الاسم', name), h('div', { class: 'grid-2' }, field('رمز جديد', pin), field('أعد كتابته', pin2)),
      button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' })), { title: 'صاحب المحل' });
  }

  function editMember(m) {
    const st = app.shop.settings.staff;
    const name = input({ value: m ? m.name : '', maxlength: 30, placeholder: 'مثال: أحمد' });
    const pin = input({ type: 'password', inputmode: 'numeric', dir: 'ltr', maxlength: PIN_MAX, autocomplete: 'new-password', placeholder: m ? 'اتركه فارغًا لإبقائه' : '••••' });
    const pin2 = input({ type: 'password', inputmode: 'numeric', dir: 'ltr', maxlength: PIN_MAX, autocomplete: 'new-password' });
    let role = m ? m.role : 'cashier';
    let perms = new Set(m ? m.perms : ROLES.cashier.perms);
    const roles = h('div', { class: 'chips' });
    const switches = h('div', { class: 'list' });
    function paintPerms() {
      fill(roles, ...Object.entries(ROLES).map(([k, r]) => h('button', {
        class: `chip ${role === k ? 'on' : ''}`, type: 'button',
        onclick: () => { role = k; perms = new Set(r.perms); paintPerms(); },
      }, r.name)));
      fill(switches, ...PERMISSIONS.map((p) => switchRow({
        title: p.label, sub: p.hint, checked: perms.has(p.key),
        onchange: (on) => {
          if (on) perms.add(p.key); else perms.delete(p.key);
          const match = Object.entries(ROLES).find(([, r]) => r.perms.length === perms.size && r.perms.every((x) => perms.has(x)));
          role = match ? match[0] : 'custom';
          paintPerms();
        },
      })));
    }
    paintPerms();
    openSheet((close) => h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const n = name.value.trim();
        if (!n) { feedback.error(); toast('اكتب اسم الموظف', { kind: 'error' }); return; }
        let p = m ? m.pin : null;
        if (pin.value || !m) {
          const bad = pinProblem(pin.value, pin2.value) || (pinTaken(st, pin.value, m ? m.id : null) ? 'هذا الرمز لشخص آخر — اختر غيره' : null);
          if (bad) { feedback.error(); toast(bad, { kind: 'error' }); return; }
          p = makePin(pin.value, salt());
        }
        const rec = { id: m ? m.id : uuid(), name: n, role, perms: PERMISSIONS.map((x) => x.key).filter((k) => perms.has(k)), pin: p, active: true };
        const list = (st.members || []).filter((x) => x.id !== rec.id);
        await saveStaff({ ...st, members: [...list, rec] });
        close(); feedback.ok(); paint();
        toast(m ? 'حُفظ' : `أُضيف ${n} — يدخل برمزه من شاشة القفل`, { kind: 'ok', ms: 3500 });
      },
    },
      field('الاسم', name),
      h('div', { class: 'grid-2' }, field(m ? 'رمز جديد' : 'رمزه (4–6 أرقام)', pin), field('أعد كتابته', pin2)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'الدور'), roles),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'ما يستطيعه (البيع مسموح دائمًا)'), switches),
      button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
      m ? button(m.active === false ? 'أعد تفعيله' : 'أوقف هذا الموظف', {
        kind: 'text', block: true,
        onclick: async () => {
          await saveStaff({ ...st, members: (st.members || []).map((x) => (x.id === m.id ? { ...x, active: x.active === false } : x)) });
          close(); paint();
          toast(m.active === false ? `${m.name} يعمل من جديد` : `أُوقف ${m.name} — لا يستطيع الدخول، وفواتيره باقية باسمه`, { kind: 'ok', ms: 3500 });
        },
      }) : null,
    ), { title: m ? m.name : 'موظف جديد' });
    setTimeout(() => { if (!m) name.focus(); }, 150);
  }

  function disable() {
    const st = app.shop.settings.staff;
    const pad = pinPad({
      title: 'رمز صاحب المحل', sub: 'لإيقاف نظام الموظفين',
      onDone: async (pin) => {
        if (!checkPin(pin, st.owner?.pin)) return false;
        await saveStaff({ ...st, enabled: false });
        await app.setUser(null);
        document.removeEventListener('keydown', pad.onKey);
        sheet.close(); paint();
        toast('أُوقف نظام الموظفين — الموظفون محفوظون إن فعّلته لاحقًا', { kind: 'ok', ms: 4000 });
        return true;
      },
    });
    document.addEventListener('keydown', pad.onKey);
    const sheet = openSheet(pad.el, { title: 'إيقاف نظام الموظفين', onClose: () => document.removeEventListener('keydown', pad.onKey) });
  }

  paint();
}

/** شارة صغيرة باسم من دخل + زر القفل (للرئيسية). */
export function userChip() {
  if (!app.staff || !app.user) return null;
  return h('button', { class: 'user-chip', type: 'button', 'aria-label': 'قفل وتبديل المستخدم', onclick: lockNow },
    h('span', { class: `person-av xs ${app.user.owner ? 'owner' : ''}` }, app.user.name.charAt(0)),
    h('span', null, app.user.name), icon('lock', 16));
}

