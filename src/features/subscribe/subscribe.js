// «الاشتراك»: حالة الترخيص، السعران، وطريقة التفعيل.
//   نسخة direct: اطلب على واتساب (الرسالة تحمل رقم الجهاز) ثم الصق كود التفعيل الذي يصلك.
//   نسخة play:   اشترك من Google Play بضغطة.
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { subscribeMessage, PLAN_LABEL } from '../../domain/license.js';
import { openLink } from '../customers/customers.js';
import { SUPPORT_PHONE } from '../help/feedback.js';

const dateText = (t) => new Date(t).toLocaleDateString('en-GB');

/** نص الحالة (نقي، للاختبار وللافتة الرئيسية). */
export function statusText(s) {
  if (s.status === 'blocked') return { tone: 'bad', title: 'الاشتراك موقوف', sub: 'تواصل مع MakeFlow لإعادة التفعيل' };
  if (s.status === 'expired') return { tone: 'bad', title: 'انتهت المدة — قراءة فقط', sub: 'بياناتك محفوظة. اشترك لتكمل البيع' };
  if (s.status === 'grace') return { tone: 'warn', title: 'انتهى اشتراكك', sub: `جدّد خلال ${s.daysLeft} يوم حتى لا يتوقف البيع` };
  if (s.status === 'active') return { tone: 'ok', title: `اشتراك ${PLAN_LABEL[s.plan] || ''} فعّال`.replace('  ', ' '), sub: s.until ? `حتى ${dateText(s.until)} — باقي ${s.daysLeft} يوم` : '' };
  return { tone: s.daysLeft <= 7 ? 'warn' : 'info', title: 'تجربة مجانية', sub: `باقي ${s.daysLeft} يوم — كل الميزات مفتوحة` };
}

/** لافتة صغيرة للرئيسية؛ لا تظهر والاشتراك فعّال وبعيد الانتهاء. */
export function licenseBanner() {
  const s = app.license.state;
  if (s.status === 'active' && s.daysLeft > 7) return null;
  const t = statusText(s);
  return h('button', { class: `lic-banner lic-${t.tone}`, type: 'button', onclick: () => navigate('/subscribe') },
    icon(s.readOnly ? 'alert' : 'star', 26),
    h('span', { class: 'row-main' }, h('strong', null, t.title), h('span', null, t.sub)),
    h('span', { class: 'lic-cta' }, s.status === 'active' ? 'جدّد' : 'اشترك'));
}

