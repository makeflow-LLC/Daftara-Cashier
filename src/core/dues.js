// مواعيد الدفع للتجار: تُحفظ في إعدادات المحل settings.supplierDues = { [id]: { date, note } } (كما في الإصدارات
// المنشورة، فتبقى مواعيد المحلات كما هي) وتتزامن بين أجهزة المحل. المنطق في domain/dues.js.
// هنا: القراءة والحفظ، وتذكير برسالة قصيرة مرة في اليوم عند فتح التطبيق (والرئيسية تعرضها في التنبيهات).
import { supplierDues, dueSummary, pruneDues, isDay } from '../domain/dues.js';
import { localDay } from '../domain/offers.js';
import { formatMoney } from '../domain/currency.js';

const TOLD_KEY = 'cashier-dues-told';

export function createDues(app, { toast = () => {}, emit = () => {}, storage = globalThis.localStorage, today = () => localDay() } = {}) {
  const d = {
    map: () => app.shop?.settings?.supplierDues || {},
    /** { date, note } أو null */
    get: (id) => { const v = d.map()[id]; return v && isDay(v.date) ? v : null; },

    /** يحدد موعد الدفع للتاجر (مع ملاحظة اختيارية)، أو يلغيه (date = null). */
    async set(id, date, note = null) {
      if (date !== null && !isDay(date)) throw new Error('التاريخ غير صحيح');
      const cur = d.get(id);
      const clean = note ? String(note).trim() || null : null;
      if ((cur ? cur.date : null) === date && (cur ? cur.note || null : null) === clean) return;
      const next = pruneDues(d.map(), await app.inventory.suppliers(), id);
      if (date) next[id] = { date, note: clean }; else delete next[id];
      await app.updateShopSettings({ supplierDues: next });
      emit();
    },

    /** ما حان أو اقترب (خلال 3 أيام) ممن عليك لهم: قائمة supplierDues. */
    async due(day = today()) {
      if (!app.shop || (app.can && !app.can('purchases'))) return [];
      return supplierDues(await app.inventory.suppliers(), d.map(), day);
    },

    /** عند الفتح والعودة: يذكّر برسالة مرة واحدة في اليوم ما دام هناك موعد حان أو اقترب. */
    async check(day = today()) {
      const s = dueSummary(await d.due(day));
      if (!s) return null;
      let told = null;
      try { told = storage.getItem(TOLD_KEY); } catch { /* */ }
      if (told === day) return s;
      try { storage.setItem(TOLD_KEY, day); } catch { /* */ }
      const cur = app.shop?.base_currency || 'ILS';
      toast(`${s.title} — ${s.supplierId ? 'عليك له' : 'المجموع'} ${formatMoney(s.total, cur)}${!s.supplierId && s.overdue ? ` — ${s.overdue} متأخرة` : ''}`, { kind: s.overdue ? 'error' : 'info', ms: 6000 });
      return s;
    },

    start() {
      setTimeout(() => d.check().catch(() => {}), 2500);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) d.check().catch(() => {}); });
      setInterval(() => d.check().catch(() => {}), 30 * 60 * 1000); // يوم جديد والتطبيق مفتوح
    },
  };
  return d;
}
