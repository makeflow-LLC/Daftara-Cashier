// منطق البيع النقي: السلة، الخصومات، الدفع المقسّم والرسوم، الباقي، الآجل، والمرتجع.
// كل المبالغ أعداد صحيحة بأصغر وحدة (أغورة)، والكميات بالألف. لا DOM ولا قاعدة بيانات.
import { divRound, percentOf, allocate, sum, assertInt } from './money.js';
import { lineAmount, packToBase, QTY_SCALE } from './units.js';
import { signedQty, knownCost } from './stock.js';
import { formatInvoiceNumber } from './numbering.js';

// ---------- السطور ----------
/**
 * سطر سلة من صنف (وعبوة اختيارية):
 *   factor     كم وحدة أساسية في الوحدة المباعة (بالألف): قطعة = 1000، كرتونة 24 = 24000
 *   unit_price سعر الوحدة المباعة، unit_cost تكلفتها (من متوسط التكلفة × factor)
 */
export function makeLine(product, { pack = null, qty = QTY_SCALE, avgCost = null, key = null } = {}) {
  const factor = pack ? pack.factor : QTY_SCALE;
  // متوسط التكلفة صفر = غير معروف (صنف بِيع قبل تسجيل بضاعته): نأخذ تكلفة بطاقة الصنف
  const baseCost = knownCost(avgCost, product.cost_price);
  const unitPrice = pack
    ? (Number.isSafeInteger(pack.sell_price) ? pack.sell_price : lineAmount(product.sell_price, factor))
    : product.sell_price;
  return {
    key: key || `${product.id}:${pack ? pack.id : ''}`,
    product_id: product.id,
    unit_id: pack ? pack.id : null,
    name: pack ? `${product.name} (${pack.name})` : product.name,
    unit: pack ? pack.name : product.unit,
    factor,
    qty,
    unit_price: unitPrice,
    unit_cost: lineAmount(baseCost, factor),
    discount: 0,
  };
}

export const CUSTOM_NAME = 'مبيعات متنوعة';

/**
 * سطر «مبلغ بلا صنف»: بيع فوري لخدمة أو شيء غير مسجّل (طباعة ورق بـ 5 شيكل) دون إضافة صنف.
 * لا صنف له فلا يمسّ المخزون، وتكلفته صفر. key فريد: كل مبلغ سطر مستقل.
 */
export function makeCustomLine({ name = '', amount, key }) {
  assertInt(amount, 'amount');
  if (amount <= 0) throw new RangeError('amount must be > 0');
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60) || CUSTOM_NAME;
  return { key: `custom:${key}`, product_id: null, unit_id: null, name: n, unit: 'piece', factor: QTY_SCALE, qty: QTY_SCALE, unit_price: amount, unit_cost: 0, discount: 0 };
}

/** إجمالي السطر بعد خصمه (لا يقل عن صفر). */
export function lineTotal(l) {
  return Math.max(0, lineAmount(l.unit_price, l.qty) - (l.discount || 0));
}

export function lineCost(l) {
  return lineAmount(l.unit_cost, l.qty);
}

/** يضيف سطرًا أو يزيد كمية سطر مطابق (نفس الصنف والعبوة والسعر). يرجع قائمة جديدة. */
export function addLine(lines, line) {
  const i = lines.findIndex((l) => l.key === line.key && l.unit_price === line.unit_price && !l.discount);
  if (i < 0) return [...lines, line];
  const next = lines.slice();
  next[i] = { ...next[i], qty: next[i].qty + line.qty };
  return next;
}

// ---------- الإجماليات ----------
/**
 * discount: { type: 'amount'|'percent', value } — percent بنقاط الأساس (1000 = 10%).
 * يرجع { subtotal, discount, total, cost, profit, count }.
 */
