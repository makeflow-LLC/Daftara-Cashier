// المال: أعداد صحيحة بأصغر وحدة للعملة (أغورة للشيكل، سنت للدولار، فلس للدينار).
// لا أرقام عشرية (float) في أي حساب مالي أبدًا. هذه الطبقة نقية: لا DOM ولا قاعدة بيانات.

/** قسمة صحيحة مع تقريب النصف بعيدًا عن الصفر (12.5 → 13، ‎-12.5 → ‎-13). */
export function divRound(a, b) {
  if (b === 0) throw new RangeError('division by zero');
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    const A = BigInt(a), B = BigInt(b);
    const neg = (A < 0n) !== (B < 0n);
    const aa = A < 0n ? -A : A, bb = B < 0n ? -B : B;
    const q = (aa * 2n + bb) / (bb * 2n);
    return neg ? -q : q;
  }
  assertInt(a, 'a'); assertInt(b, 'b');
  const neg = (a < 0) !== (b < 0);
  const aa = Math.abs(a), bb = Math.abs(b);
  let q = Math.floor(aa / bb);
  if ((aa % bb) * 2 >= bb) q += 1;
  return neg && q !== 0 ? -q : q;
}

export function assertInt(n, name = 'value') {
  if (!Number.isSafeInteger(n)) throw new TypeError(`${name} must be a safe integer, got ${n}`);
  return n;
}

/** يحوّل الأرقام العربية-الهندية والفارسية إلى أرقام غربية، والفاصلة العربية إلى نقطة. */
export function normalizeDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٫،,]/g, '.') // ٫ ، , → .
    .replace(/[٬\s_']/g, '');    // ٬ والمسافات وفواصل الآلاف
}

/**
 * يقرأ نصًا عشريًا إلى عدد صحيح بـ `places` منازل (بلا float): "12.5", 2 → 1250.
 * يرجع null إن لم يكن رقمًا صالحًا. الزائد عن المنازل يُقرَّب.
 */
export function parseDecimal(text, places) {
  const s = normalizeDigits(text);
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const whole = m[2] || '0';
  const frac = m[3] || '';
  const kept = (frac + '0'.repeat(places)).slice(0, places);
  let n = Number(whole) * 10 ** places + Number(kept || '0');
  if (frac.length > places && Number(frac[places]) >= 5) n += 1;
  if (!Number.isSafeInteger(n)) return null;
  return sign * n || 0;
}

/** عدد صحيح بـ `places` منازل → نص بأرقام غربية وفواصل آلاف: 123456, 2 → "1,234.56". */
export function formatDecimal(n, places, { trim = false, group = true } = {}) {
  assertInt(n, 'n');
  const neg = n < 0;
  const abs = Math.abs(n);
  const base = 10 ** places;
  let whole = String(Math.floor(abs / base));
  let frac = places ? String(abs % base).padStart(places, '0') : '';
  if (trim) frac = frac.replace(/0+$/, '');
  if (group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

/** مجموع آمن لقائمة أعداد صحيحة. */
export function sum(list, pick = (x) => x) {
  let t = 0;
  for (const x of list) t += assertInt(pick(x), 'item');
  return assertInt(t, 'sum');
}

/** نسبة مئوية بنقاط الأساس (basis points: 100 = 1%) من مبلغ، مقرّبة. */
export function percentOf(amountMinor, basisPoints) {
  return divRound(assertInt(amountMinor) * assertInt(basisPoints), 10000);
}

/**
 * يقسم مبلغًا على أجزاء بنسب أوزانها، بلا ضياع أغورة واحدة (طريقة أكبر باقٍ).
 * allocate(100, [1,1,1]) → [34, 33, 33]
 */
export function allocate(amountMinor, weights) {
  assertInt(amountMinor);
  const total = weights.reduce((a, w) => a + assertInt(w, 'weight'), 0);
  if (weights.length === 0) return [];
  if (total === 0) return weights.map((_, i) => (i === 0 ? amountMinor : 0));
  const sign = amountMinor < 0 ? -1 : 1;
  const amt = Math.abs(amountMinor);
  const raw = weights.map((w) => {
    const p = amt * w;
    return { q: Math.floor(p / total), r: p % total };
  });
  let left = amt - raw.reduce((a, x) => a + x.q, 0);
  const order = raw.map((x, i) => i).sort((i, j) => raw[j].r - raw[i].r || i - j);
  for (const i of order) { if (left <= 0) break; raw[i].q += 1; left -= 1; }
  return raw.map((x) => sign * x.q || 0);
}
