// تقرير اليوم: صفحتان ملوّنتان بالرسوم البيانية (ملف PDF على الجهاز بلا إنترنت) — أرقام اليوم مقارنة بأمس
// وبنفس اليوم من الأسبوع الماضي، آخر 7 أيام، المبيعات بالساعة، الأكثر مبيعًا، طرق الدفع، الموظفون، و«ماذا يعني هذا».
// كل مساء في الساعة التي يختارها صاحب المحل: «📊 تقرير اليوم جاهز» (لافتة في الرئيسية وتنبيه).
import { h, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { header, button, input, switchRow } from '../../ui/components.js';
import { toast } from '../../ui/overlay.js';
import { feedback } from '../../ui/feedback.js';
import { buildReport, periodRange } from '../../domain/reports.js';
import { dailyDigest, hourLabel } from '../../domain/daily.js';
import { pdfFromJpegs } from '../../domain/invoice.js';
import { formatMoney } from '../../domain/currency.js';
import { supplierDues } from '../../domain/dues.js';
import { localDay } from '../../domain/offers.js';
import { staffName } from '../../domain/staff.js';
import { app } from '../../core/app.js';
import { navigate } from '../../core/router.js';
import { loadData } from './reports.js';
import { sendFile } from '../invoices/share.js';

const FONT = '"Noto Naskh Arabic","Noto Sans Arabic",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif';
const NUMF = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
const C = {
  ink: '#201e1d', muted: '#605d5d', faint: '#8a8686', grid: '#e7e3e3', card: '#ffffff', paper: '#f6f4f3',
  brand: '#0e7a51', brandSoft: '#b7dfc9', brand100: '#e8f5ee', up: '#0e7a51', down: '#c2185b', warn: '#9a5b00', info: '#1552a3',
};
const W = 1240, H = 1754, PAD = 70;

// ---------- الإعداد ----------
export function dailySettings() {
  const s = app.shop?.settings?.dailyReport || {};
  return { enabled: s.enabled !== false, time: /^\d{2}:\d{2}$/.test(s.time || '') ? s.time : '21:00' };
}
const seenKey = 'dailyReport:seen';

/** أي يوم تقريره «جاهز ولم يُفتح»؟ اليوم بعد الساعة المختارة، أو أمس إن كان فيه بيع ولم يُفتح. */
export async function readyDay(now = new Date()) {
  if (!app.shop || !app.can('reports')) return null;
  const s = dailySettings();
  if (!s.enabled) return null;
  const seen = await app.meta.get(seenKey);
  const today = localDay(now);
  const [hh, mm] = s.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm) return seen === today ? null : today;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yd = localDay(y);
  if (seen && seen >= yd) return null;
  const r = periodRange('custom', now, { from: yd, to: yd });
  const any = await app.db.invoices.where('created_at').between(r.from, r.to, true, false).filter((i) => i.type === 'sale' && !i.deleted).count();
  return any ? yd : null;
}

// ---------- البيانات ----------
const shift = (day, n) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
const rangeOf = (from, to = from) => periodRange('custom', new Date(), { from, to });

export async function loadDigest(day) {
  const showProfit = app.can('see_profit');
  const r = rangeOf(day);
  const [todayData, y, lw, wk] = await Promise.all([loadData(r), loadData(rangeOf(shift(day, -1))), loadData(rangeOf(shift(day, -7))), loadData(rangeOf(shift(day, -6), day))]);
  const today = buildReport(todayData);
  const sales = todayData.invoices.filter((i) => i.type === 'sale' && i.status === 'final' && !i.deleted);
  const saleIds = new Set(sales.map((i) => i.id));
  const offersSaved = sales.reduce((a, i) => a + (i.discount || 0), 0) + todayData.lines.filter((l) => saleIds.has(l.invoice_id)).reduce((a, l) => a + (l.discount || 0), 0);
  const entries = await app.db.customer_entries.where('created_at').between(r.from, r.to, true, false).toArray();
  const newDebt = entries.filter((e) => e.type === 'sale_credit').reduce((a, e) => a + e.amount, 0);
  const collected = -entries.filter((e) => e.type === 'payment').reduce((a, e) => a + e.amount, 0);
  const isToday = day === localDay();
  const soon = isToday && app.can('purchases') ? (await app.inventory.assistant()).soon.map((x) => ({ name: x.p.name, daysLeft: x.daysLeft })) : [];
  const dues = isToday && app.can('purchases') ? supplierDues(await app.inventory.suppliers(), app.shop?.settings?.supplierDues, day).map((d) => ({ name: d.supplier.name, amount: d.supplier.balance, days: d.days })) : [];
  const st = app.shop?.settings?.staff;
  return dailyDigest({
    day, today, yesterday: buildReport(y), lastWeek: buildReport(lw), week: buildReport(wk), invoices: todayData.invoices,
    extra: { offersSaved, newDebt, collected: Math.max(0, collected), soon, dues, staffName: st && st.members?.length ? (id) => staffName(st, id) : null },
  }, { currency: app.shop?.base_currency || 'ILS', showProfit });
}

