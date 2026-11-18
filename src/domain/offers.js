// العروض والخصومات (نقي): تُطبَّق تلقائيًا على السلة، فلا يتذكر الكاشير شيئًا.
// العرض في settings.offers للمحل:
//   { id, type, target: { kind: 'product'|'category'|'all', id }, percent (نقاط أساس: 1000 = 10%),
//     buy, get (اشترِ buy واحصل على get مجانًا), qty, price (qty قطع بسعر price), from, to ('YYYY-MM-DD' أو null), active }
// الخصم يُكتب في خصم السطر نفسه (invoice_lines.discount) فيظهر في الفاتورة والتقارير بلا أعمدة جديدة.
// لا تراكم: لكل سطر أفضل عرض واحد. السطر الذي غيّر الكاشير سعره أو خصمه يدويًا لا تمسّه العروض.
import { percentOf, allocate } from './money.js';
import { lineAmount, QTY_SCALE } from './units.js';
import { formatMoney } from './currency.js';

export const OFFER_TYPES = Object.freeze({
  percent: { name: 'خصم بنسبة', hint: 'على صنف أو تصنيف أو كل المحل' },
  bxgy: { name: 'اشترِ واحصل مجانًا', hint: 'مثل: اشترِ 2 والثالث مجانًا' },
  bundle: { name: 'سعر للكمية', hint: 'مثل: 3 قطع بـ 10 ₪' },
});

const pct = (bp) => `${(bp / 100).toFixed(bp % 100 ? 1 : 0)}%`;

/** هل العرض فعّال في هذا اليوم ('YYYY-MM-DD' بتوقيت الجهاز)؟ */
export function offerActive(o, today) {
  if (!o || o.active === false) return false;
  if (o.from && today < o.from) return false;
  if (o.to && today > o.to) return false;
  return true;
}

/** 'active' | 'scheduled' | 'ended' | 'off' */
export function offerState(o, today) {
  if (o.active === false) return 'off';
  if (o.from && today < o.from) return 'scheduled';
  if (o.to && today > o.to) return 'ended';
  return 'active';
}

/** نص العرض كما يقرؤه الزبون والكاشير. names: { product, category } */
export function offerTitle(o, names = {}, currency = 'ILS') {
  const on = o.target?.kind === 'all' ? 'كل المحل' : o.target?.kind === 'category' ? (names.category || 'التصنيف') : (names.product || 'الصنف');
  if (o.type === 'percent') return `خصم ${pct(o.percent)} على ${on}`;
  if (o.type === 'bxgy') return `${on}: اشترِ ${o.buy} واحصل على ${o.get} مجانًا`;
  if (o.type === 'bundle') return `${on}: ${o.qty} بـ ${formatMoney(o.price, currency)}`;
  return 'عرض';
}

/** اسم قصير يظهر على سطر السلة. */
export function offerBadge(o, currency = 'ILS') {
  if (o.type === 'percent') return `−${pct(o.percent)}`;
  if (o.type === 'bxgy') return `${o.buy}+${o.get}`;
  if (o.type === 'bundle') return `${o.qty} بـ ${formatMoney(o.price, currency, { symbol: false })}`;
  return 'عرض';
}

/** رسالة خطأ بالعربية أو null. */
export function offerProblem(o) {
  if (!OFFER_TYPES[o.type]) return 'اختر نوع العرض';
  const kind = o.target?.kind;
  if (!['product', 'category', 'all'].includes(kind)) return 'اختر على ماذا العرض';
  if (kind !== 'all' && !o.target.id) return kind === 'product' ? 'اختر الصنف' : 'اختر التصنيف';
  if (o.type !== 'percent' && kind !== 'product') return 'هذا النوع لصنف واحد';
  if (o.type === 'percent' && !(Number.isInteger(o.percent) && o.percent > 0 && o.percent < 10000)) return 'النسبة بين 1% و 99%';
  if (o.type === 'bxgy' && !(Number.isInteger(o.buy) && o.buy >= 1 && Number.isInteger(o.get) && o.get >= 1)) return 'اكتب كم يشتري وكم يأخذ مجانًا';
  if (o.type === 'bundle' && !(Number.isInteger(o.qty) && o.qty >= 2 && Number.isInteger(o.price) && o.price > 0)) return 'اكتب العدد (2 أو أكثر) والسعر';
  if (o.from && o.to && o.to < o.from) return 'تاريخ النهاية قبل البداية';
  return null;
}