export function cartTotals(lines, discount = null, fees = 0) {
  const subtotal = sum(lines, lineTotal);
  let d = 0;
  if (discount && discount.value > 0) {
    d = discount.type === 'percent' ? percentOf(subtotal, Math.min(discount.value, 10000)) : discount.value;
  }
  d = Math.min(Math.max(0, d), subtotal);
  const total = subtotal - d;
  const cost = sum(lines, lineCost);
  return { subtotal, discount: d, total, cost, profit: total - cost - fees, count: lines.length };
}

// ---------- الدفع ----------
/**
 * دفعة: { method_id, kind: 'cash'|'transfer'|'credit', amount (بالعملة الأساسية), fee_bp,
 *         currency, amount_currency, rate }
 * cash قد يزيد عن المطلوب (الباقي يُرد للزبون).
 */
export function paymentSummary(total, payments) {
  const paid = sum(payments, (p) => p.amount);
  const fees = sum(payments, (p) => (p.kind === 'transfer' ? percentOf(p.amount, p.fee_bp || 0) : 0));
  const credit = sum(payments.filter((p) => p.kind === 'credit'), (p) => p.amount);
  const cash = sum(payments.filter((p) => p.kind === 'cash'), (p) => p.amount);
  const over = paid - total;
  const change = over > 0 ? Math.min(over, cash) : 0;
  return { paid, fees, credit, cash, change, remaining: Math.max(0, total - paid), overpaidNonCash: over > cash ? over - cash : 0 };
}

/** يرجع رسالة خطأ بالعربية أو null إن كان الدفع صالحًا. */
export function validatePayment(total, payments, customerId) {
  if (!payments.length) return 'اختر طريقة الدفع';
  for (const p of payments) {
    if (!Number.isSafeInteger(p.amount) || p.amount <= 0) return 'مبلغ الدفع غير صحيح';
  }
  const s = paymentSummary(total, payments);
  if (s.remaining > 0) return 'المبلغ المدفوع أقل من الإجمالي';
  if (s.overpaidNonCash > 0) return 'المدفوع بالتحويل أو الآجل أكثر من المطلوب';
  if (s.credit > 0 && !customerId) return 'اختر الزبون للبيع بالآجل';
  return null;
}

/** اسم يُكتب على فاتورة زبون عابر (بلا حساب): نص قصير نظيف أو null. */
export function cleanNote(v) {
  const n = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return n || null;
}

// ---------- بناء الفاتورة ----------
/**
 * يحوّل السلة والدفع إلى سجلات جاهزة للحفظ في معاملة واحدة (نقي: المعرّفات والوقت من الخارج).
 * env: { newId, now, prefix, seq, currency, cashSessionId, deviceId, userId }
 */
