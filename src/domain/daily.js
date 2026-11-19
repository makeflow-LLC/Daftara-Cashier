// تقرير اليوم (نقي): أرقام اليوم مقارنة بأمس وبنفس اليوم من الأسبوع الماضي، المبيعات بالساعة،
// أيام الأسبوع، طرق الدفع، الأكثر مبيعًا، الموظفون، وجمل «ماذا يعني هذا» بالعربية.
// الرسم (PDF بالرسوم البيانية) في features/reports/daily.js.
import { formatMoney } from './currency.js';
import { formatQty, unit as unitOf } from './units.js';

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** النسبة المئوية للتغيّر (عدد صحيح) أو null إن لم يكن هناك ما نقارن به. */
export function pctChange(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

/** صافي المبيعات لكل ساعة من الساعات الـ24 (بتوقيت الجهاز). */
export function hourly(invoices) {
  const out = new Array(24).fill(0);
  for (const i of invoices) {
    if (i.deleted || i.status !== 'final' || (i.type !== 'sale' && i.type !== 'sale_return')) continue;
    out[new Date(i.created_at).getHours()] += (i.type === 'sale' ? 1 : -1) * i.total;
  }
  return out;
}

/** «6–7 مساءً» */
export function hourLabel(h) {
  const part = (x) => (x < 12 ? 'صباحًا' : x < 17 ? 'ظهرًا' : 'مساءً');
  const f = (x) => (x % 12 === 0 ? 12 : x % 12);
  return `${f(h)}–${f(h + 1)} ${part(h)}`;
}

export function weekdayName(day) {
  return AR_DAYS[new Date(`${day}T12:00:00`).getDay()];
}

/**
 * input:
 *   day        'YYYY-MM-DD'
 *   today, yesterday, lastWeek   نتائج buildReport لكل يوم
 *   week       buildReport لآخر 7 أيام (byDay)
 *   invoices   فواتير اليوم (للساعات)
 *   extra      { offersSaved, newDebt, collected, expenses, soon: [{name,daysLeft}], dues: [{name, amount, days}], debts, staffName }
 */
export function dailyDigest({ day, today, yesterday, lastWeek, week, invoices = [], extra = {} }, { currency = 'ILS', showProfit = true } = {}) {
  const m = (v) => formatMoney(v, currency);
  const kpi = (label, key, fmt) => ({
    label, value: fmt(today[key]), raw: today[key],
    vsYesterday: pctChange(today[key], yesterday ? yesterday[key] : 0),
    vsLastWeek: pctChange(today[key], lastWeek ? lastWeek[key] : 0),
  });
  const kpis = [
    kpi('صافي المبيعات', 'net', m),
    ...(showProfit ? [kpi('الربح', 'profit', m)] : []),
    kpi('عدد الفواتير', 'invoiceCount', String),
    kpi('متوسط الفاتورة', 'avgInvoice', m),
  ];
  const hours = hourly(invoices);
  const bestHour = hours.reduce((b, v, i) => (v > hours[b] ? i : b), 0);
  const days = [];
  const byDay = new Map((week?.byDay || []).map((d) => [d.day, d]));
  for (let k = 6; k >= 0; k--) {
    const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() - k);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ day: key, label: AR_DAYS[d.getDay()], sales: byDay.get(key)?.sales || 0, today: k === 0 });
  }
  const top = today.best.slice(0, 5).map((x) => ({ name: x.name, amount: x.amount, qty: `${formatQty(x.qty)} ${unitOf(x.unit).short}` }));

  // ماذا يعني هذا: جمل قصيرة مرتبة بالأهمية
  const notes = [];
  const dy = pctChange(today.net, yesterday?.net || 0);
  if (!today.invoiceCount) notes.push({ tone: 'muted', text: 'لا مبيعات مسجّلة في هذا اليوم.' });
  else {
    if (dy !== null && dy !== 0) notes.push({ tone: dy > 0 ? 'up' : 'down', text: `مبيعات اليوم ${dy > 0 ? 'أعلى' : 'أقل'} من أمس بـ ${Math.abs(dy)}% (أمس ${m(yesterday.net)}).` });
    const dw = pctChange(today.net, lastWeek?.net || 0);
    if (dw !== null && dw !== 0) notes.push({ tone: dw > 0 ? 'up' : 'down', text: `و${dw > 0 ? 'أعلى' : 'أقل'} بـ ${Math.abs(dw)}% من ${weekdayName(day)} الماضي.` });
    if (hours[bestHour] > 0) notes.push({ tone: 'info', text: `أقوى ساعة: ${hourLabel(bestHour)} بمبيعات ${m(hours[bestHour])}.` });
    if (top[0]) notes.push({ tone: 'info', text: `الأكثر مبيعًا: «${top[0].name}» بـ ${m(top[0].amount)}.` });
    const weekAvg = days.slice(0, 6).filter((d) => d.sales > 0);
    if (weekAvg.length >= 3) {
      const avg = Math.round(weekAvg.reduce((a, d) => a + d.sales, 0) / weekAvg.length);
      const p = pctChange(today.net, avg);
      if (p !== null && Math.abs(p) >= 5) notes.push({ tone: p > 0 ? 'up' : 'down', text: `${p > 0 ? 'فوق' : 'تحت'} متوسط أيامك الأخيرة (${m(avg)}) بـ ${Math.abs(p)}%.` });
    }
  }
  if (extra.offersSaved) notes.push({ tone: 'info', text: `الخصومات والعروض: ${m(extra.offersSaved)} اليوم.` });
  if (extra.newDebt) notes.push({ tone: 'warn', text: `بيع بالآجل اليوم: ${m(extra.newDebt)}${extra.collected ? `، واستلمت من الديون ${m(extra.collected)}` : ''}.` });
  else if (extra.collected) notes.push({ tone: 'up', text: `استلمت من ديون الزبائن ${m(extra.collected)}.` });
  if (extra.soon && extra.soon.length) notes.push({ tone: 'warn', text: `${extra.soon.length} صنف يخلص خلال أسبوع: ${extra.soon.slice(0, 3).map((s) => s.name).join('، ')}${extra.soon.length > 3 ? '…' : ''}.` });
  if (extra.dues && extra.dues.length) notes.push({ tone: 'warn', text: `دفعات للتجار خلال 3 أيام: ${extra.dues.map((d) => `${d.name} ${m(d.amount)}`).slice(0, 3).join('، ')}.` });

  return {
    day, weekday: weekdayName(day), kpis, hours, bestHour, days, top,
    methods: today.byMethod,
    categories: today.byCategory.slice(0, 6),
    staff: extra.staffName && today.byStaff && today.byStaff.some((x) => x.id) ? today.byStaff.map((x) => ({ name: extra.staffName(x.id), sales: x.sales, count: x.count })) : [],
    returns: today.returnsTotal, purchases: today.purchasesTotal,
    notes,
  };
}