// ---------- الرسم ----------
function pager(title) {
  const pages = [];
  let g = null;
  let y = 0;
  const newPage = () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    g = c.getContext('2d');
    g.fillStyle = C.paper; g.fillRect(0, 0, W, H);
    pages.push(c);
    y = PAD;
    if (pages.length > 1) { text(g, title, W - PAD, y, { size: 24, color: C.muted }); y += 50; }
    return g;
  };
  newPage();
  return {
    pages,
    get g() { return g; },
    get y() { return y; },
    set y(v) { y = v; },
    need(hgt) { if (y + hgt > H - 90) newPage(); return g; },
  };
}

function text(g, s, x, y, { size = 26, weight = 400, color = C.ink, align = 'right', dir = 'rtl', font = FONT, base = 'top' } = {}) {
  g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.direction = dir; g.textBaseline = base;
  g.fillText(String(s), x, y);
}
const num = (g, s, x, y, o = {}) => text(g, s, x, y, { dir: 'ltr', font: NUMF, ...o });
function fit(g, s, max, size, weight = 400) {
  g.font = `${weight} ${size}px ${FONT}`;
  let t = String(s);
  while (g.measureText(t).width > max && t.length > 3) t = `${t.slice(0, -2)}…`;
  return t;
}
function rrect(g, x, y, w, hh, r, fillColor) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath(); g.fillStyle = fillColor; g.fill();
}
/** عمود بطرف علوي مدوّر 4px وقاعدة مستقيمة على خط الأساس. */
function bar(g, x, y, w, hh, color) {
  if (hh <= 0) return;
  const r = Math.min(4, w / 2, hh);
  g.beginPath();
  g.moveTo(x, y + hh); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + hh);
  g.closePath(); g.fillStyle = color; g.fill();
}
/** شريط أفقي من اليمين (RTL) بطرف أيسر مدوّر. */
function hbar(g, right, y, w, hh, color) {
  if (w <= 0) return;
  const r = Math.min(4, hh / 2, w);
  const x = right - w;
  g.beginPath();
  g.moveTo(right, y); g.lineTo(x + r, y); g.arcTo(x, y, x, y + r, r); g.lineTo(x, y + hh - r); g.arcTo(x, y + hh, x + r, y + hh, r); g.lineTo(right, y + hh);
  g.closePath(); g.fillStyle = color; g.fill();
}
function sectionTitle(p, title, sub = null) {
  const g = p.g;
  text(g, title, W - PAD, p.y, { size: 34, weight: 700 });
  if (sub) text(g, sub, PAD, p.y + 8, { size: 22, color: C.muted, align: 'left' });
  p.y += 58;
}
const delta = (v, label) => (v === null || v === undefined ? null : { v, text: `${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${Math.abs(v)}% ${label}`, color: v > 0 ? C.up : v < 0 ? C.down : C.muted });