export function buildSale({ lines, discount = null, payments, customerId = null, note = null }, env) {
  // env.replaces: فاتورة تُعدَّل — الجديدة تأخذ رقمها وتاريخها وتشير إليها (الأصلية تُلغى في المعاملة نفسها)
  const replaces = env.replaces || null;
  if (!lines.length) throw new Error('السلة فارغة');
  for (const l of lines) assertInt(l.qty, 'qty');
  const pre = cartTotals(lines, discount);
  const err = validatePayment(pre.total, payments, customerId);
  if (err) throw new Error(err);
  const pay = paymentSummary(pre.total, payments);
  const totals = cartTotals(lines, discount, pay.fees);
  const invoiceId = env.newId();
  const invoice = {
    id: invoiceId,
    number: replaces ? replaces.number : formatInvoiceNumber(env.prefix, 'sale', env.seq),
    seq: replaces ? replaces.seq : env.seq,
    type: 'sale',
    status: 'final',
    customer_id: customerId,
    original_invoice_id: replaces ? replaces.id : null,
    currency: env.currency || 'ILS',
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    cost_total: totals.cost,
    fee_total: pay.fees,
    paid: totals.total - pay.credit,
    note: cleanNote(note),
    device_id: env.deviceId ?? null,
    created_at: replaces ? replaces.created_at : env.now,
    // المعدَّلة تبقى باسم من باعها (تقرير «حسب الموظف»)؛ من عدّلها مكتوب في سجل العمليات
    ...(replaces ? { created_by: replaces.created_by ?? null } : {}),
  };
  const invoiceLines = lines.map((l, position) => ({
    id: env.newId(), invoice_id: invoiceId, position, product_id: l.product_id, unit_id: l.unit_id, name: l.name, unit: l.unit,
    unit_factor: l.factor, qty: l.qty, unit_price: l.unit_price, discount: l.discount || 0, total: lineTotal(l), unit_cost: l.unit_cost,
    created_at: env.now,
  }));
  // الباقي يُخصم من النقد: المحفوظ هو ما دخل الدرج فعلًا
  let changeLeft = pay.change;
  const paymentRows = payments.map((p) => {
    let amount = p.amount;
    if (p.kind === 'cash' && changeLeft > 0) {
      const take = Math.min(changeLeft, amount);
      amount -= take;
      changeLeft -= take;
    }
    return {
      id: env.newId(), invoice_id: invoiceId, customer_id: p.kind === 'credit' ? customerId : null,
      cash_session_id: p.kind === 'cash' ? env.cashSessionId ?? null : null,
      direction: 'in', method_id: p.method_id ?? null, method_kind: p.kind, amount,
      fee: p.kind === 'transfer' ? percentOf(p.amount, p.fee_bp || 0) : 0,
      currency: p.currency || env.currency || 'ILS', amount_currency: p.amount_currency ?? null, rate: p.rate ?? null,
      created_at: env.now,
    };
  }).filter((p) => p.amount > 0);
  // سطر بلا صنف (مبلغ فوري) لا حركة مخزون له
  const movements = lines.filter((l) => l.product_id).map((l) => ({
    id: env.newId(), product_id: l.product_id, type: 'sale', qty: signedQty('sale', packToBase(l.qty, l.factor)),
    unit_cost: divRound(l.unit_cost * QTY_SCALE, l.factor), ref_type: 'invoice', ref_id: invoiceId, created_at: env.now,
  }));
  const customerEntries = pay.credit > 0 ? [{
    id: env.newId(), customer_id: customerId, type: 'sale_credit', amount: pay.credit, invoice_id: invoiceId,
    note: invoice.number, created_at: invoice.created_at,
  }] : [];
  return { invoice, lines: invoiceLines, payments: paymentRows, movements, customerEntries, change: pay.change, profit: totals.profit };
}

// ---------- المرتجع ----------
/** ما بيع وما رُجع من كل سطر: Map(lineKey → {line, sold, returned, returnable}). */
export function returnableLines(originalLines, previousReturnLines = []) {
  // سطر بلا صنف يُعرف باسمه وسعره
  const key = (l) => (l.product_id ? `${l.product_id}:${l.unit_id || ''}` : `custom:${l.name}:${l.unit_price}`);
  const returned = new Map();
  for (const r of previousReturnLines) returned.set(key(r), (returned.get(key(r)) || 0) + r.qty);
  const out = [];
  for (const l of originalLines) {
    const k = key(l);
    const already = Math.min(l.qty, returned.get(k) || 0);
    returned.set(k, (returned.get(k) || 0) - already);
    out.push({ line: l, sold: l.qty, returned: already, returnable: l.qty - already });
  }
  return out;
}

/** صافي كل سطر بعد توزيع خصم الفاتورة عليه (بلا ضياع أغورة). */
export function netLineTotals(invoice, lines) {
  const shares = allocate(invoice.discount || 0, lines.map((l) => l.total));
  return lines.map((l, i) => l.total - shares[i]);
}

/**
 * ما بقي دينًا على الزبون من هذه الفاتورة: ما بيع آجلًا − ما خُصم من دينه في مرتجعاتها السابقة.
 * previousReturns: فواتير المرتجع السابقة لها (total − paid = ما خُصم من الدين).
 */
export function creditLeft(original, previousReturns = []) {
  const sold = Math.max(0, (original.total || 0) - (original.paid || 0));
  return Math.max(0, sold - sum(previousReturns, (r) => Math.max(0, (r.total || 0) - (r.paid || 0))));
}

