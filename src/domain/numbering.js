// أرقام الفواتير: متسلسلة لكل محل وآمنة بلا إنترنت.
// كل جهاز له حرف ثابت (A أو B …) وعدّاده الخاص، فلا يتكرر رقم بين جهازين أبدًا:
//   بيع A-0042   مرتجع A-R0003   شراء A-P0007
// الجهاز الأول في المحل يأخذ A وهو بلا إنترنت؛ الأجهزة التي تنضم لاحقًا (وهي متصلة) يعطيها الخادم الحرف التالي.

export const INVOICE_TYPES = Object.freeze({
  sale: '',
  sale_return: 'R',
  purchase: 'P',
  purchase_return: 'Q',
});

/** 0 → A ، 25 → Z ، 26 → AA (مثل أعمدة الجداول). */
export function deviceLetter(index) {
  if (!Number.isInteger(index) || index < 0) throw new RangeError('index must be >= 0');
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function formatInvoiceNumber(devicePrefix, type, seq) {
  const code = INVOICE_TYPES[type];
  if (code === undefined) throw new RangeError(`unknown invoice type ${type}`);
  if (!/^[A-Z]{1,3}$/.test(devicePrefix)) throw new RangeError(`bad device prefix ${devicePrefix}`);
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError('seq must be >= 1');
  return `${devicePrefix}-${code}${String(seq).padStart(4, '0')}`;
}

/** يطابق ما يكتبه البائع في البحث ("42" أو "a-42" أو "A-0042") مع رقم فاتورة. */
export function matchesInvoiceNumber(number, query) {
  const q = String(query).trim().toUpperCase().replace(/\s/g, '');
  if (!q) return false;
  const n = number.toUpperCase();
  if (n === q) return true;
  const m = /^([A-Z]{1,3})-([A-Z]?)(\d+)$/.exec(n);
  if (!m) return n.includes(q);
  const digits = String(Number(m[3]));
  if (/^\d+$/.test(q)) return Number(q) === Number(m[3]);
  const qm = /^([A-Z]{1,3})-?([A-Z]?)(\d+)$/.exec(q);
  return !!qm && qm[1] === m[1] && qm[2] === m[2] && String(Number(qm[3])) === digits;
}
