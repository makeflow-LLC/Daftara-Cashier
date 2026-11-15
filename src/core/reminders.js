// التذكير الدوري بالديون: يفحص الموعد عند فتح التطبيق وكل 10 دقائق وهو مفتوح.
//   «أرسل وحده»: يرسل SMS لكل من عليه دين (نسخة التحميل المباشر، بإذن الرسائل) ثم يُبلغ صاحب المحل.
//   «اسألني أولًا»: لافتة على الرئيسية تفتح قائمة التذكير ليراجعها ويرسل بضغطة.
import { scheduleSettings, isDue, periodKey, pickRecipients, daysSince, customersText } from '../domain/reminders.js';
import { renderSms } from '../domain/sms.js';
import { normalizePhone } from '../domain/ledger.js';

const GAP_MS = 1500; // مهلة بين رسالة وأخرى حتى لا تحظر الشركة الإرسال المتتابع

export function createReminders(app, { toast = () => {}, emit = () => {} } = {}) {
  let busy = false;
  const r = {
    due: null, // { count, total } حين يحين موعد «اسألني أولًا»
    settings: () => scheduleSettings(app.shop?.settings?.sms?.schedule),
    async save(patch) {
      const sms = app.shop?.settings?.sms || {};
      await app.updateShopSettings({ sms: { ...sms, schedule: { ...r.settings(), ...patch } } });
    },
    async recipients(s = r.settings(), now = Date.now()) {
      return pickRecipients(await app.customers.debtors(), s, now, (c) => !!normalizePhone(c.phone));
    },
    text(c, now = Date.now()) {
      const sms = app.sms.settings();
      return renderSms(sms.templates.reminder, {
        name: c.name, balance: c.balance, shop: app.shop?.name, currency: app.shop?.base_currency || 'ILS', days: daysSince(c.oldestUnpaidAt, now),
      });
    },
    /** يرسل SMS للقائمة واحدًا تلو الآخر. onProgress(i, total). يرجع { sent, failed }. */
    async sendAll(list, onProgress = () => {}) {
      const n = globalThis.Capacitor?.Plugins?.CashierSms;
      if (!n) throw new Error('no sms');
      let sent = 0, failed = 0;
      for (let i = 0; i < list.length; i++) {
        try { await n.send({ phone: normalizePhone(list[i].phone), text: r.text(list[i]) }); sent++; } catch { failed++; }
        onProgress(i + 1, list.length);
        if (i < list.length - 1) await new Promise((res) => setTimeout(res, GAP_MS));
      }
      return { sent, failed };
    },
    /** يسجّل أن تذكير هذه الفترة تمّ (أو تُخطّي) حتى لا يتكرر. */
    async markDone(count, note = null) {
      const s = r.settings();
      const now = Date.now();
      await r.save({ lastRun: periodKey(now, s.freq), log: [{ at: new Date(now).toISOString(), count, note }, ...s.log].slice(0, 12) });
      r.due = null;
      emit();
    },
    /** يُستدعى عند الفتح والعودة وكل 10 دقائق. */
    async check() {
      if (busy || !app.shop) return;
      const s = r.settings();
      const now = Date.now();
      if (!isDue(s, now)) { if (r.due) { r.due = null; emit(); } return; }
      busy = true;
      try {
        const list = await r.recipients(s, now);
        if (!list.length) { await r.markDone(0, 'لا أحد عليه دين يستحق التذكير'); return; }
        const total = list.reduce((t, c) => t + c.balance, 0);
        if (s.mode === 'auto' && app.sms.canAuto && (await app.sms.permission())) {
          toast(`نرسل تذكيرًا بالديون إلى ${customersText(list.length)}…`);
          const res = await r.sendAll(list);
          await r.markDone(res.sent, res.failed ? `${res.failed} لم تُرسل` : null);
          toast(`أُرسل تذكير الديون إلى ${customersText(res.sent)} ✓${res.failed ? ` — ${res.failed} لم تُرسل` : ''}`, { kind: res.failed ? 'error' : 'ok', ms: 5000 });
          return;
        }
        r.due = { count: list.length, total };
        emit();
      } finally { busy = false; }
    },
    start() {
      setTimeout(() => r.check(), 3000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) r.check(); });
      setInterval(() => r.check(), 10 * 60 * 1000);
    },
  };
  return r;
}
