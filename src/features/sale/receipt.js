// الفاتورة كما يراها الزبون: تظهر مباشرة بعد كل بيع، وتُفتح لاحقًا من سجل الفواتير.
// لا تكلفة ولا ربح هنا أبدًا (الشاشة قد يراها الزبون). المشاركة عبر واتساب تأتي في المرحلة 5.
import { h, num } from '../../ui/dom.js';
import { money, button } from '../../ui/components.js';
import { openSheet } from '../../ui/overlay.js';
import { formatQty } from '../../domain/units.js';
import { formatMoney } from '../../domain/currency.js';
import { app } from '../../core/app.js';

const TITLES = { sale: 'فاتورة بيع', sale_return: 'فاتورة مرتجع', purchase: 'فاتورة شراء', purchase_return: 'مرتجع شراء' };

/** يبني عنصر الفاتورة (يُستعمل للعرض الآن، وللصورة و PDF في المرحلة 5). */
export async function buildReceipt(invoiceId) {
  const { invoice, lines } = await app.sales.invoice(invoiceId);
  const cur = invoice.currency;
  const [payments, methods, customer, logo] = await Promise.all([
    app.db.payments.where('invoice_id').equals(invoiceId).toArray(),
    app.db.payment_methods.toArray(),
    invoice.customer_id ? app.db.customers.get(invoice.customer_id) : null,
    app.media.logoUrl(),
  ]);
  const methodName = new Map(methods.map((m) => [m.id, m.name]));
  const shop = app.shop || {};
  const when = new Date(invoice.created_at);
  const kv = (label, value, cls = '') => h('div', { class: `rc-kv ${cls}`.trim() }, h('span', null, label), value);
  return h('div', { class: 'receipt' },
    h('div', { class: 'rc-head' },
      logo ? h('img', { class: 'rc-logo', src: logo, alt: '' }) : null,
      h('div', { class: 'rc-shop' }, shop.name || ''),
      shop.phone ? h('div', { class: 'rc-sub num' }, shop.phone) : null,
      shop.address ? h('div', { class: 'rc-sub' }, shop.address) : null,
    ),
    h('div', { class: 'rc-meta' },
      h('span', null, TITLES[invoice.type] || 'فاتورة', ' ', num(invoice.number)),
      num(`${when.toLocaleDateString('en-GB')} ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`),
    ),
    customer ? h('div', { class: 'rc-cust' }, 'الزبون: ', customer.name) : null,
    h('div', { class: 'rc-lines' }, ...lines.map((l) => h('div', { class: 'rc-line' },
      h('div', { class: 'rc-name' }, l.name),
      h('div', { class: 'rc-calc' },
        h('span', null, num(formatQty(l.qty)), ' × ', num(formatMoney(l.unit_price, cur, { symbol: false })),
          l.discount ? [' − ', num(formatMoney(l.discount, cur, { symbol: false }))] : null),
        money(l.total, cur)),
    ))),
    h('div', { class: 'rc-totals' },
      invoice.discount ? kv('المجموع', money(invoice.subtotal, cur)) : null,
      invoice.discount ? kv('الخصم', money(-invoice.discount, cur)) : null,
      kv('الإجمالي', money(invoice.total, cur), 'rc-total'),
      ...payments.map((p) => kv(p.method_kind === 'credit' ? 'آجل (على الحساب)' : (methodName.get(p.method_id) || 'نقدًا'), money(p.amount, cur))),
    ),
    h('div', { class: 'rc-foot' }, 'شكرًا لتعاملكم معنا'),
  );
}

/** يعرض الفاتورة في ورقة، وزر واحد كبير للمتابعة. */
export async function showReceipt(invoiceId, { doneLabel = 'بيع جديد', doneIcon = 'scan', onClose = null } = {}) {
  const el = await buildReceipt(invoiceId);
  return openSheet((close) => h('div', null, el,
    h('div', { class: 'rc-actions' }, button(doneLabel, { block: true, size: 'lg', icon: doneIcon, onclick: close })),
  ), { title: null, onClose });
}
