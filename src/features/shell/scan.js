// القارئ الخارجي (USB أو بلوتوث) في أي شاشة لا تتعامل مع الباركود بنفسها: بطاقة سريعة للصنف —
// سعره والموجود منه — مع «بِعه الآن» و«افتح بطاقته». والباركود غير المسجّل يُضاف صنفًا جديدًا بضغطة.
import { h, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, money } from '../../ui/components.js';
import { openSheet, toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { normalizeBarcode } from '../../domain/product.js';
import { formatQty, unit } from '../../domain/units.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';

export async function handleGlobalScan(raw) {
  if (!app.ctx.shopId || app.locked || app.account?.required) return;
  const code = normalizeBarcode(raw);
  const hit = await app.products.resolveScan(code, app.shop?.settings?.scale);
  const sell = () => navigate(`/sale?scan=${encodeURIComponent(code)}`);
  if (hit && hit.scale) { sell(); return; } // ملصق ميزان: مكانه شاشة البيع
  if (!hit || !hit.product) {
    feedback.error();
    if (!app.can('products')) { toast('باركود غير مسجّل — اطلب من صاحب المحل إضافته', { kind: 'error' }); return; }
    openSheet((close) => h('div', null,
      h('p', { class: 'muted' }, 'هذا الباركود ليس لأي صنف عندك: ', num(code)),
      button('أضفه صنفًا جديدًا', { block: true, size: 'lg', icon: 'plus', onclick: () => { close(); navigate(`/products/edit?barcode=${encodeURIComponent(code)}`); } })),
    { title: 'باركود غير مسجّل' });
    return;
  }
  feedback.ok();
  const p = await app.products.get(hit.product.id);
  const u = unit(p.unit);
  const readOnly = app.license.compute().readOnly;
  openSheet((close) => h('div', { class: 'scan-card' },
    h('div', { class: 'scan-card-kv' },
      h('div', null, h('span', { class: 'muted small' }, hit.pack ? `سعر ${hit.pack.name}` : 'سعر البيع'),
        h('strong', null, money(hit.pack && Number.isSafeInteger(hit.pack.sell_price) ? hit.pack.sell_price : p.sell_price, p.currency))),
      h('div', null, h('span', { class: 'muted small' }, 'الموجود في المحل'), h('strong', null, num(formatQty(p.qty)), ` ${u.short}`)),
      h('div', null, h('span', { class: 'muted small' }, 'الباركود'), h('strong', { class: 'num' }, code))),
    readOnly ? null : h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', onclick: () => { close(); sell(); } }, icon('scan', 22), h('span', null, 'بِعه الآن')),
    app.can('products') ? button('افتح بطاقة الصنف', { kind: 'outline', block: true, icon: 'edit', onclick: () => { close(); navigate(`/products/edit?id=${p.id}`); } }) : null,
  ), { title: p.name });
}