export function renderSubscribe(el) {
  const lic = app.license;
  const statusBox = h('div');
  const body = h('div');
  const isPlay = lic.hasBilling;
  let plan = 'yearly';
  let prices = { monthly: '30 ₪', yearly: '300 ₪' };

  function paintStatus() {
    const t = statusText(lic.compute());
    fill(statusBox, h('div', { class: `lic-status lic-${t.tone}` },
      h('span', { class: 'lic-status-ic' }, icon(t.tone === 'ok' ? 'check' : t.tone === 'bad' ? 'alert' : 'star', 30)),
      h('div', null, h('strong', null, t.title), h('span', null, t.sub))));
  }

  function planCard(key, title, price, per, note) {
    return h('button', { class: `plan ${plan === key ? 'on' : ''}`, type: 'button', onclick: () => { plan = key; feedback.tap(); paint(); } },
      note ? h('span', { class: 'plan-note' }, note) : null,
      h('span', { class: 'plan-title' }, title),
      h('span', { class: 'plan-price num' }, price),
      h('span', { class: 'plan-per' }, per));
  }

  async function activate(input) {
    const text = input.value.trim();
    if (!text) { feedback.error(); toast('الصق كود التفعيل أولًا', { kind: 'error' }); input.focus(); return; }
    let r;
    try { r = await lic.redeem(text); } catch { r = { ok: false, reason: 'تعذّر التحقق — أعد المحاولة' }; }
    if (!r.ok) { feedback.error(); toast(r.reason, { kind: 'error' }); return; }
    feedback.success();
    toast('تم التفعيل ✓ شكرًا لاشتراكك', { kind: 'ok', ms: 4000 });
    app.sync.run();
    paint();
  }

  async function buy() {
    const r = await lic.buyPlay(plan);
    if (r && r.ok && r.active) { feedback.success(); toast('تم الاشتراك ✓', { kind: 'ok' }); app.sync.run(); paint(); }
    else if (r && r.pending) toast('الدفع قيد المعالجة — سيُفعَّل تلقائيًا عند اكتماله', { ms: 5000 });
    else if (!r || !r.cancelled) { feedback.error(); toast('تعذّر فتح الدفع من Google Play', { kind: 'error' }); }
  }

  async function checkNow() {
    if (isPlay) await lic.refreshPlay();
    if (app.config.syncEnabled) await app.sync.run();
    paint();
    toast(lic.state.readOnly ? 'لا يوجد اشتراك فعّال بعد' : 'تم التحديث ✓', { kind: lic.state.readOnly ? 'info' : 'ok' });
  }

  function paint() {
    paintStatus();
    const codeIn = h('textarea', { class: 'input textarea', rows: 3, dir: 'ltr', placeholder: 'DCS-…', autocapitalize: 'off', spellcheck: 'false' });
    const copyDevice = () => {
      try { navigator.clipboard.writeText(lic.device); toast('نُسخ رقم الجهاز', { kind: 'ok' }); } catch { toast(lic.device); }
    };
    fill(body,
      h('h2', { class: 'section-title' }, 'اختر اشتراكك'),
      h('div', { class: 'plans' },
        planCard('yearly', 'سنوي', prices.yearly, 'في السنة', 'وفّر شهرين'),
        planCard('monthly', 'شهري', prices.monthly, 'في الشهر', null)),
      isPlay
        ? h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', onclick: buy }, icon('check', 22), h('span', null, 'اشترك عبر Google Play'))
        : h('button', {
          class: 'btn btn-wa btn-block btn-lg', type: 'button',
          onclick: () => openLink(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(subscribeMessage({ shopName: app.shop?.name || '', device: lic.device, plan, shopId: app.config.syncEnabled ? app.ctx.shopId : null, until: ['active', 'grace'].includes(lic.state.status) ? lic.state.until : null }))}`),
        }, icon('chat', 22), h('span', null, 'اشترك عبر واتساب')),
      isPlay ? null : h('div', { class: 'lic-steps' },
        h('div', null, h('b', { class: 'num' }, '1'), 'اضغط «اشترك عبر واتساب» وأرسل الرسالة كما هي'),
        h('div', null, h('b', { class: 'num' }, '2'), 'ادفع بالطريقة التي نتفق عليها'),
        h('div', null, h('b', { class: 'num' }, '3'), 'يصلك كود التفعيل — الصقه هنا')),
      isPlay ? null : h('h2', { class: 'section-title' }, 'عندي كود تفعيل'),
      isPlay ? null : h('div', { class: 'card lic-code' }, codeIn,
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => activate(codeIn) }, 'فعّل')),
      h('button', { class: 'lic-device', type: 'button', onclick: copyDevice },
        h('span', null, 'رقم هذا الجهاز'), h('strong', { class: 'num', dir: 'ltr' }, lic.device), icon('copy', 20)),
      h('button', { class: 'btn lic-check btn-block', type: 'button', onclick: checkNow }, 'اشتركت من قبل؟ تحقّق الآن'),
      h('p', { class: 'muted lic-foot' }, 'بعد انتهاء المدة يبقى كل شيء للقراءة: الأصناف، الفواتير، التقارير، كشوف الزبائن، وتسجيل دفعات الديون والنسخة الاحتياطية. البيع والشراء وتعديل الأصناف تعود فور الاشتراك.'),
    );
  }

  el.append(header('الاشتراك', { back: true }), h('div', { class: 'page' }, statusBox, body));
  paint();
  if (isPlay) lic.refreshPlay().then((r) => { if (r && r.prices) { prices = { monthly: r.prices.monthly || prices.monthly, yearly: r.prices.yearly || prices.yearly }; } paint(); });
  return app.bus.on('license', paintStatus);
}
