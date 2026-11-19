// مواعيد السداد للتجار: تُحفظ في إعدادات المحل (تتزامن بين أجهزته، وبلا تغيير في قاعدة الخادم).
// التنبيه داخل التطبيق: لافتة في الرئيسية وفي قسم التجار، ورسالة قصيرة مرة في اليوم عند فتح التطبيق.
import { dueAlerts, dueList, dueStatus, dueText, isDateKey, pruneDues, dateKey } from '../domain/dues.js';
import { formatMoney } from '../domain/currency.js';

const TOLD_KEY = 'cashier-dues-told';

export function createDues(app, { toast = () => {}, emit = () => {}, storage = globalThis.localStorage } = {}) {
  const d = {
    alerts: null, // { items, total, overdue } — ما يستحق التنبيه الآن
    map: () => app.shop?.settings?.supplierDue || {},
    get: (id) => { const v = d.map()[id]; return isDateKey(v) ? v : null; },

    /** يحدد موعد سداد التاجر، أو يلغيه (date = null). */
    async set(id, date) {
      if (date !== null && !isDateKey(date)) throw new Error('التاريخ غير صحيح');
      if ((d.get(id) || null) === date) return;
      const next = pruneDues({ ...d.map(), [id]: date }, await app.inventory.suppliers());
      if (date) next[id] = date; // يُحفظ حتى لو لم يُسجَّل الدين بعد (يُتجاهل ما دام الرصيد صفرًا)
      await app.updateShopSettings({ supplierDue: next });
      await d.refresh();
    },

    async list(now = Date.now()) {
      return dueList(await app.inventory.suppliers(), d.map(), now);
    },

    /** يعيد حساب التنبيهات (بعد دفعة، دين، تغيير موعد، مزامنة). */
    async refresh(now = Date.now()) {
      if (!app.shop) return null;
      const next = dueAlerts(await app.inventory.suppliers(), d.map(), now);
      const changed = JSON.stringify(next && next.items.map((s) => [s.id, s.due, s.balance])) !== JSON.stringify(d.alerts && d.alerts.items.map((s) => [s.id, s.due, s.balance]));
      d.alerts = next;
      if (changed) emit(next);
      return next;
    },

    /** نص التنبيه في سطر: «اليوم موعد سداد أبو خالد — 1,600 ₪» أو «3 دفعات للتجار مستحقة — المجموع …». */
    summary(a = d.alerts, currency = app.shop?.base_currency || 'ILS') {
      if (!a) return null;
      if (a.items.length === 1) {
        const s = a.items[0];
        const when = s.status.state === 'today' ? 'اليوم موعد سداد' : s.status.state === 'overdue' ? `${dueText(s.status)}: سداد` : `${dueText(s.status)} موعد سداد`;
        return { title: `${when} ${s.name}`, sub: `عليك له ${formatMoney(s.balance, currency)}`, supplierId: s.id };
      }
      const n = a.items.length;
      const many = n === 2 ? 'دفعتان للتجار حان موعدهما' : `${n} ${n <= 10 ? 'دفعات' : 'دفعة'} للتجار حان موعدها`;
      return { title: many, sub: `المجموع ${formatMoney(a.total, currency)}${a.overdue ? ` — ${a.overdue} متأخرة` : ''}`, supplierId: null };
    },

    /** عند الفتح والعودة: يحدّث التنبيهات، ويذكّر برسالة مرة واحدة في اليوم. */
    async check(now = Date.now()) {
      const a = await d.refresh(now);
      if (!a) return;
      const today = dateKey(now);
      let told = null;
      try { told = storage.getItem(TOLD_KEY); } catch { /* */ }
      if (told === today) return;
      try { storage.setItem(TOLD_KEY, today); } catch { /* */ }
      const s = d.summary(a);
      toast(`${s.title} — ${s.sub}`, { kind: a.overdue ? 'error' : 'info', ms: 6000 });
    },

    start() {
      d.refresh().catch(() => {}); // اللافتات فورًا؛ والرسالة بعد أن يفتح التطبيق ويهدأ
      setTimeout(() => d.check().catch(() => {}), 2500);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) d.check().catch(() => {}); });
      setInterval(() => d.check().catch(() => {}), 30 * 60 * 1000); // يوم جديد والتطبيق مفتوح
    },
  };
  return d;
}

export { dueStatus, dueText };
