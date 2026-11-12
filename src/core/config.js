// إعدادات البناء: يكتبها scripts/build-www.mjs في www/config.js من متغيرات البيئة
// (SUPABASE_URL و SUPABASE_ANON_KEY) — لا شيء منها مكتوب في الكود.
// بدونها يعمل التطبيق كاملًا على الجهاز، والمزامنة متوقفة فقط.
const c = globalThis.CASHIER_CONFIG || {};

export const config = Object.freeze({
  supabaseUrl: c.supabaseUrl || '',
  supabaseAnonKey: c.supabaseAnonKey || '',
  flavor: c.flavor || 'web',        // direct | play | web
  version: c.version || 'dev',
  build: c.build || 0,
  get syncEnabled() { return !!(this.supabaseUrl && this.supabaseAnonKey); },
});
