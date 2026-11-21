// الشاشة العريضة (حاسوب، تابلت بالعرض): قائمة جانبية بدل الشريط السفلي، وجداول بأعمدة بدل قوائم الجوال.
// الحد نفسه في styles/app.css (@media min-width:1000px) — غيّرهما معًا.
export const WIDE_QUERY = '(min-width:1000px)';

const mq = () => (globalThis.matchMedia ? globalThis.matchMedia(WIDE_QUERY) : null);

export function isWide() {
  const m = mq();
  return !!(m && m.matches);
}

/** fn() حين يعبر عرض النافذة الحد (تكبير/تصغير النافذة، تدوير التابلت). */
export function onWideChange(fn) {
  const m = mq();
  if (!m) return () => {};
  if (m.addEventListener) { m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); }
  m.addListener(fn); // سفاري أقدم من 14
  return () => m.removeListener(fn);
}