export function renderDailyPages(d, shop) {
  const cur = shop?.base_currency || 'ILS';
  const m = (v) => formatMoney(v, cur);
  const date = d.day.split('-').reverse().join('/');
  const p = pager(`${shop?.name || ''} — تقرير ${d.weekday} ${date}`);
  let g = p.g;

  // رأس الصفحة
  const grad = g.createLinearGradient(W, 0, 0, 260);
  grad.addColorStop(0, '#0e7a51'); grad.addColorStop(0.55, '#0b6b63'); grad.addColorStop(1, '#0a5577');
  g.fillStyle = grad; g.fillRect(0, 0, W, 260);
  text(g, 'تقرير اليوم', W - PAD, 56, { size: 30, color: 'rgba(255,255,255,.85)' });
  text(g, fit(g, shop?.name || '', W - PAD * 2 - 260, 56, 700), W - PAD, 100, { size: 56, weight: 700, color: '#fff' });
  text(g, `${d.weekday} ${date}`, W - PAD, 182, { size: 30, color: '#fff' });
  text(g, 'دفترة كاشير', PAD, 60, { size: 24, color: 'rgba(255,255,255,.8)', align: 'left' });
  p.y = 300;

  // بطاقات الأرقام
  const cols = 2, gap = 30, cw = (W - PAD * 2 - gap) / cols, ch = 210;
  d.kpis.forEach((k, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = W - PAD - (col + 1) * cw - col * gap, y = p.y + row * (ch + gap);
    rrect(g, x, y, cw, ch, 22, C.card);
    text(g, k.label, x + cw - 30, y + 26, { size: 26, color: C.muted });
    num(g, k.value, x + cw - 30, y + 66, { size: 54, weight: 700, align: 'right', color: k.raw < 0 ? C.down : C.ink });
    const ds = [delta(k.vsYesterday, 'عن أمس'), delta(k.vsLastWeek, `عن ${d.weekday} الماضي`)].filter(Boolean);
    ds.forEach((dd, j) => text(g, dd.text, x + cw - 30, y + 140 + j * 32, { size: 23, weight: 600, color: dd.color }));
    if (!ds.length) text(g, 'لا يوجد ما نقارن به بعد', x + cw - 30, y + 146, { size: 22, color: C.faint });
  });
  p.y += Math.ceil(d.kpis.length / cols) * (ch + gap) + 20;

  // ماذا يعني هذا
  const notes = d.notes;
  if (notes.length) {
    const lh = 46;
    const boxH = 90 + notes.length * lh;
    g = p.need(boxH + 20);
    rrect(g, PAD, p.y, W - PAD * 2, boxH, 22, C.card);
    text(g, 'ماذا يعني هذا؟', W - PAD - 30, p.y + 26, { size: 30, weight: 700 });
    const tone = { up: C.up, down: C.down, warn: C.warn, info: C.info, muted: C.muted };
    const mark = { up: '▲', down: '▼', warn: '!', info: '•', muted: '•' };
    notes.forEach((n, i) => {
      const yy = p.y + 82 + i * lh;
      text(g, mark[n.tone], W - PAD - 30, yy, { size: 24, weight: 700, color: tone[n.tone] });
      text(g, fit(g, n.text, W - PAD * 2 - 110, 25), W - PAD - 66, yy, { size: 25 });
    });
    p.y += boxH + 40;
  }

  // آخر 7 أيام: أعمدة، اليوم بالأخضر الغامق والباقي فاتح، القيمة على اليوم وعلى الأعلى فقط
  g = p.need(470);
  sectionTitle(p, 'آخر 7 أيام', 'صافي المبيعات لكل يوم');
  {
    const top = p.y, hh = 300, base = top + hh;
    const max = Math.max(1, ...d.days.map((x) => x.sales));
    const n = d.days.length, slot = (W - PAD * 2) / n, bw = Math.min(90, slot * 0.6);
    g.strokeStyle = C.grid; g.lineWidth = 2; g.beginPath(); g.moveTo(PAD, base); g.lineTo(W - PAD, base); g.stroke();
    const maxI = d.days.reduce((b, x, i) => (x.sales > d.days[b].sales ? i : b), 0);
    d.days.forEach((x, i) => {
      // الأقدم يمينًا (اتجاه القراءة العربية)، واليوم في أقصى اليسار
      const cx = W - PAD - slot * i - slot / 2;
      const bh = Math.round((Math.max(0, x.sales) / max) * (hh - 50));
      bar(g, cx - bw / 2, base - bh, bw, bh, x.today ? C.brand : C.brandSoft);
      if (x.today || (i === maxI && x.sales > 0)) num(g, formatMoney(x.sales, cur, { symbol: false }), cx, base - bh - 34, { size: 22, weight: 700, align: 'center', color: C.ink });
      text(g, x.today ? 'اليوم' : x.label, cx, base + 14, { size: 22, align: 'center', color: x.today ? C.ink : C.muted, weight: x.today ? 700 : 400 });
    });
    p.y = base + 70;
  }

  // المبيعات بالساعة
  const active = d.hours.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  if (active.length) {
    g = p.need(460);
    sectionTitle(p, 'المبيعات حسب الساعة', `أقوى ساعة: ${hourLabel(d.bestHour)}`);
    const from = Math.min(8, active[0]), to = Math.max(22, active[active.length - 1] + 1);
    const hrs = []; for (let i = from; i < to; i++) hrs.push(i);
    const top = p.y, hh = 280, base = top + hh;
    const max = Math.max(1, ...d.hours);
    const slot = (W - PAD * 2) / hrs.length, bw = Math.max(8, slot * 0.62);
    g.strokeStyle = C.grid; g.lineWidth = 2; g.beginPath(); g.moveTo(PAD, base); g.lineTo(W - PAD, base); g.stroke();
    hrs.forEach((hr, i) => {
      const cx = PAD + slot * i + slot / 2; // الساعات من اليسار لليمين كما على الساعة
      const v = Math.max(0, d.hours[hr]);
      const bh = Math.round((v / max) * (hh - 46));
      bar(g, cx - bw / 2, base - bh, bw, bh, hr === d.bestHour ? C.brand : C.brandSoft);
      if (hr === d.bestHour) num(g, formatMoney(v, cur, { symbol: false }), cx, base - bh - 32, { size: 21, weight: 700, align: 'center' });
      if (hr % 2 === 0) num(g, `${hr}:00`, cx, base + 12, { size: 19, align: 'center', color: C.muted });
    });
    p.y = base + 70;
  }

  // أشرطة أفقية: الاسم يمينًا، الشريط، والقيمة بعده
  function hbars(title, sub, rows) {
    if (!rows.length) return;
    const rh = 58;
    g = p.need(80 + rows.length * rh + 30);
    sectionTitle(p, title, sub);
    const max = Math.max(1, ...rows.map((r) => r.value));
    const subW = rows.some((r) => r.sub) ? 150 : 0;
    const nameW = 300, valW = 250, barMax = W - PAD * 2 - nameW - valW - subW - 20;
    rows.forEach((r, i) => {
      const y = p.y + i * rh;
      text(g, fit(g, r.name, nameW - 10, 26), W - PAD, y + 8, { size: 26 });
      const bw = Math.max(4, Math.round((Math.max(0, r.value) / max) * barMax));
      const right = W - PAD - nameW;
      hbar(g, right, y + 10, bw, 30, i === 0 ? C.brand : C.brandSoft);
      num(g, r.label, right - bw - 14, y + 10, { size: 24, weight: 700, align: 'right' });
      if (r.sub) text(g, r.sub, PAD, y + 12, { size: 21, color: C.muted, align: 'left' });
    });
    p.y += rows.length * rh + 40;
  }
  const totalMethods = d.methods.reduce((a, x) => a + x.total, 0) || 1;
  hbars('الأكثر مبيعًا', 'أعلى 5 أصناف بالمبيعات', d.top.map((x) => ({ name: x.name, value: x.amount, label: m(x.amount), sub: x.qty })));
  hbars('طرق الدفع', null, d.methods.map((x) => ({ name: x.name, value: x.total, label: `${m(x.total)}  ·  ${Math.round((x.total / totalMethods) * 100)}%` })));
  hbars('التصنيفات', null, d.categories.map((x) => ({ name: x.name, value: x.amount, label: m(x.amount) })));
  hbars('الموظفون', 'من باع ماذا', d.staff.map((x) => ({ name: x.name, value: x.sales, label: m(x.sales), sub: `${x.count} فاتورة` })));

  // تذييل كل صفحة
  p.pages.forEach((c, i) => {
    const gg = c.getContext('2d');
    gg.strokeStyle = C.grid; gg.lineWidth = 2; gg.beginPath(); gg.moveTo(PAD, H - 70); gg.lineTo(W - PAD, H - 70); gg.stroke();
    text(gg, 'دفترة كاشير · MakeFlow', W - PAD, H - 52, { size: 20, color: C.faint });
    num(gg, `${i + 1} / ${p.pages.length}`, PAD, H - 52, { size: 20, color: C.faint, align: 'left' });
  });
  return p.pages;
}

