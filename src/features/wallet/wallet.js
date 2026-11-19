// الاستلام بالمحفظة برمز QR: صاحب المحل يكتب المبلغ ويعرض الرمز، والزبون يمسحه بكاميرا جواله فيفتح عنده
// تطبيق الاتصال وكود التحويل جاهز. التطبيق يعرض الرمز فقط: لا كاميرا ولا إنترنت ولا صلاحية SMS،
// والتأكد من وصول المبلغ يدوي ثم «سجّل الدفعة». مع ?customer= تُسجَّل الدفعة على حساب ذلك الزبون.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, input, button, field, emptyState, iconButton } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { shopWallets, walletAmount, ussdCode, telUri, normalizeWalletNumber, WALLETS } from '../../domain/wallet.js';
import { parseMoney, formatMoney } from '../../domain/currency.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';

const LAST = 'cashier-wallet-last';

// مكتبة الرمز مضمَّنة في التطبيق (vendor/qrcode.js) وتُحمَّل عند أول استعمال — تعمل بلا إنترنت
function loadQr() {
  return new Promise((resolve, reject) => {
    if (globalThis.qrcode) { resolve(globalThis.qrcode); return; }
    const s = document.createElement('script');
    s.src = 'vendor/qrcode.js'; s.onload = () => resolve(globalThis.qrcode); s.onerror = reject;
    document.head.append(s);
  });
}