/** كيف يُرد مبلغ مرتجع: { credit: يُخصم من الدين, cash: يُرد نقدًا }. auto = كما دُفعت الفاتورة: الآجل أولًا. */
export function refundSplit(total, refund, left = 0) {
  if (refund === 'credit') return { credit: total, cash: 0 };
  if (refund === 'auto') { const credit = Math.min(total, Math.max(0, left)); return { credit, cash: total - credit }; }
  return { credit: 0, cash: total };
}

/**
 * مرتجع من فاتورة: picks = [{ line, qty }] (الكمية بالألف بوحدة السطر).
 * refund: 'cash' يُرد نقدًا، 'credit' يُخصم من دين الزبون،
 *         'auto' كما دُفعت: يُخصم من دينه ما بقي آجلًا من هذه الفاتورة (env.creditLeft) والباقي يُرد نقدًا.
 */
export function buildReturn(original, originalLines, picks, refund, env) {
  const chosen = picks.filter((p) => p.qty > 0);
  if (!chosen.length) throw new Error('اختر ما يُرجع');
  if (refund === 'credit' && !original.customer_id) throw new Error('الفاتورة بلا زبون: الإرجاع نقدًا فقط');
  if (original.status === 'void') throw new Error('هذه الفاتورة ملغاة');
  const nets = netLineTotals(original, originalLines);
  const invoiceId = env.newId();
  const lines = chosen.map((p, position) => {
    const i = originalLines.indexOf(p.line);
    if (i < 0) throw new Error('سطر غير موجود في الفاتورة');
    if (p.qty > p.line.qty) throw new Error('الكمية أكبر من المباع');
    const total = p.qty === p.line.qty ? nets[i] : divRound(nets[i] * p.qty, p.line.qty);
    return {
      id: env.newId(), invoice_id: invoiceId, position, product_id: p.line.product_id, unit_id: p.line.unit_id, name: p.line.name, unit: p.line.unit,
      unit_factor: p.line.unit_factor, qty: p.qty, unit_price: p.line.unit_price, discount: 0, total, unit_cost: p.line.unit_cost,
      created_at: env.now,
    };
  });
  const total = sum(lines, (l) => l.total);
  const cost = sum(lines, (l) => lineAmount(l.unit_cost, l.qty));
  const split = refundSplit(total, refund, original.customer_id ? env.creditLeft || 0 : 0);
  const invoice = {
    id: invoiceId, number: formatInvoiceNumber(env.prefix, 'sale_return', env.seq), seq: env.seq, type: 'sale_return', status: 'final',
    customer_id: original.customer_id || null, original_invoice_id: original.id, currency: original.currency,
    subtotal: total, discount: 0, total, cost_total: cost, fee_total: 0, paid: split.cash,
    note: `مرتجع من ${original.number}`, device_id: env.deviceId ?? null, created_at: env.now,
  };
  const movements = lines.filter((l) => l.product_id).map((l) => ({
    id: env.newId(), product_id: l.product_id, type: 'sale_return', qty: signedQty('sale_return', packToBase(l.qty, l.unit_factor)),
    unit_cost: divRound(l.unit_cost * QTY_SCALE, l.unit_factor), ref_type: 'invoice', ref_id: invoiceId, created_at: env.now,
  }));
  const payments = split.cash > 0 ? [{
    id: env.newId(), invoice_id: invoiceId, customer_id: original.customer_id || null, cash_session_id: env.cashSessionId ?? null,
    direction: 'out', method_id: env.cashMethodId ?? null, method_kind: 'cash', amount: split.cash, fee: 0, currency: original.currency, created_at: env.now,
  }] : [];
  const customerEntries = split.credit > 0 ? [{
    id: env.newId(), customer_id: original.customer_id, type: 'return_credit', amount: -split.credit, invoice_id: invoiceId,
    note: invoice.number, created_at: env.now,
  }] : [];
  return { invoice, lines, movements, payments, customerEntries, total, credit: split.credit, cash: split.cash };
}

