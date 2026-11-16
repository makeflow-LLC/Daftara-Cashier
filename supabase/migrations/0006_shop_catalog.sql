-- كتالوج المحل للزبائن (رابط واتساب): صفحة عامة تعرض أصناف المحل وأسعارها فيطلب الزبون على واتساب.
-- دالة قراءة فقط، تعمل بلا تسجيل دخول (anon) لكن فقط إن شغّل صاحب المحل الكتالوج (settings.catalog.enabled).
-- لا تكلفة ولا كميات ولا زبائن ولا أي شيء غير: اسم المحل وهاتفه وعنوانه، والأصناف (اسم، سعر، وحدة، تصنيف، متوفر أم لا).
-- رابط المحل = معرّفه (UUID عشوائي من الجهاز)، فلا يُخمَّن. آمن لإعادة التشغيل.
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
  ps as (
    select p.id, p.name, p.sell_price, p.unit, p.category_id, coalesce(st.q, 0) > 0 as available
    from cashier_products p left join st on st.product_id = p.id
    where p.shop_id = p_shop and exists (select 1 from s) and not p.deleted and p.parent_id is null and p.sell_price > 0
  )
  select case when exists (select 1 from s) then jsonb_build_object(
    'name', s.name, 'phone', s.phone, 'address', s.address, 'currency', s.base_currency,
    'message', s.settings->'catalog'->>'message',
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.name), '[]'::jsonb)
                   from cashier_categories c where c.shop_id = p_shop and not c.deleted),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'price', x.sell_price, 'unit', x.unit,
                   'category_id', x.category_id, 'available', x.available) order by x.name), '[]'::jsonb)
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
