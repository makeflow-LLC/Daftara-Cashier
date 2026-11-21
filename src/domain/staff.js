// الموظفون والصلاحيات (نقي): كل موظف له اسم ورمز PIN وصلاحيات. صاحب المحل يرى كل شيء.
// الإعداد كله في settings.staff للمحل (يتزامن مع كل الأجهزة):
//   { enabled, owner: { name, pin: {salt, hash} }, members: [{ id, name, role, perms: [...], pin, active }] }
// الرمز لا يُحفظ أبدًا كما هو: SHA-256 مع ملح لكل شخص. هذا قفل للمحل (من يرى ماذا)، لا حماية للبيانات من خبير.

// ---------- الصلاحيات ----------
export const PERMISSIONS = Object.freeze([
  { key: 'see_profit', label: 'يرى الأرباح والتكلفة', hint: 'في الرئيسية والتقارير وبطاقة الصنف' },
  { key: 'discount', label: 'يعطي خصمًا ويغيّر السعر', hint: 'في شاشة البيع، ويبيع «مبلغًا بلا صنف»' },
  { key: 'credit', label: 'يبيع بالآجل (دين)', hint: 'ويسجّل ديونًا ودفعات للزبائن' },
  { key: 'returns', label: 'يعمل مرتجع', hint: 'يرجع بضاعة ويرد المال' },
  { key: 'products', label: 'يضيف ويعدّل الأصناف والأسعار', hint: 'والاستيراد وتحديث الأسعار' },
  { key: 'purchases', label: 'الشراء والمخزون وديون التجار', hint: 'يستلم بضاعة ويجرد ويدفع للتجار' },
  { key: 'cash', label: 'الصندوق', hint: 'فتح الوردية وإغلاقها والمصروفات' },
  { key: 'reports', label: 'التقارير', hint: 'مبيعات المحل كلها وتقرير اليوم' },
  { key: 'delete', label: 'يحذف', hint: 'زبائن وأصناف وحركات' },
  { key: 'settings', label: 'الإعدادات', hint: 'بيانات المحل والميزات والعروض والنسخ الاحتياطية' },
]);
export const PERM_KEYS = PERMISSIONS.map((p) => p.key);

export const ROLES = Object.freeze({
  cashier: { name: 'كاشير', hint: 'يبيع فقط', perms: [] },
  senior: { name: 'كاشير موثوق', hint: 'يبيع ويعطي خصمًا وآجلًا ومرتجعًا', perms: ['discount', 'credit', 'returns'] },
  manager: { name: 'مدير', hint: 'كل شيء ما عدا الإعدادات', perms: PERM_KEYS.filter((k) => k !== 'settings') },
});

// أسماء قديمة في الكود ← الصلاحية
const ALIAS = { see_cost: 'see_profit' };

/** هل يملك هذا الشخص الصلاحية؟ user: null (صاحب المحل أو بلا موظفين) أو عضو. */
export function allowed(user, action) {
  if (!user || user.owner) return true;
  const key = ALIAS[action] || action;
  if (!PERM_KEYS.includes(key)) return true; // ما ليس صلاحية معروفة مسموح
  return Array.isArray(user.perms) && user.perms.includes(key);
}

// ---------- الرمز ----------
export const PIN_MIN = 4;
export const PIN_MAX = 6;

/** رسالة خطأ أو null. */
export function pinProblem(pin, confirm) {
  const p = String(pin ?? '');
  if (!/^[0-9]+$/.test(p) || p.length < PIN_MIN || p.length > PIN_MAX) return `الرمز ${PIN_MIN} إلى ${PIN_MAX} أرقام`;
  if (/^(\d)\1+$/.test(p)) return 'اختر رمزًا غير مكرر (مثل 1111)';
  if (confirm !== undefined && p !== String(confirm)) return 'الرمزان غير متطابقين';
  return null;
}

/** { salt, hash } — salt من الخارج (عشوائي) ليبقى هذا نقيًا. */
export function makePin(pin, salt) {
  return { salt, hash: sha256Hex(`${salt}|${pin}`) };
}

export function checkPin(pin, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  return sha256Hex(`${rec.salt}|${String(pin ?? '')}`) === rec.hash;
}

/** هل هذا الرمز مستعمل لشخص آخر؟ (لا يصح رمزان متطابقان: الدخول بالرمز وحده) */
export function pinTaken(staff, pin, exceptId = null) {
  if (!staff) return false;
  if (exceptId !== 'owner' && checkPin(pin, staff.owner?.pin)) return true;
  return (staff.members || []).some((m) => m.id !== exceptId && m.active !== false && checkPin(pin, m.pin));
}

/** من صاحب هذا الرمز؟ يرجع { owner: true, name } أو العضو أو null. */
export function whoHasPin(staff, pin) {
  if (!staff) return null;
  if (checkPin(pin, staff.owner?.pin)) return { owner: true, id: 'owner', name: staff.owner.name || 'صاحب المحل' };
  return (staff.members || []).find((m) => m.active !== false && checkPin(pin, m.pin)) || null;
}

/** الحالي من معرّفه المحفوظ على الجهاز. */
export function userById(staff, id) {
  if (!staff || !staff.enabled) return null;
  if (id === 'owner') return { owner: true, id: 'owner', name: staff.owner?.name || 'صاحب المحل' };
  return (staff.members || []).find((m) => m.id === id && m.active !== false) || null;
}

/** اسم من سجّل الفاتورة (created_by = معرّف الموظف، أو null لصاحب المحل). */
export function staffName(staff, id) {
  if (!id) return staff?.owner?.name || 'صاحب المحل';
  const m = (staff?.members || []).find((x) => x.id === id);
  return m ? m.name : 'موظف سابق';
}

// ---------- SHA-256 (بلا مكتبات ولا async، فيعمل في كل مكان ويُختبر) ----------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text) {
  const msg = new TextEncoder().encode(String(text));
  const len = msg.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}
