// الصندوق على الجهاز: فتح اليوم (اختياري)، الملخص الحي، والإغلاق. البيع لا يتوقف أبدًا على فتح الصندوق:
// بلا فتح، تُحسب الفترة من أول اليوم بنقد افتتاحي صفر.
import { sessionSummary, closingResult } from '../../domain/cash.js';
import { startOfDay } from '../../core/queries.js';

export function createCashRepo({ db, store, getContext, clock }) {
  const repo = {
    async openSession() {
      return (await db.cash_sessions.orderBy('opened_at').reverse().limit(10).toArray()).find((s) => !s.deleted && !s.closed_at) || null;
    },
    /** آخر إغلاق (لاقتراح نقد أول اليوم = ما بقي في الدرج). */
    async lastClosed() {
      return (await db.cash_sessions.orderBy('opened_at').reverse().limit(20).toArray()).filter((s) => !s.deleted && s.closed_at)
        .sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1))[0] || null;
    },
    /** الفترة الحالية: الجلسة المفتوحة، أو افتراضية من آخر إغلاق اليوم/أول اليوم. */
    async current() {
      const open = await repo.openSession();
      if (open) return { session: open, virtual: false, since: open.opened_at, opening: open.opening_cash };
      const last = await repo.lastClosed();
      const day = startOfDay().toISOString();
      const since = last && last.closed_at > day ? last.closed_at : day;
      return { session: null, virtual: true, since, opening: 0 };
    },
    async summary() {
      const cur = await repo.current();
      const [payments, methods] = await Promise.all([db.payments.where('created_at').aboveOrEqual(cur.since).toArray(), db.payment_methods.toArray()]);
      return { ...cur, ...sessionSummary({ opening: cur.opening, payments, methodNames: new Map(methods.map((m) => [m.id, m.name])) }) };
    },
    async open(openingCash) {
      if (!Number.isSafeInteger(openingCash) || openingCash < 0) throw new Error('اكتب المبلغ الموجود في الدرج');
      if (await repo.openSession()) throw new Error('الصندوق مفتوح من قبل');
      return store.put('cash_sessions', { opened_at: clock(), opening_cash: openingCash, device_id: getContext().deviceId });
    },
    /** يغلق الصندوق بالمبلغ المعدود. يرجع { session, summary, difference, state }. */
    async close(counted, note = null) {
      if (!Number.isSafeInteger(counted) || counted < 0) throw new Error('اكتب المبلغ الذي عددته في الدرج');
      const s = await repo.summary();
      const r = closingResult(s.expectedCash, counted);
      const now = clock();
      const expected = { cash: s.expectedCash, credit: s.credit };
      for (const m of s.methods) expected[m.key] = m.total;
      const base = s.session || { opened_at: s.since, opening_cash: 0, device_id: getContext().deviceId };
      const session = await store.put('cash_sessions', { ...base, closed_at: now, expected, counted: { cash: counted }, difference: r.difference, note });
      return { session: { ...session, counted_cash: counted }, summary: s, ...r };
    },
    async history(limit = 30) {
      return (await db.cash_sessions.orderBy('opened_at').reverse().limit(limit * 2).toArray()).filter((s) => !s.deleted && s.closed_at).slice(0, limit);
    },
  };
  return repo;
}