/** رمز QR بصيغة SVG: مربعات سوداء على أبيض، مستوى تصحيح الخطأ M، وهامش هادئ 4 خانات. */
export function qrSvg(make, text) {
  const qr = make(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const size = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="رمز QR للدفع"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export async function renderWallet(el, params) {
  const base = app.shop?.base_currency || 'ILS';
  const wallets = shopWallets(app.shop?.settings);
  const customer = params.customer ? await app.customers.get(params.customer) : null;

  if (!wallets.length) {
    el.append(
      header('استلام بالمحفظة', { back: true }),
      h('div', { class: 'page' },
        emptyState('wallet', 'اكتب رقم محفظتك أولًا', 'رقم محفظة جوال باي أو بال باي الذي يستلم عليه المحل، ثم يظهر رمز QR ليمسحه الزبون.',
          button('أرقام المحافظ', { icon: 'wallet', onclick: () => navigate('/settings/wallets') }))),
    );
    return undefined;
  }

  let saved = null;
  try { saved = localStorage.getItem(LAST); } catch { /* */ }
  let wallet = wallets.find((w) => w.id === saved) || wallets[0];
  const amt = input({ dir: 'ltr', inputmode: 'decimal', class: 'input input-xl', placeholder: '0', value: walletAmount(params.amount)?.text || '', 'aria-label': 'المبلغ' });
  const tabs = h('div', { class: 'chips wallet-tabs' });
  const qrBox = h('div', { class: 'wallet-qr' });
  const codeEl = h('bdo', { dir: 'ltr', class: 'wallet-code' });
  const codeWrap = h('div', { class: 'wallet-manual', hidden: true }, h('span', { class: 'muted small' }, 'أو يكتب الزبون الكود في لوحة الاتصال:'), codeEl);
  const target = h('div', { class: 'wallet-target muted' });
  const saveBtn = button('سجّل الدفعة', { block: true, size: 'lg', icon: 'check', onclick: record });
  let make = null;
  let alive = true;

  function paintTabs() {
    tabs.hidden = wallets.length < 2;
    fill(tabs, ...wallets.map((w) => h('button', {
      class: `chip ${wallet === w ? 'on' : ''}`, type: 'button',
      onclick: () => { wallet = w; try { localStorage.setItem(LAST, w.id); } catch { /* */ } paintTabs(); paint(); },
    }, w.name)));
  }

  function paint() {
    const a = walletAmount(amt.value);
    const code = a ? ussdCode(wallet.id, wallet.number, a.cents) : null;
    fill(target, `إلى محفظة ${wallet.name} `, h('bdo', { dir: 'ltr', class: 'num' }, wallet.number));
    saveBtn.disabled = !code;
    codeWrap.hidden = !code;
    if (!code) {
      delete qrBox.dataset.uri;
      // لا رمز بلا مبلغ: رمز بمبلغ صفر أو فارغ يحوّل لا شيء أو يُرفض
      qrBox.classList.add('empty');
      fill(qrBox, icon('wallet', 44), h('span', null, amt.value.trim() ? 'المبلغ غير صحيح' : 'اكتب المبلغ ليظهر الرمز'));
      return;
    }
    codeEl.textContent = code;
    qrBox.dataset.uri = telUri(code);
    if (!make) { qrBox.classList.add('empty'); fill(qrBox, h('span', null, 'لحظة…')); return; }
    qrBox.classList.remove('empty');
    qrBox.innerHTML = qrSvg(make, telUri(code));
  }

  let busy = false;
  async function record() {
    if (busy) return;
    const a = walletAmount(amt.value);
    const v = a ? parseMoney(a.text, base) : null;
    if (!v) { feedback.error(); toast('اكتب المبلغ', { kind: 'error' }); amt.focus(); return; }
    busy = true;
    try {
      await app.wallet.receive({ walletId: wallet.id, amount: v, customerId: customer?.id || null });
      feedback.ok();
      if (customer) {
        app.sms.notify('payment', customer, v);
        const left = Math.max(0, await app.customers.balance(customer.id));
        toast(`استُلمت ${formatMoney(v, base)} بـ${wallet.name} — الباقي عليه ${formatMoney(left, base)}`, { kind: 'ok', ms: 3500 });
        history.back();
        return;
      }
      toast(`سُجّل استلام ${formatMoney(v, base)} بـ${wallet.name}`, { kind: 'ok', ms: 3500 });
      amt.value = '';
      paint();
    } catch (err) {
      feedback.error();
      toast(err.errors?.amount || 'تعذّر الحفظ', { kind: 'error' });
    } finally { busy = false; }
  }

  amt.addEventListener('input', paint);
  el.append(
    header('استلام بالمحفظة', { back: true, sub: customer ? `دفعة من ${customer.name}` : null, actions: [iconButton('sliders', 'أرقام المحافظ', () => navigate('/settings/wallets'))] }),
    h('div', { class: 'page wallet-page' },
      field('المبلغ', amt),
      tabs,
      h('div', { class: 'wallet-card' }, qrBox, target, codeWrap),
      h('ol', { class: 'wallet-steps' },
        h('li', null, 'امسح الرمز بكاميرا جوالك'),
        h('li', null, 'اضغط «اتصال»'),
        h('li', null, 'أكّد برقمك السري')),
      h('p', { class: 'muted small' }, customer ? `بعد أن يصلك إشعار المحفظة بوصول المبلغ اضغط «سجّل الدفعة» فتُخصم من حساب ${customer.name}.` : 'بعد أن يصلك إشعار المحفظة بوصول المبلغ اضغط «سجّل الدفعة».'),
      h('div', { class: 'sticky-save' }, saveBtn),
    ),
  );
  paintTabs();
  paint();
  loadQr().then((m) => { make = m; if (alive) paint(); }).catch(() => { if (alive) { qrBox.classList.add('empty'); fill(qrBox, h('span', null, 'تعذّر رسم الرمز — ليكتب الزبون الكود أدناه')); } });
  if (!amt.value) setTimeout(() => amt.focus(), 120);
  return () => { alive = false; };
}

/** الإعدادات ← أرقام المحافظ: خانتان اختياريتان، تُقبل أي صيغة وتُوحَّد إلى 05XXXXXXXX. */
export function renderWalletSettings(el) {
  const saved = app.shop?.settings?.wallets || {};
  const inputs = {};
  const errs = {};
  for (const w of Object.values(WALLETS)) {
    inputs[w.id] = input({ value: saved[w.id] || '', type: 'tel', inputmode: 'tel', dir: 'ltr', maxlength: 24, placeholder: '05XXXXXXXX' });
    errs[w.id] = h('span', { class: 'field-error', role: 'alert', hidden: true });
  }
  async function save(e) {
    e.preventDefault();
    const next = {};
    let bad = null;
    for (const w of Object.values(WALLETS)) {
      const raw = inputs[w.id].value.trim();
      const n = raw ? normalizeWalletNumber(raw) : null;
      const wrong = !!raw && !n;
      errs[w.id].hidden = !wrong;
      errs[w.id].textContent = wrong ? `رقم محفظة ${w.name} غير صحيح — اكتبه مثل 0599123456 (10 أرقام تبدأ بـ 05)` : '';
      if (wrong && !bad) bad = w.id;
      next[w.id] = n;
    }
    if (bad) { feedback.error(); toast(errs[bad].textContent, { kind: 'error', ms: 4000 }); inputs[bad].focus(); return; }
    await app.updateShopSettings({ wallets: next });
    feedback.ok();
    toast('حُفظت أرقام المحافظ', { kind: 'ok' });
    history.back();
  }
  el.append(
    header('الاستلام بالمحفظة (QR)', { back: true }),
    h('form', { class: 'page', onsubmit: save },
      h('p', { class: 'muted' }, 'اكتب رقم المحفظة التي يستلم عليها المحل. يعرض التطبيق رمز QR يمسحه الزبون بكاميرا جواله، فيُفتح عنده كود التحويل جاهزًا بالمبلغ. اترك الخانة فارغة إن لم تكن عندك هذه المحفظة.'),
      ...Object.values(WALLETS).map((w) => h('div', null, field(`رقم محفظة ${w.name}`, inputs[w.id], 'اختياري'), errs[w.id])),
      button('حفظ', { type: 'submit', block: true, size: 'lg', icon: 'check' }),
    ),
  );
}
