// منطق المخزون النقي: فاتورة الشراء، التنبيهات (نفد، منخفض، ينتهي قريبًا، راكد)، الجرد، ورسالة طلب البضاعة.
import { sum, divRound, assertInt } from './money.js';
import { lineAmount, packToBase, formatQty, unit as unitOf, QTY_SCALE } from './units.js';
import { signedQty, stockLevel, stockValue } from './stock.js';
import { formatInvoiceNumber } from './numbering.js';
import { DEFAULT_LOW_STOCK_THRESHOLD, EXPIRY_WARNING_DAYS, DEAD_STOCK_DAYS } from './features.js';

const DAY = 86400000;

// ---------- الشراء ----------
/** سطر شراء: الكمية بوحدة الشراء (قطعة أو كرتونة)، unit_cost تكلفة تلك الوحدة. */
export function purchaseLine(product, { pack = null, qty = QTY_SCALE, unitCost = null } = {}) {
  const factor = pack ? pack.factor : QTY_SCALE;
  return {
    key: `${product.id}:${pack ? pack.id : ''}`, product_id: product.id, unit_id: pack ? pack.id : null,
    name: pack ? `${product.name} (${pack.name})` : product.name, unit: pack ? pack.name : product.unit,
    factor, qty, unit_cost: Number.isSafeInteger(unitCost) ? unitCost : lineAmount(product.cost_price || 0, factor),
  };
}

export function purchaseTotal(lines) {
  return sum(lines, (l) => lineAmount(l.unit_cost, l.qty));
}

/**
 * يحوّل الشراء إلى سجلات: فاتورة شراء، سطورها، حركات دخول بتكلفة الوحدة الأساسية (تدخل في متوسط التكلفة)،
 * قيد على حساب المورّد، ودفعة خارجة إن دُفع نقدًا. paid: 'cash' | 'credit'.
 */
export function buildPurchase({ lines, supplierId = null, paid = 'cash', note = null, attachmentPath = null, branchId = null }, env) {
  if (!lines.length) throw new Error('أضف صنفًا واحدًا على الأقل');
  if (paid === 'credit' && !supplierId) throw new Error('اختر التاجر للشراء على الحساب');
  for (const l of lines) {
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw new Error(`كمية «${l.name}» غير صحيحة`);
    if (!Number.isSafeInteger(l.unit_cost) || l.unit_cost < 0) throw new Error(`تكلفة «${l.name}» غير صحيحة`);
  }
  const total = purchaseTotal(lines);
  const invoiceId = env.newId();
  const invoice = {
    id: invoiceId, number: formatInvoiceNumber(env.prefix, 'purchase', env.seq), seq: env.seq, type: 'purchase', status: 'final',
    supplier_id: supplierId, branch_id: branchId || null, currency: env.currency || 'ILS', subtotal: total, discount: 0, total, cost_total: total, fee_total: 0,
    paid: paid === 'cash' ? total : 0, note, attachment_path: attachmentPath, device_id: env.deviceId ?? null, created_at: env.now,
  };
  const invoiceLines = lines.map((l, position) => ({
    id: env.newId(), invoice_id: invoiceId, position, product_id: l.product_id, unit_id: l.unit_id, name: l.name, unit: l.unit,
    unit_factor: l.factor, qty: l.qty, unit_price: l.unit_cost, discount: 0, total: lineAmount(l.unit_cost, l.qty), unit_cost: l.unit_cost, created_at: env.now,
  }));
  const movements = lines.map((l) => ({
    id: env.newId(), product_id: l.product_id, branch_id: branchId || null, type: 'purchase', qty: signedQty('purchase', packToBase(l.qty, l.factor)),
    unit_cost: divRound(l.unit_cost * QTY_SCALE, l.factor), ref_type: 'invoice', ref_id: invoiceId, created_at: env.now,
  }));
  const supplierEntries = [];
  const payments = [];
  if (supplierId) supplierEntries.push({ id: env.newId(), supplier_id: supplierId, type: 'purchase', amount: total, invoice_id: invoiceId, note: invoice.number, created_at: env.now });
  if (paid === 'cash' && total > 0) {
    const pid = env.newId();
    payments.push({ id: pid, invoice_id: invoiceId, supplier_id: supplierId, cash_session_id: env.cashSessionId ?? null, direction: 'out', method_id: env.cashMethodId ?? null, method_kind: 'cash', amount: total, created_at: env.now });
    if (supplierId) supplierEntries.push({ id: env.newId(), supplier_id: supplierId, type: 'payment', amount: -total, invoice_id: invoiceId, payment_id: pid, created_at: env.now });
  }
  return { invoice, lines: invoiceLines, movements, supplierEntries, payments, total };
}

