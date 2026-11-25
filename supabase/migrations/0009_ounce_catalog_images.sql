-- 1) وحدة «أوقية» (ربع كيلو): أصناف تُسعَّر وتُباع بالأوقية لا بالكيلو (بهارات، مكسرات، قهوة…).
-- 2) كتالوج المحل للزبائن: صورة الصنف إن وُجدت (اختيارية).
-- آمن لإعادة التشغيل.

alter table public.cashier_products drop constraint if exists cashier_products_unit_check;
alter table public.cashier_products add constraint cashier_products_unit_check
  check (unit in ('piece', 'meter', 'kg', 'ounce', 'gram', 'liter'));

-- هل كتالوج هذا المحل مفتوح للعموم؟ (لسياسة الصور أدناه؛ لا تكشف شيئًا غير نعم/لا)
create or replace function public.cashier_catalog_open(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cashier_shops
                 where id = p_shop and not deleted and coalesce((settings->'catalog'->>'enabled')::boolean, false));
$$;
revoke all on function public.cashier_catalog_open(uuid) from public;
grant execute on function public.cashier_catalog_open(uuid) to anon, authenticated;

-- صور الأصناف فقط (<shop_id>/products/…) تُقرأ بلا تسجيل دخول، وفقط ما دام صاحب المحل مشغّلًا الكتالوج.
-- الشعار وصور فواتير الموردين وكل مجلد آخر تبقى خاصة، ولا كتابة لغير أهل المحل.
drop policy if exists cashier_media_catalog on storage.objects;
create policy cashier_media_catalog on storage.objects for select to anon
  using (bucket_id = 'cashier-media' and (storage.foldername(name))[2] = 'products'
         and public.cashier_catalog_open(public.cashier_try_uuid((storage.foldername(name))[1])));

-- الكتالوج نفسه كما في 0006، مع 'image': مسار أول صورة للصنف (أو null)
create or replace function public.cashier_shop_catalog(p_shop uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select id, name, phone, address, base_currency, settings
    from cashier_shops
    where id = p_shop and not deleted and coalesce((settings->'catalog'->>'enabled')::boolean, false)
  ),
  st as (
    select product_id, sum(qty) as q from cashier_inventory_movements
    where shop_id = p_shop and exists (select 1 from s) group by product_id
  ),
  im as (
    select distinct on (product_id) product_id, path from cashier_product_images
    where shop_id = p_shop and exists (select 1 from s) and not deleted and path <> ''
    order by product_id, position, created_at
  ),
  ps as (
    select p.id, p.name, p.sell_price, p.unit, p.category_id, coalesce(st.q, 0) > 0 as available, im.path as image
    from cashier_products p left join st on st.product_id = p.id left join im on im.product_id = p.id
    where p.shop_id = p_shop and exists (select 1 from s) and not p.deleted and p.parent_id is null and p.sell_price > 0
  )
  select case when exists (select 1 from s) then jsonb_build_object(
    'name', s.name, 'phone', s.phone, 'address', s.address, 'currency', s.base_currency,
    'message', s.settings->'catalog'->>'message',
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.name), '[]'::jsonb)
                   from cashier_categories c where c.shop_id = p_shop and not c.deleted),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'price', x.sell_price, 'unit', x.unit,
                   'category_id', x.category_id, 'available', x.available, 'image', x.image) order by x.name), '[]'::jsonb)
                 from (select * from ps
                       where ps.available or not coalesce((s.settings->'catalog'->>'hideOutOfStock')::boolean, false)
                       order by ps.name limit 3000) x)
  ) end
  from s
  union all select null where not exists (select 1 from s)
  limit 1;
$$;
revoke all on function public.cashier_shop_catalog(uuid) from public;
grant execute on function public.cashier_shop_catalog(uuid) to anon, authenticated;