function matches(o, line, categoryOf) {
  const t = o.target || {};
  if (t.kind === 'all') return true;
  if (t.kind === 'product') return line.product_id === t.id;
  if (t.kind === 'category') return !!line.product_id && categoryOf(line.product_id) === t.id;
  return false;
}

const free = (l) => !(l.discount > 0) && !String(l.key || '').endsWith(':custom');

/**
 * lines: سطور السلة (خصمها اليدوي في discount). يرجع { lines, saved, applied }:
 *   lines   نسخ السطور بخصم العرض مضافًا (offer_discount و offer: الشارة) — جاهزة للحساب والحفظ
 *   saved   مجموع ما وفّرته العروض
 *   applied معرّفات العروض المطبّقة
 */
export function applyOffers(lines, offers, { today, categoryOf = () => null, currency = 'ILS' } = {}) {
  const live = (offers || []).filter((o) => offerActive(o, today) && !offerProblem(o));
  const disc = lines.map(() => 0);
  const used = lines.map(() => null);
  if (!live.length) return { lines: lines.map((l) => ({ ...l })), saved: 0, applied: [] };

  // 1) النسبة: أفضل نسبة لكل سطر
  lines.forEach((l, i) => {
    if (!free(l)) return;
    const base = lineAmount(l.unit_price, l.qty);
    for (const o of live) {
      if (o.type !== 'percent' || !matches(o, l, categoryOf)) continue;
      const d = percentOf(base, o.percent);
      if (d > disc[i]) { disc[i] = d; used[i] = o; }
    }
  });

  // 2) العروض بالعدد (اشترِ واحصل، سعر للكمية): على مجموع قطع الصنف في السلة (بالوحدة الأساسية، قطع كاملة)
  const groups = new Map();
  lines.forEach((l, i) => {
    if (!free(l) || l.unit_id || !l.product_id || l.qty % QTY_SCALE !== 0) return;
    const g = groups.get(l.product_id) || [];
    g.push(i);
    groups.set(l.product_id, g);
  });
  for (const [pid, idx] of groups) {
    const units = idx.reduce((a, i) => a + lines[i].qty / QTY_SCALE, 0);
    const price = Math.min(...idx.map((i) => lines[i].unit_price));
    let best = 0, bestOffer = null;
    for (const o of live) {
      if (o.target?.kind !== 'product' || o.target.id !== pid) continue;
      let d = 0;
      if (o.type === 'bxgy') d = Math.floor(units / (o.buy + o.get)) * o.get * price;
      else if (o.type === 'bundle') d = Math.max(0, Math.floor(units / o.qty) * (o.qty * price - o.price));
      if (d > best) { best = d; bestOffer = o; }
    }
    const current = idx.reduce((a, i) => a + disc[i], 0);
    if (!bestOffer || best <= current) continue;
    // نوزّع الخصم على سطور الصنف بنسبة قيمتها (لا يزيد خصم سطر عن قيمته)
    const totals = idx.map((i) => lineAmount(lines[i].unit_price, lines[i].qty));
    const shares = allocate(Math.min(best, totals.reduce((a, x) => a + x, 0)), totals);
    idx.forEach((i, k) => { disc[i] = shares[k]; used[i] = bestOffer; });
  }

  const out = lines.map((l, i) => (disc[i] > 0
    ? { ...l, discount: (l.discount || 0) + disc[i], offer_discount: disc[i], offer: offerBadge(used[i], currency), offer_id: used[i].id }
    : { ...l }));
  return { lines: out, saved: disc.reduce((a, b) => a + b, 0), applied: [...new Set(used.filter(Boolean).map((o) => o.id))] };
}

/** تاريخ اليوم بتوقيت الجهاز 'YYYY-MM-DD'. */
export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
