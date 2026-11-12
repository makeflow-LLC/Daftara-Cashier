// سجلّ الجداول المتزامنة: الاسم على الجهاز ↔ الاسم على الخادم، طريقة الدمج، والأعمدة بقيمها الافتراضية.
// الأعمدة هنا يجب أن تطابق supabase/migrations تمامًا (اختبار tests/schema.test.mjs يتحقق من ذلك).
// الترتيب مهم: الآباء قبل الأبناء عند الرفع.
//
// mode: 'lww'    آخر تعديل يفوز (updated_at)، والحذف علامة deleted
//       'append' إضافة فقط: لا تعديل ولا حذف ولا تعارض

const LWW = { created_at: null, updated_at: null, deleted: false };
const APPEND = { created_at: null };

export const TABLES = [
  { name: 'shops', remote: 'cashier_shops', mode: 'lww', columns: {
    id: null, shop_id: null, name: '', shop_type: 'other', phone: null, address: null, logo_path: null,
    base_currency: 'ILS', settings: {}, ...LWW } },
  { name: 'branches', remote: 'cashier_branches', mode: 'lww', columns: {
    id: null, shop_id: null, name: '', is_main: false, ...LWW } },
  { name: 'categories', remote: 'cashier_categories', mode: 'lww', columns: {
    id: null, shop_id: null, name: '', color: null, sort: 0, ...LWW } },
  { name: 'payment_methods', remote: 'cashier_payment_methods', mode: 'lww', columns: {
    id: null, shop_id: null, name: '', kind: 'cash', fee_bp: 0, active: true, sort: 0, ...LWW } },
  { name: 'products', remote: 'cashier_products', mode: 'lww', columns: {
    id: null, shop_id: null, name: '', barcode: null, internal_code: false, category_id: null, unit: 'piece',
    cost_price: 0, sell_price: 0, currency: 'ILS', low_stock: null, track_expiry: false, expiry_date: null,
    is_quick: false, quick_sort: 0, parent_id: null, variant: null, note: null, ...LWW } },
  { name: 'product_units', remote: 'cashier_product_units', mode: 'lww', columns: {
    id: null, shop_id: null, product_id: null, name: '', factor: 1000, barcode: null, sell_price: null, ...LWW } },
  { name: 'product_images', remote: 'cashier_product_images', mode: 'lww', columns: {
    id: null, shop_id: null, product_id: null, path: '', position: 0, width: null, height: null, bytes: null, ...LWW } },
  { name: 'price_history', remote: 'cashier_price_history', mode: 'append', columns: {
    id: null, shop_id: null, product_id: null, old_sell: null, new_sell: null, old_cost: null, new_cost: null,
    reason: null, batch_id: null, device_id: null, created_by: null, ...APPEND } },
  { name: 'customers', remote: 'cashier_customers', mode: 'lww', columns: {
    id: null, shop_id: null, name: '', phone: null, note: null, credit_limit: null, source: null, external_ref: null, ...LWW } },
  { name: 'suppliers', remote: 'cashier_suppliers', mode: 'lww', columns: {
    id: null, shop_id: null, name: '', phone: null, note: null, ...LWW } },
  { name: 'invoices', remote: 'cashier_invoices', mode: 'lww', columns: {
    id: null, shop_id: null, branch_id: null, device_id: null, number: '', seq: 0, type: 'sale', status: 'final',
    customer_id: null, supplier_id: null, original_invoice_id: null, currency: 'ILS', subtotal: 0, discount: 0,
    total: 0, cost_total: 0, fee_total: 0, paid: 0, note: null, attachment_path: null, created_by: null, ...LWW } },
  { name: 'invoice_lines', remote: 'cashier_invoice_lines', mode: 'append', columns: {
    id: null, shop_id: null, invoice_id: null, product_id: null, unit_id: null, name: '', unit: null,
    unit_factor: 1000, qty: 0, unit_price: 0, discount: 0, total: 0, unit_cost: 0, ...APPEND } },
  { name: 'payments', remote: 'cashier_payments', mode: 'append', columns: {
    id: null, shop_id: null, invoice_id: null, customer_id: null, supplier_id: null, cash_session_id: null,
    direction: 'in', method_id: null, method_kind: 'cash', amount: 0, fee: 0, currency: 'ILS',
    amount_currency: null, rate: null, note: null, device_id: null, created_by: null, ...APPEND } },
  { name: 'customer_entries', remote: 'cashier_customer_entries', mode: 'append', columns: {
    id: null, shop_id: null, customer_id: null, type: 'adjustment', amount: 0, invoice_id: null, payment_id: null,
    note: null, device_id: null, created_by: null, ...APPEND } },
  { name: 'supplier_entries', remote: 'cashier_supplier_entries', mode: 'append', columns: {
    id: null, shop_id: null, supplier_id: null, type: 'adjustment', amount: 0, invoice_id: null, payment_id: null,
    note: null, device_id: null, created_by: null, ...APPEND } },
  { name: 'movements', remote: 'cashier_inventory_movements', mode: 'append', columns: {
    id: null, shop_id: null, branch_id: null, product_id: null, type: 'adjustment', qty: 0, unit_cost: null,
    ref_type: null, ref_id: null, expiry_date: null, note: null, device_id: null, created_by: null, ...APPEND } },
  { name: 'stock_counts', remote: 'cashier_stock_counts', mode: 'lww', columns: {
    id: null, shop_id: null, branch_id: null, status: 'open', diff_value: 0, note: null, applied_at: null, ...LWW } },
  { name: 'cash_sessions', remote: 'cashier_cash_sessions', mode: 'lww', columns: {
    id: null, shop_id: null, branch_id: null, device_id: null, opened_at: null, opening_cash: 0, closed_at: null,
    expected: null, counted: null, difference: null, note: null, closed_by: null, ...LWW } },
  { name: 'expenses', remote: 'cashier_expenses', mode: 'lww', columns: {
    id: null, shop_id: null, branch_id: null, category: null, amount: 0, method_id: null, cash_session_id: null,
    note: null, attachment_path: null, spent_at: null, ...LWW } },
  { name: 'audit_log', remote: 'cashier_audit_log', mode: 'append', columns: {
    id: null, shop_id: null, user_id: null, device_id: null, action: '', entity: null, entity_id: null, data: null, ...APPEND } },
];

export const TABLE = Object.fromEntries(TABLES.map((t) => [t.name, t]));
export const SYNCED = TABLES.map((t) => t.name);

/** سجل كامل الأعمدة (للرفع): يملأ الناقص بالافتراضي ويُسقط ما ليس عمودًا على الخادم. */
export function toRemote(tableName, row) {
  const t = TABLE[tableName];
  const out = {};
  for (const [col, def] of Object.entries(t.columns)) {
    const v = row[col];
    out[col] = v === undefined ? (def && typeof def === 'object' ? JSON.parse(JSON.stringify(def)) : def) : v;
  }
  return out;
}

/** سجل جديد على الجهاز بكل أعمدته الافتراضية. */
export function blank(tableName, fields = {}) {
  return toRemote(tableName, fields);
}
