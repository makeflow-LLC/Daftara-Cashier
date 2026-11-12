// قاعدة البيانات على الجهاز (IndexedDB عبر Dexie): هي مصدر الحقيقة للواجهة.
// الجداول المتزامنة بنفس أعمدة الخادم (src/sync/tables.js). وجداول محلية فقط:
//   outbox   ما ينتظر الرفع (سجل واحد لكل سجل مُعدَّل، بآخر نسخة)
//   meta     إعدادات الجهاز: معرّفه وحرفه، المحل، عدّادات الفواتير، مؤشرات السحب، جلسة الدخول
//   stock    مخزون كل صنف محسوب من الحركات (ذاكرة مؤقتة تُعاد من الحركات في أي وقت)
//   held     سلال البيع المعلّقة (لهذا الجهاز فقط)
//   files    صور تنتظر الرفع، ونسخ مصغّرة للعرض بلا إنترنت
// لا نفهرس قيمًا منطقية (true/false) لأن IndexedDB لا يفهرسها.

export const DB_NAME = 'daftara-cashier';

export function createDb(Dexie, name = DB_NAME) {
  const db = new Dexie(name);
  db.version(1).stores({
    shops: 'id',
    branches: 'id',
    categories: 'id, sort',
    payment_methods: 'id, sort',
    products: 'id, barcode, category_id, name, updated_at',
    product_units: 'id, product_id, barcode',
    product_images: 'id, product_id',
    price_history: 'id, product_id, batch_id, created_at',
    customers: 'id, name, phone',
    suppliers: 'id, name',
    invoices: 'id, number, type, customer_id, supplier_id, created_at',
    invoice_lines: 'id, invoice_id, product_id',
    payments: 'id, invoice_id, customer_id, supplier_id, cash_session_id, created_at',
    customer_entries: 'id, customer_id, created_at',
    supplier_entries: 'id, supplier_id, created_at',
    movements: 'id, product_id, created_at, [ref_type+ref_id]',
    stock_counts: 'id',
    cash_sessions: 'id, opened_at',
    expenses: 'id, spent_at',
    audit_log: 'id, created_at',
    // محلية فقط
    outbox: '++seq, &key, table',
    meta: 'key',
    stock: 'product_id',
    held: 'id, created_at',
    files: 'id, kind, state',
  });
  return db;
}
