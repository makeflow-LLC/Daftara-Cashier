// تسجيل ما استُلم بالمحفظة بعد أن يتأكد صاحب المحل من وصوله (لا اكتشاف تلقائي: لا صلاحية SMS).
// يُسجَّل تحويلًا بطريقة دفع باسم المحفظة («جوال باي»)، فيظهر في الصندوق تحت اسمها ولا يدخل الدرج.
import { WALLETS } from '../../domain/wallet.js';

export const WALLET_NOTE = 'استلام بالمحفظة (QR)';

export function createWalletRepo({ db, store, customers }) {
  const repo = {
    /** طريقة الدفع باسم المحفظة: الموجودة، أو تُنشأ عند أول استلام. */
    async method(walletId) {
      const w = WALLETS[walletId];
      if (!w) throw new Error('محفظة غير معروفة');
      const all = (await db.payment_methods.toArray()).filter((m) => !m.deleted && m.kind === 'transfer');
      // الاسم كما في المحافظ الجاهزة (domain/features.js: «محفظة بال باي»، «جوال باي») أو المختصر
      const same = all.find((m) => w.methods.includes(m.name.trim()));
      if (same) return same;
      return store.put('payment_methods', { name: w.methods[0], kind: 'transfer', fee_bp: 0, active: true, sort: 50 });
    },

    /**
     * يسجّل المبلغ (بأصغر وحدة للعملة). مع customerId: دفعة على حساب الزبون تنقص دينه.
     * بلا زبون: استلام حر من أي مشترٍ.
     */
    async receive({ walletId, amount, customerId = null }) {
      if (!Number.isSafeInteger(amount) || amount <= 0) throw Object.assign(new Error('invalid'), { errors: { amount: 'اكتب المبلغ' } });
      const method = await repo.method(walletId);
      if (customerId) return customers.recordPayment(customerId, amount, method);
      return store.append('payments', {
        direction: 'in', method_id: method.id, method_kind: 'transfer', amount, cash_session_id: null, note: WALLET_NOTE,
      });
    },
  };
  return repo;
}