// ---------- النقل بين المخزن والمحل ----------
/**
 * نقل بضاعة من مكان إلى مكان: null = المحل (ما يُباع منه)، أو معرّف مخزن خارجي.
 * lines: [{ product_id, name, qty (بالوحدة الأساسية وبالألف), unit_cost, available }]
 * لكل صنف حركتان: خروج من المصدر ودخول إلى الوجهة بنفس التكلفة، يجمعهما ref_id واحد.
 */
export function buildTransfer({ lines, from = null, to = null, note = null }, env) {
  if ((from || null) === (to || null)) throw new Error('اختر مكانين مختلفين للنقل');
  if (!lines || !lines.length) throw new Error('أضف صنفًا واحدًا على الأقل');
  const transferId = env.newId();
  const movements = [];
  for (const l of lines) {
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw new Error(`كمية «${l.name}» غير صحيحة`);
    if (Number.isSafeInteger(l.available) && l.qty > l.available) throw new Error(`«${l.name}»: الكمية أكبر من الموجود`);
    const cost = Number.isSafeInteger(l.unit_cost) && l.unit_cost > 0 ? l.unit_cost : null;
    const base = { product_id: l.product_id, unit_cost: cost, ref_type: 'transfer', ref_id: transferId, note: note || null, created_at: env.now };
    movements.push({ ...base, id: env.newId(), branch_id: from || null, type: 'transfer_out', qty: signedQty('transfer_out', l.qty) });
    movements.push({ ...base, id: env.newId(), branch_id: to || null, type: 'transfer_in', qty: signedQty('transfer_in', l.qty) });
  }
  return { transferId, movements };
}

/**
 * سجل النقل من الحركات: كل عملية نقل (ref_id) مرة واحدة، الأحدث أولًا:
 * [{ id, at, from, to, items: [{ product_id, qty }], note }]
 */
export function transferHistory(movements) {
  const by = new Map();
  for (const m of movements) {
    if (m.ref_type !== 'transfer' || !m.ref_id) continue;
    const t = by.get(m.ref_id) || { id: m.ref_id, at: m.created_at, from: null, to: null, items: [], note: m.note || null };
    if (m.type === 'transfer_out') t.from = m.branch_id || null;
    if (m.type === 'transfer_in') { t.to = m.branch_id || null; t.items.push({ product_id: m.product_id, qty: m.qty }); }
    by.set(m.ref_id, t);
  }
  return [...by.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}

// ---------- التنبيهات ----------
export function thresholdOf(p) {
  return p.low_stock ?? DEFAULT_LOW_STOCK_THRESHOLD * QTY_SCALE;
}

/**
 * products: [{..., qty, last_sale_at}]. يرجع { out, low, expiring, dead } — كل صنف في قائمة واحدة على الأكثر
 * من (out, low)، وقد يظهر أيضًا في expiring أو dead.
 */
export function stockAlerts(products, { now = Date.now(), expiry = true } = {}) {
  const out = [], low = [], expiring = [], dead = [];
  const soon = new Date(now + EXPIRY_WARNING_DAYS * DAY).toISOString().slice(0, 10);
  const deadBefore = new Date(now - DEAD_STOCK_DAYS * DAY).toISOString();
  for (const p of products) {
    if (p.deleted) continue;
    const lvl = stockLevel(p.qty, thresholdOf(p));
    if (lvl === 'out') out.push(p); else if (lvl === 'low') low.push(p);
    if (expiry && p.expiry_date && p.qty > 0 && p.expiry_date <= soon) expiring.push(p);
    if (p.qty > 0 && p.created_at < deadBefore && (!p.last_sale_at || p.last_sale_at < deadBefore)) dead.push(p);
  }
  expiring.sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1));
  return { out, low, expiring, dead };
}

