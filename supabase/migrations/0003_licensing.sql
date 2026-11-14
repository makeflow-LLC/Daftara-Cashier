-- ================= دفترة كاشير — الترخيص على الخادم =================
-- يُشغَّل بعد 0001 و 0002. آمن لإعادة التشغيل.
--
-- الفكرة: الخادم هو الحَكَم. محل بلا اشتراك سارٍ (ولا تجربة سارية) يقرأ بياناته فقط، ولا يُقبل منه أي رفع.
-- فمن يعدّل كود التطبيق ليتجاوز الفحص لا يحصل على مزامنة ولا نسخ سحابي ولا جهاز ثانٍ.
--
--  * التجربة 30 يومًا، ومرتبطة بالجهاز أيضًا (cashier_device_trials): إعادة التثبيت لا تجدّدها.
--  * التفعيل: إمّا من هنا (جدول cashier_licenses) أو بكود موقَّع من MakeFlow يُسجَّل عبر cashier_license_redeem.
--  * مهلة 3 أيام بعد انتهاء الاشتراك المدفوع.
--
-- إدارة (SQL Editor):
--   تفعيل شهر:  update cashier_licenses set plan='monthly', is_active=true, expires_at=greatest(now(), coalesce(expires_at, now())) + interval '1 month', updated_at=now() where shop_id='…';
--   تفعيل سنة:  … + interval '1 year' …  plan='yearly'
--   إيقاف محل:  update cashier_licenses set is_active=false, updated_at=now() where shop_id='…';
--   كل المحلات:  select s.name, s.phone, l.plan, l.is_active, l.trial_ends_at, l.expires_at from cashier_licenses l join cashier_shops s on s.id=l.shop_id order by l.updated_at desc;
-- =====================================================================

create table if not exists public.cashier_device_trials (
  device_key text primary key check (device_key ~ '^[0-9A-Za-z-]{8,64}$'),
  first_seen timestamptz not null default now(),
  shop_id    uuid
);
alter table public.cashier_device_trials enable row level security;
revoke all on public.cashier_device_trials from anon, authenticated;

-- هل للمحل تجربة سارية أو اشتراك سارٍ (مع مهلة 3 أيام)؟
create or replace function public.cashier_license_ok(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select l.is_active and greatest(coalesce(l.expires_at, 'epoch'::timestamptz) + interval '3 days',
                                    coalesce(l.trial_ends_at, 'epoch'::timestamptz)) > now()
    from cashier_licenses l where l.shop_id = p_shop), false);
$$;

