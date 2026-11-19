// المساعد: يقرأ سرعة بيع كل صنف (آخر 30 يومًا) فيقول متى يخلص وكم تطلب، ويكشف البضاعة الراكدة
// والمال المحبوس فيها مع زر «اعمل عرض» لتصريفها. كله على الجهاز، بلا إنترنت ولا ذكاء اصطناعي.
import { h, fill, num } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, emptyState, button, money } from '../../ui/components.js';
import { daysLeftText, COVER_DAYS } from '../../domain/inventory.js';
import { formatQty, unit as unitOf } from '../../domain/units.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { productThumb } from '../products/thumb.js';
import { openReorder } from './hub.js';

const perDayText = (milli, u) => {
  const d = milli / 1000;
  const v = d >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
  return `تبيع نحو ${v} ${unitOf(u).short} يوميًا`;
};

export async function renderAssistant(el) {
  const body = h('div');
  el.append(header('المساعد', { back: true }), h('div', { class: 'page' }, body));
  const { soon, dead } = await app.inventory.assistant();
  const deadValue = dead.reduce((a, x) => a + x.value, 0);
  fill(body,
    h('div', { class: 'section' },
      h('h2', { class: 'section-title' }, 'يخلص قريبًا'),
      soon.length ? h('p', { class: 'muted small' }, `حسب سرعة بيعك في آخر 30 يومًا. الكمية المقترحة تكفيك ${COVER_DAYS} يومًا.`) : null,
      soon.length ? button(`اطلب الكل من التاجر (${soon.length})`, { icon: 'truck', block: true, onclick: () => openReorder(soon.map((x) => ({ p: x.p, qty: x.qty }))) }) : null,
      soon.length ? h('div', { class: 'list section' }, ...soon.map((x) => h('button', { class: 'row row-tap', type: 'button', onclick: () => openReorder([{ p: x.p, qty: x.qty }]) },
        productThumb(x.p, 40),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, x.p.name),
          h('span', { class: `row-sub ${x.daysLeft <= 2 ? 'txt-danger' : 'txt-warn'}` }, daysLeftText(x.daysLeft), ' · ', perDayText(x.perDay, x.p.unit))),
        h('span', { class: 'order-pill' }, h('small', null, 'اطلب'), h('span', { class: 'num' }, formatQty(x.qty)))))) : emptyState('check', 'لا شيء يخلص هذا الأسبوع', 'نراقب سرعة بيع كل صنف وننبهك قبل أن يخلص.')),
    h('div', { class: 'section' },
      h('h2', { class: 'section-title' }, 'بضاعة راكدة'),
      dead.length ? h('p', { class: 'muted small' }, 'لم يُبع منها شيء منذ 60 يومًا', app.can('see_cost') ? [' — فيها ', h('b', null, money(deadValue))] : null, '. عرض صغير يحرّكها ويرجع مالك.') : null,
      dead.length ? h('div', { class: 'list section' }, ...dead.slice(0, 40).map((x) => h('div', { class: 'row' },
        productThumb(x.p, 40),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, x.p.name),
          h('span', { class: 'row-sub' }, 'عندك ', num(formatQty(x.p.qty)), ` ${unitOf(x.p.unit).short} · بلا بيع منذ ${x.days} يوم`)),
        app.can('products') ? h('button', { class: 'chip chip-action', type: 'button', onclick: () => navigate(`/offers?product=${x.p.id}`) }, icon('star', 16), 'اعمل عرض') : null))) : emptyState('check', 'لا بضاعة راكدة', 'كل أصنافك تتحرك.')),
  );
}
