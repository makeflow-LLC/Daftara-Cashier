// ناقل أحداث صغير: الوحدات لا تعرف بعضها، تتواصل عبر أحداث بأسماء ثابتة.
//   'data'   {tables, source}   تغيّرت بيانات (محليًا أو من المزامنة)
//   'shop'   shop               تغيّر المحل أو إعداداته أو ميزاته
//   'sync'   status             حالة المزامنة
const handlers = new Map();

export const bus = {
  on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    return () => handlers.get(evt).delete(fn);
  },
  emit(evt, payload) {
    for (const fn of handlers.get(evt) || []) {
      try { fn(payload); } catch (e) { console.error(`bus ${evt}`, e); }
    }
  },
};