create or replace function public.cashier_can_write(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cashier_is_member(p_shop) and public.cashier_license_ok(p_shop);
$$;

-- الكتابة (إدراج وتعديل) في كل جداول المحل تشترط الترخيص؛ القراءة تبقى للعضو دائمًا.
do $$
declare t record;
begin
  for t in
    select * from (values
      ('cashier_shops', 'lww'), ('cashier_branches', 'lww'), ('cashier_categories', 'lww'),
      ('cashier_products', 'lww'), ('cashier_product_units', 'lww'), ('cashier_product_images', 'lww'),
      ('cashier_price_history', 'append'), ('cashier_customers', 'lww'), ('cashier_customer_entries', 'append'),
      ('cashier_suppliers', 'lww'), ('cashier_supplier_entries', 'append'), ('cashier_payment_methods', 'lww'),
      ('cashier_invoices', 'lww'), ('cashier_invoice_lines', 'append'), ('cashier_payments', 'append'),
      ('cashier_inventory_movements', 'append'), ('cashier_stock_counts', 'lww'),
      ('cashier_cash_sessions', 'lww'), ('cashier_expenses', 'lww'), ('cashier_audit_log', 'append')
    ) as x(tbl, mode)
  loop
    execute format('drop policy if exists member_insert on public.%I', t.tbl);
    execute format('create policy member_insert on public.%I for insert to authenticated
                    with check (public.cashier_can_write(shop_id))', t.tbl);
    if t.mode = 'lww' then
      execute format('drop policy if exists member_update on public.%I', t.tbl);
      execute format('create policy member_update on public.%I for update to authenticated
                      using (public.cashier_is_member(shop_id)) with check (public.cashier_can_write(shop_id))', t.tbl);
    end if;
  end loop;
end $$;

drop policy if exists cashier_media_insert on storage.objects;
create policy cashier_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cashier-media' and public.cashier_can_write(public.cashier_try_uuid((storage.foldername(name))[1])));
drop policy if exists cashier_media_update on storage.objects;
create policy cashier_media_update on storage.objects for update to authenticated
  using (bucket_id = 'cashier-media' and public.cashier_can_write(public.cashier_try_uuid((storage.foldername(name))[1])));

-- التجربة 30 يومًا
create or replace function public.cashier_create_shop(
  p_id uuid, p_name text, p_type text, p_currency text default 'ILS', p_trial_days integer default 30
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from cashier_shops where id = p_id) then
    if not cashier_is_member(p_id) then
      raise exception 'shop belongs to another account' using errcode = '42501';
    end if;
  else
    insert into cashier_shops (id, shop_id, name, shop_type, base_currency, updated_at)
    values (p_id, p_id, p_name, coalesce(p_type, 'other'), coalesce(p_currency, 'ILS'), 'epoch');
    insert into cashier_shop_members (shop_id, user_id, role) values (p_id, uid, 'owner');
    insert into cashier_licenses (shop_id, plan, trial_ends_at)
    values (p_id, 'trial', now() + make_interval(days => least(greatest(coalesce(p_trial_days, 30), 0), 30)));
  end if;
  return jsonb_build_object('shop_id', p_id, 'role', cashier_role(p_id));
end $$;

-- التطبيق يسأل: ما حال اشتراكي؟ (ويسجّل الجهاز: من جرّب سابقًا لا تتجدد تجربته)
create or replace function public.cashier_license_checkin(p_shop uuid, p_device_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fs timestamptz;
begin
  if not cashier_is_member(p_shop) then raise exception 'not a member' using errcode = '42501'; end if;
  if p_device_key ~ '^[0-9A-Za-z-]{8,64}$' then
    insert into cashier_device_trials (device_key, shop_id) values (p_device_key, p_shop) on conflict (device_key) do nothing;
    select first_seen into fs from cashier_device_trials where device_key = p_device_key;
    update cashier_licenses set trial_ends_at = fs + interval '30 days', updated_at = now()
    where shop_id = p_shop and (trial_ends_at is null or trial_ends_at > fs + interval '30 days');
  end if;
  return (select jsonb_build_object('is_active', l.is_active, 'plan', l.plan, 'expires_at', l.expires_at,
                                    'trial_ends_at', l.trial_ends_at, 'server_now', now())
          from cashier_licenses l where l.shop_id = p_shop);
end $$;

-- ---------------------------------------------------------------------------
-- التحقق من توقيع Ed25519 بـ PL/pgSQL (نفس خوارزمية خادم دفترة، بأسماء هذا التطبيق)
-- ---------------------------------------------------------------------------
-- المفتاح العام لـ MakeFlow (نفسه في التطبيق: src/core/license.js). الخاص عند MakeFlow وحدها.
create or replace function public.cashier_license_pubkey() returns bytea
language sql immutable as $$ select decode('LQAGz2YjhZJjLP4/6d91+KqTvqbopt+6rH4Lhumxsqc=', 'base64') $$;

create or replace function public.cashier_ed_le(b bytea) returns numeric
language plpgsql immutable as $$
declare n numeric := 0;
begin
  for i in reverse length(b) - 1 .. 0 loop
    n := n * 256 + get_byte(b, i);
  end loop;
  return n;
end $$;

create or replace function public.cashier_ed_modpow(b numeric, e numeric, m numeric) returns numeric
language plpgsql immutable as $$
declare r numeric := 1;
begin
  b := b % m;
  while e > 0 loop
    if e % 2 = 1 then r := (r * b) % m; end if;
    b := (b * b) % m;
    e := div(e, 2);
  end loop;
  return r;
end $$;

-- جمع نقطتين على المنحنى (إحداثيات ممتدة، صيغة موحّدة تصلح للمضاعفة أيضًا)
create or replace function public.cashier_ed_add(
  x1 numeric, y1 numeric, z1 numeric, t1 numeric,
  x2 numeric, y2 numeric, z2 numeric, t2 numeric,
  out x3 numeric, out y3 numeric, out z3 numeric, out t3 numeric)
language plpgsql immutable as $$
declare
  p  constant numeric := 57896044618658097711785492504343953926634992332820282019728792003956564819949;
  d2 constant numeric := (2 * 37095705934669439343138083508754565189542113879843219016388785533085940283555) % p;
  a numeric; b numeric; c numeric; d numeric; e numeric; f numeric; g numeric; h numeric;
begin
  a := ((y1 - x1 + p) * (y2 - x2 + p)) % p;
  b := ((y1 + x1) * (y2 + x2)) % p;
  c := (((t1 * d2) % p) * t2) % p;
  d := (2 * z1 * z2) % p;
  e := (b - a + p) % p;
  f := (d - c + p) % p;
  g := (d + c) % p;
  h := (b + a) % p;
  x3 := (e * f) % p;
  y3 := (g * h) % p;
  t3 := (e * h) % p;
  z3 := (f * g) % p;
end $$;

create or replace function public.cashier_ed25519_verify(msg bytea, sig bytea, pub bytea) returns boolean
language plpgsql immutable as $$
declare
  p    constant numeric := 57896044618658097711785492504343953926634992332820282019728792003956564819949;
  d    constant numeric := 37095705934669439343138083508754565189542113879843219016388785533085940283555;
  l    constant numeric := 7237005577332262213973186563042994240857116359379907606001950938285454250989;
  sqm1 constant numeric := 19681161376707505956807079304988542015446066515923890162744021073123829784752;
  gx   constant numeric := 15112221349535400772501151409588531511454012693041857206046113283949847762202;
  gy   constant numeric := 46316835694926478169428394003475163141307993866256225615783033603165251855960;
  top  constant numeric := p + 19;   -- 2^255
  ay numeric; ax numeric; asign integer; u numeric; v numeric; v3 numeric; v7 numeric; chk numeric;
  ry numeric; rsign integer; s numeric; h numeric;
  sb integer[] := '{}'; hb integer[] := '{}';
  nax numeric; nat numeric; bt numeric;
  qx numeric := 0; qy numeric := 1; qz numeric := 1; qt numeric := 0;
  zinv numeric; x numeric; y numeric;
begin
  if msg is null or sig is null or pub is null or length(sig) <> 64 or length(pub) <> 32 then
    return false;
  end if;

  -- المفتاح العام A: فك الضغط
  ay := cashier_ed_le(pub);
  asign := get_byte(pub, 31) >> 7;
  if asign = 1 then ay := ay - top; end if;
  if ay >= p then return false; end if;
  u := (ay * ay - 1 + p) % p;
  v := (d * ay % p * ay + 1) % p;
  v3 := v * v % p * v % p;
  v7 := v3 * v3 % p * v % p;
  ax := (u * v3 % p) * cashier_ed_modpow(u * v7 % p, div(p - 5, 8), p) % p;
  chk := v * ax % p * ax % p;
  if chk = u then
    null;
  elsif chk = (p - u) % p then
    ax := ax * sqm1 % p;
  else
    return false;
  end if;
  if (ax % 2)::integer <> asign then ax := (p - ax) % p; end if;

  -- التوقيع: R (نقطة مضغوطة) ثم S
  ry := cashier_ed_le(substring(sig from 1 for 32));
  rsign := get_byte(sig, 31) >> 7;
  if rsign = 1 then ry := ry - top; end if;
  if ry >= p then return false; end if;
  s := cashier_ed_le(substring(sig from 33 for 32));
  if s >= l then return false; end if;
  h := cashier_ed_le(sha512(substring(sig from 1 for 32) || pub || msg)) % l;

  for i in 1 .. 253 loop
    sb[i] := (s % 2)::integer; s := div(s, 2);
    hb[i] := (h % 2)::integer; h := div(h, 2);
  end loop;

  -- Q = [S]B + [h](-A)، ويجب أن يساوي R
  nax := (p - ax) % p;
  nat := nax * ay % p;
  bt := gx * gy % p;
  for i in reverse 253 .. 1 loop
    select a.x3, a.y3, a.z3, a.t3 into qx, qy, qz, qt from cashier_ed_add(qx, qy, qz, qt, qx, qy, qz, qt) a;
    if sb[i] = 1 then
      select a.x3, a.y3, a.z3, a.t3 into qx, qy, qz, qt from cashier_ed_add(qx, qy, qz, qt, gx, gy, 1, bt) a;
    end if;
    if hb[i] = 1 then
      select a.x3, a.y3, a.z3, a.t3 into qx, qy, qz, qt from cashier_ed_add(qx, qy, qz, qt, nax, ay, 1, nat) a;
    end if;
  end loop;

  zinv := cashier_ed_modpow(qz, p - 2, p);
  x := qx * zinv % p;
  y := qy * zinv % p;
  return y = ry and (x % 2)::integer = rsign;
end $$;


create or replace function public.cashier_b64url(p text) returns bytea
language sql immutable as $$
  select decode(translate(p, '-_', '+/') || repeat('=', (4 - length(p) % 4) % 4), 'base64');
$$;

-- يسجّل كود تفعيل موقَّعًا (DCS-…): يتحقق من التوقيع ويمدّ الاشتراك حتى تاريخ الكود.
create or replace function public.cashier_license_redeem(p_shop uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  parts text[]; payload text; fields text[]; until timestamptz;
begin
  if not cashier_is_member(p_shop) then raise exception 'not a member' using errcode = '42501'; end if;
  if p_code !~ '^DCS-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then raise exception 'bad code' using errcode = '22023'; end if;
  parts := string_to_array(substr(p_code, 5), '.');
  payload := convert_from(cashier_b64url(parts[1]), 'UTF8');
  fields := string_to_array(payload, '|');
  if array_length(fields, 1) <> 3 or fields[2] !~ '^\d{8}$' then raise exception 'bad code' using errcode = '22023'; end if;
  if not cashier_ed25519_verify(convert_to('cashier-license-v1|' || payload, 'UTF8'), cashier_b64url(parts[2]), cashier_license_pubkey()) then
    raise exception 'bad signature' using errcode = '42501';
  end if;
  until := to_timestamp(fields[2] || ' 23:59:59', 'YYYYMMDD HH24:MI:SS');
  update cashier_licenses
  set expires_at = greatest(coalesce(expires_at, 'epoch'::timestamptz), until),
      plan = case when fields[3] = 'y' then 'yearly' else 'monthly' end,
      source = 'code', note = fields[1], updated_at = now()
  where shop_id = p_shop;
  return (select jsonb_build_object('is_active', l.is_active, 'plan', l.plan, 'expires_at', l.expires_at,
                                    'trial_ends_at', l.trial_ends_at, 'server_now', now())
          from cashier_licenses l where l.shop_id = p_shop);
end $$;

-- نسخة Google Play: التطبيق يبلّغ أن الاشتراك سارٍ عند Google (يُمدّ 35 يومًا في كل مرة ما دام ساريًا).
-- ملاحظة: التحقق من Google نفسها (Play Developer API) يُضاف لاحقًا؛ هذا يثق بما يقوله التطبيق.
create or replace function public.cashier_license_play(p_shop uuid, p_token text, p_plan text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cashier_is_member(p_shop) then raise exception 'not a member' using errcode = '42501'; end if;
  if length(coalesce(p_token, '')) < 20 then raise exception 'bad token' using errcode = '22023'; end if;
  update cashier_licenses
  set expires_at = greatest(coalesce(expires_at, 'epoch'::timestamptz), now() + interval '35 days'),
      plan = case when p_plan = 'yearly' then 'yearly' else 'monthly' end,
      source = 'play', play_token = p_token, updated_at = now()
  where shop_id = p_shop;
  return (select jsonb_build_object('is_active', l.is_active, 'plan', l.plan, 'expires_at', l.expires_at,
                                    'trial_ends_at', l.trial_ends_at, 'server_now', now())
          from cashier_licenses l where l.shop_id = p_shop);
end $$;

revoke all on function public.cashier_license_checkin(uuid, text) from public, anon;
revoke all on function public.cashier_license_redeem(uuid, text) from public, anon;
revoke all on function public.cashier_license_play(uuid, text, text) from public, anon;
grant execute on function public.cashier_license_checkin(uuid, text) to authenticated;
grant execute on function public.cashier_license_redeem(uuid, text) to authenticated;
grant execute on function public.cashier_license_play(uuid, text, text) to authenticated;