const toJpeg = (c) => new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88)).then(async (b) => new Uint8Array(await b.arrayBuffer()));

/** ملف PDF لتقرير يوم. يرجع { blob, name, mime, pages (canvas) }. */
export async function dailyFile(day) {
  const d = await loadDigest(day);
  const pages = renderDailyPages(d, app.shop);
  const jpegs = await Promise.all(pages.map(toJpeg));
  const pdf = pdfFromJpegs(jpegs.map((jpeg) => ({ jpeg, width: W, height: H })), W / 595);
  return { blob: new Blob([pdf], { type: 'application/pdf' }), name: `daily-report-${day}.pdf`, mime: 'application/pdf', pages, digest: d };
}

// ---------- الشاشة ----------
export async function renderDailyReport(el, params = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day || '') ? params.day : localDay();
  const body = h('div', { class: 'daily-pages' });
  const nav = h('div', { class: 'chips daily-nav' });
  const settingsBox = h('div');
  el.append(header('تقرير اليوم', { back: true }), h('div', { class: 'page' }, nav, h('div', { class: 'product-actions' },
    button('أرسل لي على واتساب', { icon: 'receipt', onclick: () => send(false) }),
    button('مشاركة', { kind: 'outline', icon: 'clipboard', onclick: () => send(true) })), body, settingsBox));
  const go = (d) => navigate(`/reports/daily?day=${d}`, { replace: true });
  const today = localDay();
  fill(nav,
    h('button', { class: 'chip', type: 'button', onclick: () => go(shift(day, -1)) }, icon('chevron', 16), ' اليوم السابق'),
    h('span', { class: 'chip on' }, day === today ? 'اليوم' : day.split('-').reverse().join('/')),
    day < today ? h('button', { class: 'chip', type: 'button', onclick: () => go(shift(day, 1)) }, 'اليوم التالي ', icon('back', 16)) : null);
  fill(body, h('p', { class: 'muted' }, 'جارٍ تجهيز التقرير…'));
  let file = null;
  try {
    file = await dailyFile(day);
    fill(body, ...file.pages.map((c) => h('img', { class: 'daily-page', src: c.toDataURL('image/jpeg', 0.85), alt: 'صفحة من تقرير اليوم' })));
    const prev = await app.meta.get(seenKey);
    if (day <= today && (!prev || day > prev)) await app.meta.set(seenKey, day);
  } catch (e) { console.error(e); fill(body, h('p', { class: 'form-error' }, 'تعذّر تجهيز التقرير')); }

  async function send(chooser) {
    if (!file) return;
    try { await sendFile(file, chooser ? '' : (app.shop?.phone || ''), `تقرير ${app.shop?.name || ''} — ${day}`, { chooser }); }
    catch (e) { console.error(e); feedback.error(); toast('تعذّر الإرسال', { kind: 'error' }); }
  }

  // الإعداد: متى يكون التقرير جاهزًا كل يوم
  if (app.can('settings')) {
    const s = dailySettings();
    const time = input({ type: 'time', dir: 'ltr', value: s.time });
    time.addEventListener('change', async () => { if (time.value) { await app.updateShopSettings({ dailyReport: { ...dailySettings(), time: time.value } }); toast('حُفظ الموعد', { kind: 'ok' }); } });
    fill(settingsBox, h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'كل يوم'),
      h('div', { class: 'list' },
        switchRow({ title: 'نبّهني حين يجهز تقرير اليوم', sub: 'لافتة في الرئيسية في الساعة التي تختارها', checked: s.enabled, onchange: (on) => app.updateShopSettings({ dailyReport: { ...dailySettings(), enabled: on } }) }),
        h('label', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'الساعة')), time))));
  }
}