/** كمية مقترحة للطلب: حتى ضعف حدّ التنبيه (بوحدات كاملة). */
export function suggestedOrderQty(p) {
  const t = Math.max(thresholdOf(p), QTY_SCALE);
  const want = t * 2 - Math.max(0, p.qty);
  return Math.max(QTY_SCALE, Math.ceil(want / QTY_SCALE) * QTY_SCALE);
}

/** رسالة واتساب جاهزة للمورّد. items: [{ name, unit, qty }] */
export function reorderText({ shopName, supplierName = '', items }) {
  const lines = [`مرحبًا${supplierName ? ` ${supplierName}` : ''}،`, `طلبية ${shopName}:`];
  items.forEach((it, i) => lines.push(`${i + 1}. ${it.name} — ${formatQty(it.qty)} ${unitOf(it.unit).short}`));
  lines.push('شكرًا لك.');
  return lines.join('\n');
}

// ---------- الجرد ----------
/**
 * counted: [{ product_id, name, recorded (بالألف), actual (بالألف), unit_cost }]
 * يرجع السطور بالفرق وقيمته، وصافي قيمة الفرق (سالب = نقص).
 */
export function countSummary(counted) {
  const rows = counted.map((c) => {
    const diff = assertInt(c.actual, 'actual') - assertInt(c.recorded, 'recorded');
    return { ...c, diff, value: divRound(diff * (c.unit_cost || 0), QTY_SCALE) };
  });
  return { rows, changed: rows.filter((r) => r.diff !== 0), diffValue: sum(rows, (r) => r.value) };
}

// ---------- المساعد: متى يخلص كل صنف وكم تطلب ----------
export const VELOCITY_DAYS = 30; // نحسب سرعة البيع من آخر 30 يومًا
export const COVER_DAYS = 14;    // الطلبية تكفي أسبوعين
export const SOON_DAYS = 7;      // ننبّه إن كان يخلص خلال أسبوع

/**
 * sold: Map(product_id → الكمية المباعة بالوحدة الأساسية وبالألف في آخر windowDays، بعد طرح المرتجع).
 * يرجع [{ p, perDay (بالألف يوميًا), daysLeft, qty (المقترح بقطع كاملة) }] للأصناف التي تخلص خلال soonDays، الأقرب أولًا.
 * الصنف الجديد (أحدث من windowDays) تُحسب سرعته من عمره (7 أيام على الأقل) فلا تتضخم.
 */
export function reorderPlan(products, sold, { now = Date.now(), windowDays = VELOCITY_DAYS, coverDays = COVER_DAYS, soonDays = SOON_DAYS } = {}) {
  const out = [];
  for (const p of products) {
    if (p.deleted || p.parent_id) continue;
    const s = sold.get(p.id) || 0;
    if (s <= 0) continue;
    const age = p.created_at ? (now - Date.parse(p.created_at)) / DAY : windowDays;
    const days = Math.min(windowDays, Math.max(7, age));
    const perDay = s / days;
    const have = Math.max(0, p.qty || 0);
    const daysLeft = Math.floor(have / perDay);
    if (daysLeft > soonDays) continue;
    const want = Math.max(QTY_SCALE, Math.ceil((perDay * coverDays - have) / QTY_SCALE) * QTY_SCALE);
    out.push({ p, perDay: Math.round(perDay), daysLeft, qty: want });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || b.perDay - a.perDay);
}

/** البضاعة الراكدة مرتبة بقيمتها (المال المحبوس فيها): [{ p, value, days }] */
export function deadStock(products, { now = Date.now(), days = DEAD_STOCK_DAYS } = {}) {
  const before = new Date(now - days * DAY).toISOString();
  return products
    .filter((p) => !p.deleted && !p.parent_id && p.qty > 0 && p.created_at < before && (!p.last_sale_at || p.last_sale_at < before))
    .map((p) => ({ p, value: stockValue(p.qty, p.avg_cost ?? p.cost_price ?? 0), days: Math.floor((now - Date.parse(p.last_sale_at || p.created_at)) / DAY) }))
    .sort((a, b) => b.value - a.value);
}

/** نص قصير: «يخلص خلال 3 أيام» / «نفد» / «يخلص اليوم». */
export function daysLeftText(d) {
  if (d <= 0) return 'نفد أو يخلص اليوم';
  if (d === 1) return 'يخلص غدًا';
  if (d === 2) return 'يخلص خلال يومين';
  return `يخلص خلال ${d} أيام`;
}
