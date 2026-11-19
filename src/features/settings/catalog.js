// كتالوج المحل على واتساب: صاحب المحل يشغّله فيحصل على رابط يرسله لزبائنه أو يضعه في حالة واتساب.
// الزبون يفتح الرابط، يختار الأصناف، فتصل رسالة الطلب جاهزة إلى واتساب المحل (shop.html على makeflow.tech).
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, field, switchRow } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { normalizePhone, whatsappLink } from '../../domain/ledger.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { openLink } from '../customers/customers.js';

export const CATALOG_BASE = 'https://makeflow.tech/apps/cashier/app/shop.html';
export const catalogUrl = (shopId) => `${CATALOG_BASE}?s=${shopId}`;
const cfgOf = () => ({ enabled: false, hideOutOfStock: false, message: '', ...(app.shop?.settings?.catalog || {}) });

export function renderCatalog(el) {
  const body = h('div');
  el.append(header('كتالوج واتساب', { back: true }), h('div', { class: 'page' }, body));

  async function save(patch) {
    await app.updateShopSettings({ catalog: { ...cfgOf(), ...patch } });
    app.sync.run().catch(() => {}); // يصل الخادم فيظهر في الرابط
  }

  function paint() {
    const c = cfgOf();
    const url = catalogUrl(app.shop.id);
    const phone = normalizePhone(app.shop.phone || '');
    if (!app.config.syncEnabled) {
      fill(body, h('div', { class: 'acc-card acc-warn' }, icon('alert', 28), h('div', null, h('strong', null, 'غير متاح في هذه النسخة'), h('span', null, 'الكتالوج يحتاج النسخة المتصلة بالخادم.'))));
      return;
    }
    const msg = input({ value: c.message || '', maxlength: 140, placeholder: 'مثال: التوصيل مجاني داخل البلدة فوق 50 ₪' });
    msg.addEventListener('change', () => save({ message: msg.value.trim() }));
    fill(body,
      h('div', { class: 'acc-card acc-info' }, h('span', { class: 'acc-ic' }, icon('store', 30)),
        h('div', null, h('strong', null, 'محلك على جوال كل زبون'),
          h('span', null, 'رابط فيه أصنافك وأسعارك. الزبون يختار ويضغط «اطلب عبر واتساب» فتصلك رسالة الطلب جاهزة. لا تكلفة ولا كميات تظهر للزبون.'))),
      h('div', { class: 'list section' },
        switchRow({ title: 'الكتالوج شغّال', sub: c.enabled ? 'الرابط يعمل الآن' : 'مطفأ — الرابط لا يعرض شيئًا', checked: c.enabled, onchange: async (on) => { await save({ enabled: on }); paint(); } }),
        switchRow({ title: 'أخفِ الأصناف النافدة', sub: 'وإلا تظهر «غير متوفر الآن»', checked: !!c.hideOutOfStock, onchange: (on) => save({ hideOutOfStock: on }) })),
      field('رسالة ترحيب أعلى الكتالوج', msg),
      !phone ? h('div', { class: 'acc-card acc-warn' }, icon('alert', 26), h('div', null, h('strong', null, 'أضف رقم جوال المحل'),
        h('span', null, 'الطلبات تصل إلى هذا الرقم على واتساب. '), h('button', { class: 'link-btn', type: 'button', onclick: () => navigate('/settings/shop') }, 'أضفه الآن'))) : null,
      c.enabled ? h('div', { class: 'section' },
        h('div', { class: 'catalog-link num' }, url),
        h('div', { class: 'product-actions' },
          button('أرسله على واتساب', { icon: 'receipt', onclick: () => openLink(whatsappLink('', `تصفّح أصناف ${app.shop.name} وأسعارها واطلب مباشرة على واتساب 👇\n${url}`)) }),
          button('انسخ الرابط', { kind: 'outline', icon: 'copy', onclick: copy })),
        button('افتح الكتالوج كما يراه الزبون', { kind: 'text', block: true, onclick: () => openLink(url) }),
        h('p', { class: 'muted small' }, 'ضعه في حالة واتساب، أو في وصف حساب واتساب للأعمال، أو اطبعه على الفاتورة. الأسعار تتحدّث وحدها حين تغيّرها في التطبيق.')) : null);
  }

  async function copy() {
    const url = catalogUrl(app.shop.id);
    try { await navigator.clipboard.writeText(url); feedback.ok(); toast('نُسخ الرابط', { kind: 'ok' }); }
    catch { toast(url, { ms: 8000 }); }
  }
  paint();
}
