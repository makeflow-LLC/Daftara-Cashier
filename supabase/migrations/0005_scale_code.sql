-- رقم الصنف في الميزان (PLU): ملصق الميزان (EAN-13 يبدأ بـ 20–29) فيه رقم الصنف والوزن أو السعر.
-- لمن شغّل 0001 قبل إضافة العمود. آمن لإعادة التشغيل.
alter table public.cashier_products add column if not exists scale_code text;