// ---------- إلغاء الفاتورة وتعديلها ----------
// لا شيء يُمحى: الفاتورة تصير status = void (فتخرج من التقارير كأنها لم تكن)، وتُضاف حركات عكسية:
// البضاعة ترجع للمخزون، وما دُفع يخرج بطريقته نفسها، وقيد الدين يُلغى في كشف الزبون (void:<القيد>).
// التعديل = إلغاء + فاتورة جديدة بالرقم نفسه في معاملة واحدة (buildSale مع env.replaces).

/** سبب يمنع إلغاء الفاتورة أو تعديلها، أو null. returns: مرتجعاتها السابقة. */
export function voidProblem(invoice, returns = []) {
  if (!invoice || invoice.deleted) return 'الفاتورة غير موجودة';
  if (invoice.type !== 'sale') return 'الإلغاء والتعديل لفواتير البيع فقط';
  if (invoice.status === 'void') return 'هذه الفاتورة ملغاة من قبل';
  if (returns.length) return 'رُجعت بضاعة من هذه الفاتورة — أرجِع الباقي من «مرتجع وتبديل»';
  return null;
}

/**
 * الحركات العكسية لإلغاء فاتورة بيع (نقي). data: { invoice, lines, payments, entries } كما حُفظت.
 * env: { newId, now, cashSessionId }.
 * يرجع { movements, payments, customerEntries, refund: ما يُرد للزبون (نقدًا وتحويلًا), credit: ما نزل من دينه }.
 */
export function buildVoid({ invoice, lines, payments = [], entries = [] }, env) {
  const movements = lines.filter((l) => l.product_id).map((l) => ({
    id: env.newId(), product_id: l.product_id, type: 'sale_return', qty: signedQty('sale_return', packToBase(l.qty, l.unit_factor)),
    unit_cost: divRound(l.unit_cost * QTY_SCALE, l.unit_factor), ref_type: 'invoice', ref_id: invoice.id, note: `إلغاء ${invoice.number}`, created_at: env.now,
  }));
  const back = payments.filter((p) => p.direction === 'in' && p.amount > 0).map((p) => ({
    id: env.newId(), invoice_id: invoice.id, customer_id: p.customer_id ?? null,
    cash_session_id: p.method_kind === 'cash' ? env.cashSessionId ?? null : null,
    direction: 'out', method_id: p.method_id ?? null, method_kind: p.method_kind, amount: p.amount, fee: 0,
    currency: p.currency || invoice.currency, note: `إلغاء ${invoice.number}`, created_at: env.now,
  }));
  const customerEntries = entries.filter((e) => e.invoice_id === invoice.id && e.type === 'sale_credit' && e.amount > 0).map((e) => ({
    id: env.newId(), customer_id: e.customer_id, type: e.type, amount: -e.amount, invoice_id: invoice.id,
    note: `void:${e.id}`, created_at: env.now,
  }));
  return {
    movements, payments: back, customerEntries,
    refund: sum(back.filter((p) => p.method_kind !== 'credit'), (p) => p.amount),
    credit: sum(customerEntries, (e) => -e.amount),
  };
}

/** سطور فاتورة محفوظة ← سطور سلة (لتعديل الفاتورة): بالأسعار والخصومات والتكلفة كما بيعت. */
export function cartFromInvoice(invoice, lines) {
  return {
    lines: lines.map((l, i) => ({
      // ‎:custom في آخر المفتاح: العروض لا تغيّر سعر سطر بيع من قبل (domain/offers.js)
      key: `${l.product_id ? `${l.product_id}:${l.unit_id || ''}` : 'custom'}:edit${i}:custom`,
      product_id: l.product_id, unit_id: l.unit_id, name: l.name, unit: l.unit || 'piece',
      factor: l.unit_factor || QTY_SCALE, qty: l.qty, unit_price: l.unit_price, unit_cost: l.unit_cost || 0, discount: l.discount || 0,
    })),
    discount: invoice.discount > 0 ? { type: 'amount', value: invoice.discount } : null,
  };
}
