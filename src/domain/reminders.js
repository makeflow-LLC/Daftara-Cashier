// تذكير دوري بالديون (نقي): الموعد (شهريًا في يوم يختاره صاحب المحل أو أسبوعيًا)، الساعة، ومن يُذكَّر.
// التطبيق يفحص الموعد كلما فُتح أو عاد للواجهة؛ إن فات الموعد وهو مغلق، يُذكِّر عند أول فتح بعده (مرة واحدة لكل فترة).

export const WEEKDAYS = Object.freeze(['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']);
export const LAST_DAY = 'last';

export function scheduleSettings(saved) {
  const s = saved || {};
  return {
    enabled: !!s.enabled,
    freq: s.freq === 'weekly' ? 'weekly' : 'monthly',
    day: s.day ?? 1,                 // شهري: 1..28 أو 'last'؛ أسبوعي: 0 (الأحد) .. 6 (السبت)
    hour: Number.isInteger(s.hour) ? s.hour : 10,
    minBalance: Number.isInteger(s.minBalance) ? s.minBalance : 1000,   // 10 ₪
    minDays: Number.isInteger(s.minDays) ? s.minDays : 0,               // أقدم دين منذ … يوم
    mode: s.mode === 'auto' ? 'auto' : 'ask',
    excluded: Array.isArray(s.excluded) ? s.excluded : [],
    lastRun: s.lastRun || null,                                          // مفتاح الفترة التي أُرسل فيها
    log: Array.isArray(s.log) ? s.log.slice(0, 12) : [],
  };
}

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

/** مفتاح الفترة: شهر «2026-11» أو أسبوع يبدأ بالسبت «W2026-11-14». */
export function periodKey(now, freq) {
  const d = new Date(now);
  if (freq === 'weekly') {
    const back = (d.getDay() + 1) % 7; // السبت بداية الأسبوع
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
    return `W${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** موعد هذه الفترة (تاريخ ووقت). */
export function slotIn(now, s) {
  const d = new Date(now);
  if (s.freq === 'weekly') {
    const back = (d.getDay() + 1) % 7;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
    const offset = (Number(s.day) + 1) % 7; // من السبت
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, s.hour, 0, 0);
  }
  const last = daysIn(d.getFullYear(), d.getMonth());
  const day = s.day === LAST_DAY ? last : Math.min(Number(s.day) || 1, last);
  return new Date(d.getFullYear(), d.getMonth(), day, s.hour, 0, 0);
}

/** هل حان التذكير الآن (ولم يُرسل في هذه الفترة)؟ */
export function isDue(s, now) {
  if (!s.enabled) return false;
  if (s.lastRun === periodKey(now, s.freq)) return false;
  return now >= slotIn(now, s).getTime();
}

/** الموعد القادم (لعرضه: «التذكير القادم: الأحد 1/12 الساعة 10:00»). */
export function nextRun(s, now) {
  const here = slotIn(now, s);
  if (s.lastRun !== periodKey(now, s.freq) && here.getTime() > now) return here;
  if (s.lastRun !== periodKey(now, s.freq)) return new Date(now); // حان الآن
  const d = new Date(now);
  const next = s.freq === 'weekly' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return slotIn(next.getTime(), s);
}

export function whenText(date) {
  const d = new Date(date);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} الساعة ${pad(d.getHours())}:00`;
}

/** من يُذكَّر: عليه دين ≥ الحد، وأقدم دين منذ minDays يومًا على الأقل، وله رقم، وغير مستثنى. الأكبر دينًا أولًا. */
export function pickRecipients(customers, s, now, hasPhone = (c) => !!c.phone) {
  const excluded = new Set(s.excluded);
  return customers
    .filter((c) => !c.deleted && c.balance >= Math.max(1, s.minBalance) && !excluded.has(c.id) && hasPhone(c))
    .filter((c) => !s.minDays || (c.oldestUnpaidAt && (now - Date.parse(c.oldestUnpaidAt)) / 86400000 >= s.minDays))
    .sort((a, b) => b.balance - a.balance);
}

/** أيام منذ أقدم دين (لعنصر {منذ} في الرسالة). */
export function daysSince(iso, now) {
  return iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 86400000)) : 0;
}

/** «زبون واحد / زبونان / 3 زبائن / 12 زبونًا» */
export function customersText(n) {
  if (n === 1) return 'زبون واحد';
  if (n === 2) return 'زبونان';
  if (n >= 3 && n <= 10) return `${n} زبائن`;
  return `${n} زبونًا`;
}