/** لافتة الرئيسية: «📊 تقرير اليوم جاهز». */
export function dailyReportBanner() {
  const box = h('div');
  readyDay().then((day) => {
    if (!day) return;
    const isToday = day === localDay();
    fill(box, h('button', { class: 'beta-banner daily-banner', type: 'button', onclick: () => navigate(`/reports/daily?day=${day}`) },
      icon('chart', 26),
      h('span', { class: 'row-main' }, h('strong', null, isToday ? 'تقرير اليوم جاهز 📊' : 'تقرير أمس جاهز 📊'), h('span', null, 'مبيعاتك وأرباحك مقارنة بأمس — بالرسوم البيانية')),
      icon('chevron', 20)));
  }).catch(() => {});
  return box;
}

/** يراقب الساعة والتطبيق مفتوح: عند موعد التقرير تنبيه مرة واحدة في اليوم. */
export function watchDailyReport() {
  let lastToast = null;
  const tick = async () => {
    try {
      const day = await readyDay();
      if (!day || day !== localDay() || lastToast === day) return;
      lastToast = day;
      app.bus.emit('dailyReport', day);
      toast('📊 تقرير اليوم جاهز — افتحه من الرئيسية', { kind: 'ok', ms: 6000 });
      // الحاسوب والمتصفح: تنبيه النظام إن كان مسموحًا
      if (globalThis.Notification && Notification.permission === 'granted') {
        try { const n = new Notification('تقرير اليوم جاهز 📊', { body: app.shop?.name || '', tag: `daily-${day}` }); n.onclick = () => { window.focus(); navigate(`/reports/daily?day=${day}`); }; } catch { /* */ }
      }
    } catch { /* */ }
  };
  tick();
  return setInterval(tick, 60000);
}
