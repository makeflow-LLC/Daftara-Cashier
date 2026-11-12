-- اختبارات المخطط: العزل بين المحلات، آخر تعديل يفوز، الإضافة فقط، الأجهزة، الكتالوج، التخزين.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set S1 '''11111111-1111-1111-1111-111111111111'''
\set S2 '''22222222-2222-2222-2222-222222222222'''

create or replace function pg_temp.expect_error(q text, label text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'EXPECTED ERROR but succeeded: %', label;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' then raise; end if;
  raise notice 'ok (blocked): % — %', label, sqlerrm;
end $$;

create or replace function pg_temp.check(ok boolean, label text) returns text language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'CHECK FAILED: %', label; end if;
  return 'ok: ' || label;
end $$;

set role authenticated;

-- ===== المستخدم A ينشئ المحل S1 ويكتب فيه
select set_config('request.jwt.claim.sub', :A, false);
select public.cashier_create_shop(:S1, 'بقالة أبو أحمد', 'grocery');
select public.cashier_create_shop(:S1, 'بقالة أبو أحمد', 'grocery');  -- مكرر: لا يفشل
do $$ begin assert (select count(*) from cashier_licenses) = 1, 'license row'; end $$;
do $$ begin assert (select plan from cashier_licenses) = 'trial', 'trial'; end $$;

-- رفع المحل نفسه بعد الإنشاء (updated_at أحدث من epoch)
insert into cashier_shops (id, shop_id, name, shop_type, updated_at)
values (:S1, :S1, 'بقالة أبو أحمد', 'grocery', '2026-01-01T10:00:00Z')
on conflict (id) do update set name = excluded.name, updated_at = excluded.updated_at;
do $$ begin assert (select updated_at from cashier_shops) = '2026-01-01T10:00:00Z', 'shop pushed'; end $$;

insert into cashier_products (id, shop_id, name, sell_price, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', :S1, 'سكر', 500, '2026-01-01T10:00:00Z')
on conflict (id) do update set name = excluded.name, sell_price = excluded.sell_price, updated_at = excluded.updated_at;

-- آخر تعديل يفوز: تعديل أقدم يُتجاهل
insert into cashier_products (id, shop_id, name, sell_price, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', :S1, 'سكر قديم', 400, '2026-01-01T09:00:00Z')
on conflict (id) do update set name = excluded.name, sell_price = excluded.sell_price, updated_at = excluded.updated_at;
do $$ begin assert (select sell_price from cashier_products) = 500, 'older edit ignored'; end $$;
select server_seq as seq1 from cashier_products \gset
-- تعديل أحدث يُطبَّق ويرفع server_seq
insert into cashier_products (id, shop_id, name, sell_price, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', :S1, 'سكر', 550, '2026-01-02T09:00:00Z')
on conflict (id) do update set name = excluded.name, sell_price = excluded.sell_price, updated_at = excluded.updated_at;
do $$ begin assert (select sell_price from cashier_products) = 550, 'newer edit applied'; end $$;
select server_seq as seq2 from cashier_products \gset
select pg_temp.check(:seq2 > :seq1, 'server_seq increases');
-- نفس السجل تمامًا: لا يتغيّر server_seq
insert into cashier_products (id, shop_id, name, sell_price, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', :S1, 'سكر', 550, '2026-01-02T09:00:00Z')
on conflict (id) do update set name = excluded.name, sell_price = excluded.sell_price, updated_at = excluded.updated_at;
select pg_temp.check((select server_seq from cashier_products) = :seq2, 'no-op keeps seq');

select pg_temp.check((select (heads->>'cashier_products')::bigint from cashier_shop_heads) = :seq2, 'shop heads track products');

-- إضافة فقط: الحركة مرتين = مرة واحدة، ولا تعديل
insert into cashier_inventory_movements (id, shop_id, product_id, type, qty, unit_cost)
values ('00000000-0000-0000-0000-0000000000b1', :S1, '00000000-0000-0000-0000-0000000000a1', 'purchase', 10000, 300)
on conflict (id) do nothing;
insert into cashier_inventory_movements (id, shop_id, product_id, type, qty, unit_cost)
values ('00000000-0000-0000-0000-0000000000b1', :S1, '00000000-0000-0000-0000-0000000000a1', 'purchase', 99999, 300)
on conflict (id) do nothing;
do $$ begin assert (select sum(qty) from cashier_inventory_movements) = 10000, 'append idempotent'; end $$;
select pg_temp.expect_error($q$update cashier_inventory_movements set qty = 1$q$, 'update append-only');
select pg_temp.expect_error($q$delete from cashier_products$q$, 'hard delete');
select pg_temp.expect_error($q$insert into cashier_inventory_movements (id, shop_id, product_id, type, qty) values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'gift', 1)$q$, 'bad movement type');

-- الأجهزة: A للجهاز الأول، B للثاني، ونفس الجهاز يحتفظ بحرفه
do $$ begin
  assert public.cashier_register_device('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001', 'جوال 1', 'A') = 'A', 'first device A';
  assert public.cashier_register_device('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000002', 'جوال 2', 'A') = 'B', 'second device B';
  assert public.cashier_register_device('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001', null, null) = 'A', 'same device keeps A';
end $$;

-- الكتالوج المشترك
select public.cashier_catalog_contribute('[{"barcode":"7290000000017","name":"سكر  السلطان"},{"barcode":"x","name":"bad"}]');
select public.cashier_catalog_contribute('[{"barcode":"7290000000017","name":"سكر السلطان"}]');
do $$ begin assert (select name from public.cashier_catalog_lookup(array['7290000000017'])) = 'سكر السلطان', 'catalog lookup'; end $$;
select pg_temp.expect_error($q$select * from cashier_barcode_catalog$q$, 'catalog table not directly readable');

-- التخزين في مجلد المحل فقط
insert into storage.objects (bucket_id, name) values ('cashier-media', '11111111-1111-1111-1111-111111111111/products/x.webp');

-- ===== المستخدم B: محل آخر، لا يرى ولا يكتب في S1
select set_config('request.jwt.claim.sub', :B, false);
select public.cashier_create_shop(:S2, 'ملابس', 'clothing');
do $$ begin assert (select count(*) from cashier_products) = 0, 'B sees no S1 products'; end $$;
do $$ begin assert (select count(*) from cashier_shops) = 1, 'B sees only own shop'; end $$;
do $$ begin assert (select count(*) from cashier_inventory_movements) = 0, 'B sees no S1 movements'; end $$;
do $$ begin assert (select count(*) from storage.objects) = 0, 'B sees no S1 images'; end $$;
do $$ begin assert (select count(*) from cashier_shop_heads where shop_id = '11111111-1111-1111-1111-111111111111') = 0, 'B sees no S1 heads'; end $$;
select pg_temp.expect_error($q$insert into cashier_products (id, shop_id, name) values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'hack')$q$, 'B writes into S1');
select pg_temp.expect_error($q$insert into cashier_products (id, shop_id, name, updated_at) values ('00000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'steal', '2030-01-01') on conflict (id) do update set shop_id = excluded.shop_id, name = excluded.name, updated_at = excluded.updated_at$q$, 'B overwrites S1 row by id');
select pg_temp.expect_error($q$select public.cashier_create_shop('11111111-1111-1111-1111-111111111111', 'x', 'other')$q$, 'B claims S1');
select pg_temp.expect_error($q$select public.cashier_register_device('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'x')$q$, 'B registers device in S1');
select pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('cashier-media', '11111111-1111-1111-1111-111111111111/products/y.webp')$q$, 'B uploads into S1 folder');
select pg_temp.expect_error($q$insert into cashier_shops (id, shop_id, name) values ('33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'direct')$q$, 'shop without RPC');
select pg_temp.expect_error($q$update cashier_licenses set plan = 'lifetime'$q$, 'member edits license');
do $$ begin assert (select name from public.cashier_catalog_lookup(array['7290000000017'])) = 'سكر السلطان', 'catalog shared across shops'; end $$;

-- ===== بلا تسجيل دخول (anon)
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_error($q$select * from cashier_products$q$, 'anon reads products');
select pg_temp.expect_error($q$select public.cashier_catalog_lookup(array['7290000000017'])$q$, 'anon catalog');
reset role;
\echo ALL SCHEMA TESTS PASSED
