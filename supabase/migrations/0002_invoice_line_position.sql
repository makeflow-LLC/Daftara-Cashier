-- ترتيب سطور الفاتورة كما في السلة (للطباعة والمرتجع). لمن شغّل 0001 قبل إضافة العمود. آمن لإعادة التشغيل.
alter table public.cashier_invoice_lines add column if not exists position smallint not null default 0;
