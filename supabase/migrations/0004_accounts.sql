-- ================= دفترة كاشير — الدخول برقم الهاتف وكلمة سر (بلا رسائل SMS) =================
-- الأجهزة تدخل الخادم مجهولة (anonymous). صاحب المحل يضيف «رقم هاتف + كلمة سر» لمحله مرة واحدة،
-- وعلى جهاز جديد يدخل بهما فيصبح الجهاز عضوًا في المحل وتنزل بياناته كاملة.
--  * كلمة السر لا تُحفظ أبدًا، بل بصمتها (bcrypt عبر pgcrypto).
--  * بعد 5 محاولات خاطئة: انتظار يبدأ بـ 30 ثانية ويتضاعف (حتى 32 دقيقة) — التخمين غير عملي.
--  * نسيت كلمة السر؟ كود إعادة تعيين من MakeFlow: توقيع Ed25519 (نفس مفتاح الاشتراك) على الرقم
--    و«رقم الطلب» المشتق من البصمة الحالية، فيصلح الكود مرة واحدة فقط.
-- آمن لإعادة التشغيل.
-- ==============================================================================================

create table if not exists public.cashier_accounts (
  phone        text primary key check (phone ~ '^[0-9]{9,15}$'),
  shop_id      uuid not null references public.cashier_shops(id) on delete cascade,
  pass_hash    text not null,
  fails        integer not null default 0,
  locked_until timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists cashier_accounts_shop on public.cashier_accounts (shop_id);
alter table public.cashier_accounts enable row level security;
revoke all on public.cashier_accounts from anon, authenticated;

-- رقم الطلب لإعادة التعيين: مشتق من البصمة الحالية (يتغير بعد كل تغيير لكلمة السر)
create or replace function public.cashier_account_request(p_hash text) returns text
language sql immutable set search_path = public, extensions as $$
  select upper(substr(encode(digest('cashier-reset-req|' || p_hash, 'sha256'), 'hex'), 1, 4) || '-' ||
               substr(encode(digest('cashier-reset-req|' || p_hash, 'sha256'), 'hex'), 5, 4));
$$;

-- صاحب المحل يحمي محله برقم وكلمة سر (أو يغيّرهما). الجهاز عضو في المحل أصلًا.
create or replace function public.cashier_account_set(p_shop uuid, p_phone text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce(cashier_role(p_shop), '') <> 'owner' then raise exception 'not the owner' using errcode = '42501'; end if;
  if p_phone !~ '^[0-9]{9,15}$' then raise exception 'bad phone' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'short password' using errcode = '22023'; end if;
  if exists (select 1 from cashier_accounts where phone = p_phone and shop_id <> p_shop) then
    raise exception 'phone taken' using errcode = '23505';
  end if;
  delete from cashier_accounts where shop_id = p_shop and phone <> p_phone;
  insert into cashier_accounts (phone, shop_id, pass_hash)
  values (p_phone, p_shop, crypt(p_password, gen_salt('bf', 8)))
  on conflict (phone) do update set pass_hash = excluded.pass_hash, fails = 0, locked_until = null, updated_at = now();
  return jsonb_build_object('phone', p_phone);
end $$;

-- الرقم المحفوظ لمحلي (لأي جهاز عضو)
create or replace function public.cashier_account_get(p_shop uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when cashier_is_member(p_shop)
    then (select jsonb_build_object('phone', phone) from cashier_accounts where shop_id = p_shop) end;
$$;

-- الدخول من جهاز جديد: يرجع {ok, shop_id, name} أو {ok:false, reason:'bad'|'locked', wait}
-- (يرجع ولا يرمي خطأ، حتى يُحفظ عدّاد المحاولات الخاطئة)
create or replace function public.cashier_account_login(p_phone text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  a cashier_accounts%rowtype;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into a from cashier_accounts where phone = p_phone for update;
  if not found then
    perform pg_sleep(0.3);
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'wait', ceil(extract(epoch from a.locked_until - now())));
  end if;
  if crypt(coalesce(p_password, ''), a.pass_hash) <> a.pass_hash then
    update cashier_accounts set fails = fails + 1,
      locked_until = case when fails + 1 >= 5 then now() + make_interval(secs => 30 * power(2, least(fails + 1 - 5, 6))) end
    where phone = p_phone;
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  update cashier_accounts set fails = 0, locked_until = null where phone = p_phone;
  insert into cashier_shop_members (shop_id, user_id, role) values (a.shop_id, uid, 'owner')
  on conflict (shop_id, user_id) do nothing;
  return (select jsonb_build_object('ok', true, 'shop_id', s.id, 'name', s.name, 'shop_type', s.shop_type)
          from cashier_shops s where s.id = a.shop_id);
end $$;

-- نسيت كلمة السر (1): رقم الطلب الذي يرسله صاحب المحل لـ MakeFlow (null إن لم يكن الرقم مسجّلًا)
create or replace function public.cashier_account_reset_request(p_phone text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select cashier_account_request(pass_hash) from cashier_accounts where phone = p_phone;
$$;

-- نسيت كلمة السر (2): الكود من MakeFlow + كلمة السر الجديدة
create or replace function public.cashier_account_reset(p_phone text, p_code text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a cashier_accounts%rowtype;
  sig bytea;
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'short password' using errcode = '22023'; end if;
  select * into a from cashier_accounts where phone = p_phone for update;
  if not found or coalesce(p_code, '') !~ '^DCR-[A-Za-z0-9_-]{80,90}$' then return jsonb_build_object('ok', false); end if;
  sig := cashier_b64url(substr(p_code, 5));
  if length(sig) <> 64 or not cashier_ed25519_verify(
       convert_to('cashier-reset-v1|' || p_phone || '|' || cashier_account_request(a.pass_hash), 'UTF8'), sig, cashier_license_pubkey()) then
    return jsonb_build_object('ok', false);
  end if;
  update cashier_accounts set pass_hash = crypt(p_password, gen_salt('bf', 8)), fails = 0, locked_until = null, updated_at = now()
  where phone = p_phone;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cashier_account_set(uuid, text, text) from public, anon;
revoke all on function public.cashier_account_get(uuid) from public, anon;
revoke all on function public.cashier_account_login(text, text) from public, anon;
revoke all on function public.cashier_account_reset_request(text) from public, anon;
revoke all on function public.cashier_account_reset(text, text, text) from public, anon;
revoke all on function public.cashier_account_request(text) from public, anon, authenticated;
grant execute on function public.cashier_account_set(uuid, text, text) to authenticated;
grant execute on function public.cashier_account_get(uuid) to authenticated;
grant execute on function public.cashier_account_login(text, text) to authenticated;
grant execute on function public.cashier_account_reset_request(text) to authenticated;
grant execute on function public.cashier_account_reset(text, text, text) to authenticated;
