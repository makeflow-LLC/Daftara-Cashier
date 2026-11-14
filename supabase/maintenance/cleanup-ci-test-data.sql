-- يحذف البيانات التجريبية التي كتبها اختبار المحاكي في الخادم الحقيقي (14 نوفمبر 2026)،
-- قبل أن يُقطع عنه الإنترنت أثناء الاختبار. لا يلمس أي محل آخر ولا جداول دفترة.
-- Supabase Studio ← SQL Editor ← الصق ← Run

-- 1) ما الذي سيُحذف؟ (للاطمئنان)
select id, name, shop_type, created_at from public.cashier_shops
where name = 'Shop1' and created_at >= '2026-11-14' order by created_at;

-- 2) الحذف: كل بيانات هذه المحلات تُحذف معها تلقائيًا (أصناف، فواتير، حركات…)
begin;
delete from public.cashier_device_trials
where shop_id in (select id from public.cashier_shops where name = 'Shop1' and created_at >= '2026-11-14');
delete from public.cashier_shops where name = 'Shop1' and created_at >= '2026-11-14';
delete from public.cashier_barcode_catalog where barcode = '6291003000017' and name = 'Milk';
commit;

select 'تم حذف بيانات الاختبار ✓' as result;
