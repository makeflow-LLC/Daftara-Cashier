// رسائل SMS للزبائن: تلقائيًا عند دين أو دفعة أو بيع آجل (إن شغّلها صاحب المحل)، أو يدويًا من صفحة الزبون.
// الإرسال التلقائي في نسخة التحميل المباشر فقط (إضافة CashierSms)؛ غيرها يفتح تطبيق الرسائل جاهزًا.
import { smsSettings, renderSms } from '../domain/sms.js';
import { normalizePhone } from '../domain/ledger.js';

export function createSms(app, { toast = () => {} } = {}) {
  const native = () => (globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins.CashierSms : null) || null;

  const sms = {
    /** هل يستطيع هذا الجهاز الإرسال تلقائيًا؟ */
    get canAuto() { return !!native(); },
    settings: () => smsSettings(app.shop?.settings?.sms),
    async save(next) { await app.updateShopSettings({ sms: next }); },
    async permission() {
      const n = native();
      if (!n) return false;
      try { return !!(await n.status()).granted; } catch { return false; }
    },
    async requestPermission() {
      const n = native();
      if (!n) return false;
      try { return !!(await n.request()).granted; } catch { return false; }
    },
    /** نص الرسالة لزبون بعد حدث (الرصيد بعد الحركة). */
    async text(kind, customer, amount = 0) {
      const s = sms.settings();
      const balance = await app.customers.balance(customer.id);
      return renderSms(s.templates[kind], {
        name: customer.name, amount, balance, shop: app.shop?.name, currency: app.shop?.base_currency || 'ILS',
      });
    },
    /** يُستدعى بعد دين/دفعة/بيع آجل. لا يفعل شيئًا إن كانت الميزة أو هذا الحدث مطفأة. */
    async notify(kind, customer, amount) {
      const s = sms.settings();
      const n = native();
      if (!s.enabled || !s.events[kind] || !n || !customer) return false;
      const c = (await app.db.customers.get(customer.id)) || customer;
      const phone = normalizePhone(c.phone);
      if (!phone) return false;
      try {
        if (!(await sms.permission())) return false;
        const text = await sms.text(kind, c, amount);
        await n.send({ phone, text });
        toast(`أُرسلت رسالة SMS إلى ${c.name}`, { kind: 'ok' });
        return true;
      } catch (e) {
        console.warn('sms', e);
        toast('لم تُرسل رسالة SMS — تأكد من رصيد الشريحة', { kind: 'error' });
        return false;
      }
    },
  };
  return sms;
}
