// قواعد التعارض في المزامنة (نقية وقابلة للاختبار):
//  - الحركات والدفعات وسطور الفواتير «إضافة فقط»: لا تعارض أبدًا، السجل يُضاف إن لم يكن موجودًا.
//  - الأصناف والزبائن وما شابه: «آخر تعديل يفوز» حسب updated_at، ثم المعرّف لكسر التعادل.

/** هل يجب أن يحلّ السجل القادم من الخادم محل السجل المحلي؟ (جدول آخر-تعديل-يفوز) */
export function remoteWins(local, remote) {
  if (!local) return true;
  if (!remote) return false;
  // الخادم يرجع "2026-01-02T09:00:00+00:00" والجهاز يكتب "2026-01-02T09:00:00.000Z": نقارن الوقت لا النص
  const a = timeOf(local.updated_at);
  const b = timeOf(remote.updated_at);
  if (b !== a) return b > a;
  // نفس الوقت تمامًا: نتيجة ثابتة على كل الأجهزة (نقارن نص السجل كله)
  return stableKey(remote) > stableKey(local);
}

/** جداول الإضافة فقط: القادم يُضاف إن لم يوجد، ولا يغيّر الموجود. */
export function appendWins(local) {
  return !local;
}

function timeOf(v) {
  const t = Date.parse(v || '');
  return Number.isNaN(t) ? 0 : t;
}

/** يوحّد كل حقول الوقت (*_at) القادمة من الخادم إلى صيغة الجهاز ISO (…Z). */
export function normalizeTimestamps(row) {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (k.endsWith('_at') && typeof out[k] === 'string') {
      const t = Date.parse(out[k]);
      if (!Number.isNaN(t)) out[k] = new Date(t).toISOString();
    }
  }
  return out;
}

function stableKey(row) {
  const keys = Object.keys(row).filter((k) => k !== 'server_seq' && k !== 'server_at').sort();
  return JSON.stringify(keys.map((k) => [k, row[k]]));
}

/** وقت ISO بدقة الملّي ثانية لا يرجع للوراء على هذا الجهاز حتى لو تغيّرت ساعة الجوال. */
export function makeClock(now = () => Date.now()) {
  let last = 0;
  return function isoNow() {
    let t = now();
    if (t <= last) t = last + 1;
    last = t;
    return new Date(t).toISOString();
  };
}
