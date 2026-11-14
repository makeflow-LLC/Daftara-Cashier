// الميزات الاختيارية ونوع المحل. كل ميزة اختيارية تُفعَّل وتُطفأ من الإعدادات،
// وحين تُطفأ تختفي تمامًا من الواجهة. عند الإعداد الأول يختار صاحب المحل نوعه
// فنفعّل ما يناسبه فقط.

export const FEATURES = Object.freeze({
  units:        { name: 'البيع بالمتر والوزن والعبوات', hint: 'متر، كيلو، غرام، لتر، وكرتونة = عدة قطع' },
  expiry:       { name: 'تواريخ الانتهاء', hint: 'تنبيه قبل انتهاء الصلاحية بـ 30 يومًا' },
  images:       { name: 'صور الأصناف', hint: 'صورة للصنف تظهر في البيع والقوائم' },
  multiCurrency:{ name: 'عملات إضافية', hint: 'دولار ودينار بسعر صرف تحدده أنت' },
  splitPayment: { name: 'تقسيم الدفع', hint: 'جزء نقدًا وجزء تحويل أو آجل' },
  labels:       { name: 'ملصقات الباركود', hint: 'طباعة باركود داخلي للأصناف بلا باركود' },
  stockCount:   { name: 'جرد المخزون', hint: 'عدّ البضاعة ومقارنتها بالمسجّل' },
  quickItems:   { name: 'أزرار البيع السريع', hint: 'أصناف بلا باركود بضغطة واحدة' },
});

export const SHOP_TYPES = Object.freeze({
  grocery:     { name: 'بقالة وسوبرماركت', icon: 'basket',
                 on: ['units', 'expiry', 'images', 'splitPayment', 'labels', 'stockCount', 'quickItems'] },
  clothing:    { name: 'ملابس وأحذية', icon: 'shirt',
                 on: ['images', 'splitPayment', 'labels', 'stockCount'] },
  fabrics:     { name: 'أقمشة', icon: 'ruler',
                 on: ['units', 'images', 'splitPayment', 'labels', 'stockCount', 'quickItems'] },
  accessories: { name: 'إكسسوارات جوالات', icon: 'phone',
                 on: ['images', 'multiCurrency', 'splitPayment', 'labels', 'stockCount'] },
  pharmacy:    { name: 'صيدلية', icon: 'pill',
                 on: ['units', 'expiry', 'splitPayment', 'stockCount'] },
  other:       { name: 'محل آخر', icon: 'store',
                 on: ['units', 'images', 'splitPayment', 'labels', 'stockCount', 'quickItems'] },
});

/** خريطة الميزات الافتراضية لنوع محل: { units: true, expiry: false, ... } */
export function presetFor(shopType) {
  const t = SHOP_TYPES[shopType] || SHOP_TYPES.other;
  const out = {};
  for (const key of Object.keys(FEATURES)) out[key] = t.on.includes(key);
  return out;
}

/** يدمج إعدادات محفوظة مع الافتراضي (ميزة جديدة تُضاف في نسخة لاحقة تأخذ قيمة نوع المحل). */
export function resolveFeatures(shopType, saved = {}) {
  const base = presetFor(shopType);
  for (const key of Object.keys(base)) if (typeof saved[key] === 'boolean') base[key] = saved[key];
  return base;
}

/** طرق الدفع الافتراضية لمحل جديد. fee_bp رسوم بنقاط الأساس (100 = 1%). */
export function defaultPaymentMethods() {
  return [
    { key: 'cash', name: 'نقدًا', kind: 'cash', fee_bp: 0 },
    { key: 'bank', name: 'تحويل بنكي', kind: 'transfer', fee_bp: 0 },
    { key: 'wallet', name: 'محفظة إلكترونية', kind: 'transfer', fee_bp: 0 },
    { key: 'credit', name: 'آجل (دين)', kind: 'credit', fee_bp: 0 },
  ];
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const EXPIRY_WARNING_DAYS = 30;
export const DEAD_STOCK_DAYS = 60;
export const TRIAL_DAYS = 30; // المرجع: domain/license.js
