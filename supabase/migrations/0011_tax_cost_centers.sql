-- الضريبة ومراكز التكلفة. آمن لإعادة التشغيل.
--  * tax: ضريبة القيمة المضافة في الفاتورة (بيع، مرتجع، شراء، مرتجع شراء). جزء من total؛ صفر لمن لا يعمل بالضريبة.
--    إعداد الضريبة نفسه (النسبة، شاملة أم مضافة، رقم المشتغل المرخّص) في cashier_shops.settings.tax.
--  * cost_center: مركز التكلفة (قسم، فرع، سيارة، مشروع) لمصروف أو سند. المراكز نفسها في cashier_shops.settings.costCenters،
--    وإيراد كل مركز من تصنيفات الأصناف المربوطة به — فلا عمود في الفواتير.

alter table public.cashier_invoices add column if not exists tax bigint not null default 0;
alter table public.cashier_expenses add column if not exists cost_center uuid;
alter table public.cashier_vouchers add column if not exists cost_center uuid;
