-- ================= دفترة كاشير — لوحة الإدارة الموحّدة =================
-- يُشغَّل بعد 0001…0007. آمن لإعادة التشغيل.
--
-- ما هو: الدوال التي تقرأ منها وتكتب بها لوحة MakeFlow (https://makeflow.tech/apps/admin/) بدل أوامر
-- SQL اليدوية: كل المحلات واشتراكاتها، تفعيل شهر أو سنة بضغطة مع تسجيل الدفعة، الإيقاف، تاريخ الانتهاء،
-- وكلمة سر جديدة لمن نسيها.
--
-- من يدخل: حساب في Supabase Auth (بريد وكلمة سر) مذكور في جدول makeflow_admins — الجدول نفسه الذي
-- تستعمله لوحة دفترة على هذا الخادم (daftara/supabase/admin.sql)، فالحساب واحد. أجهزة المحلات تدخل
-- الخادم بدور authenticated أيضًا (مجهولة)، لذلك كل دالة هنا تتحقق بنفسها أن المنادي مدير وترفض غيره.
--
-- إعداد المدير (مرة واحدة، إن لم يُعدّ من ملف دفترة):
--   1. Supabase Studio ← Authentication ← Users ← Add user: بريدك وكلمة سر قوية، مع «Auto Confirm User».
--   2. insert into makeflow_admins (user_id, note) select id, 'اسم المدير' from auth.users where email = 'you@example.com' on conflict do nothing;
-- =====================================================================

create table if not exists public.makeflow_admins (
  user_id    uuid primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.makeflow_admins enable row level security;
revoke all on public.makeflow_admins from anon, authenticated;

create or replace function public.makeflow_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.makeflow_admins where user_id = auth.uid());
$$;

create or replace function public.makeflow_need_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.makeflow_is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
end $$;

-- سجل العمليات: من فعل ماذا ومتى. كل دالة إدارة تغيّر شيئًا تكتب فيه سطرًا باسم المدير المنادي.
-- اسم المدير هو عمود note في makeflow_admins (يعدّله صاحبه من «الإعدادات» في اللوحة)، ويُحفظ نسخةً في
-- السطر نفسه، فيبقى السجل مقروءًا بعد إلغاء الحساب. الجدول مشترك بين دفترة وكاشير (app يميّز).
create table if not exists public.makeflow_admin_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  admin_id   uuid,
  admin_name text not null default '',
  app        text not null,
  action     text not null,
  target     text not null default '',
  label      text not null default '',
  details    jsonb not null default '{}'::jsonb
);
create index if not exists makeflow_admin_log_at on public.makeflow_admin_log (at desc);
alter table public.makeflow_admin_log enable row level security;
revoke all on public.makeflow_admin_log from anon, authenticated;

-- تُنادى من دوال الإدارة فقط (بعد makeflow_need_admin)
create or replace function public.makeflow_audit(p_app text, p_action text, p_target text, p_label text, p_details jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into makeflow_admin_log (admin_id, admin_name, app, action, target, label, details)
  values (auth.uid(), coalesce((select nullif(trim(note), '') from makeflow_admins where user_id = auth.uid()), 'مدير'),
          p_app, p_action, coalesce(p_target, ''), left(coalesce(p_label, ''), 200), coalesce(jsonb_strip_nulls(p_details), '{}'::jsonb));
end $$;

-- السجل (الأحدث أولًا) وأسماء المديرين. me = اسم المنادي.
create or replace function public.makeflow_admin_audit(p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform makeflow_need_admin();
  return jsonb_build_object(
    'me', (select coalesce(nullif(trim(note), ''), '') from makeflow_admins where user_id = auth.uid()),
    'admins', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(nullif(trim(a.note), ''), 'مدير'), 'since', a.created_at,
                 'me', a.user_id = auth.uid()) order by a.created_at), '[]') from makeflow_admins a),
    'log', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc), '[]')
            from (select id, at, admin_id, admin_name, app, action, target, label, details
                  from makeflow_admin_log order by id desc limit least(greatest(coalesce(p_limit, 1000), 1), 5000)) x));
end $$;

-- المدير يسمّي نفسه (الاسم الذي يظهر في السجل)
create or replace function public.makeflow_admin_name(p_name text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform makeflow_need_admin();
  if length(trim(coalesce(p_name, ''))) not between 2 and 60 then raise exception 'bad name' using errcode = '22023'; end if;
  update makeflow_admins set note = trim(p_name) where user_id = auth.uid();
  return found;
end $$;

-- دفعات الاشتراك التي فُعّلت من اللوحة (الدخل). التفعيل بكود موقَّع أو من Google Play لا يمرّ من هنا.
create table if not exists public.cashier_admin_payments (
  id         bigserial primary key,
  shop_id    uuid not null references public.cashier_shops(id) on delete cascade,
  plan       text not null check (plan in ('monthly', 'yearly')),
  amount     numeric(10, 2) not null default 0 check (amount >= 0),
  paid_at    timestamptz not null default now(),
  period_from timestamptz not null,
  period_to  timestamptz not null,
  note       text not null default '' check (length(note) <= 300),
  created_by uuid
);
create index if not exists cashier_admin_payments_shop on public.cashier_admin_payments (shop_id, paid_at desc);
alter table public.cashier_admin_payments enable row level security;
revoke all on public.cashier_admin_payments from anon, authenticated;

-- كل المحلات باشتراكاتها، والدفعات، في نداء واحد
create or replace function public.cashier_admin_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform makeflow_need_admin();
  return jsonb_build_object(
    'now', now(),
    'shops', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'shop_type', s.shop_type, 'phone', s.phone, 'created_at', s.created_at,
        'account_phone', (select a.phone from cashier_accounts a where a.shop_id = s.id),
        'is_active', l.is_active, 'plan', l.plan, 'trial_ends_at', l.trial_ends_at, 'expires_at', l.expires_at,
        'source', l.source, 'note', l.note, 'updated_at', l.updated_at,
        'devices', (select count(*) from cashier_devices d where d.shop_id = s.id),
        'last_seen', (select max(d.last_seen_at) from cashier_devices d where d.shop_id = s.id),
        'paid', (select coalesce(sum(p.amount), 0) from cashier_admin_payments p where p.shop_id = s.id))
        order by s.created_at desc), '[]')
      from cashier_shops s left join cashier_licenses l on l.shop_id = s.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'shop_id', p.shop_id, 'plan', p.plan, 'amount', p.amount, 'paid_at', p.paid_at,
        'period_to', p.period_to, 'note', p.note) order by p.paid_at desc), '[]')
      from cashier_admin_payments p));
end $$;

-- تفعيل أو تجديد: يبدأ من نهاية الاشتراك الحالي أو التجربة إن كانت سارية (فلا تضيع أيام)، ومن الآن إن
-- انتهيا. يسجّل الدفعة ويشغّل المحل إن كان موقوفًا. يرجع تاريخ الانتهاء الجديد.
create or replace function public.cashier_admin_activate(p_shop uuid, p_plan text, p_amount numeric, p_note text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  l cashier_licenses%rowtype;
  start_at timestamptz; end_at timestamptz;
begin
  perform makeflow_need_admin();
  if p_plan not in ('monthly', 'yearly') then raise exception 'bad plan' using errcode = '22023'; end if;
  if not exists (select 1 from cashier_shops where id = p_shop) then raise exception 'no shop' using errcode = '22023'; end if;
  insert into cashier_licenses (shop_id, plan) values (p_shop, 'trial') on conflict (shop_id) do nothing;
  select * into l from cashier_licenses where shop_id = p_shop for update;
  start_at := greatest(now(), coalesce(l.expires_at, now()), coalesce(l.trial_ends_at, now()));
  end_at := start_at + case when p_plan = 'yearly' then interval '1 year' else interval '1 month' end;
  update cashier_licenses set plan = p_plan, is_active = true, expires_at = end_at, source = 'admin', updated_at = now()
  where shop_id = p_shop;
  insert into cashier_admin_payments (shop_id, plan, amount, period_from, period_to, note, created_by)
  values (p_shop, p_plan, coalesce(p_amount, 0), start_at, end_at, left(coalesce(p_note, ''), 300), auth.uid());
  perform makeflow_audit('cashier', 'shop.activate', p_shop::text, (select name from cashier_shops where id = p_shop),
    jsonb_build_object('plan', p_plan, 'amount', coalesce(p_amount, 0), 'until', end_at));
  return end_at;
end $$;

-- تعديل يدوي: {"is_active": false} يوقف المحل، {"expires_at": "2027-01-01"} يضع تاريخ الانتهاء
-- (null يمحوه)، {"trial_ends_at": …} يمدّ التجربة. ما لم يُذكر لا يتغير.
create or replace function public.cashier_admin_set(p_shop uuid, p_patch jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform makeflow_need_admin();
  update cashier_licenses set
    is_active = case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else is_active end,
    expires_at = case when p_patch ? 'expires_at' then (p_patch->>'expires_at')::timestamptz else expires_at end,
    trial_ends_at = case when p_patch ? 'trial_ends_at' then (p_patch->>'trial_ends_at')::timestamptz else trial_ends_at end,
    updated_at = now()
  where shop_id = p_shop;
  if not found then return false; end if;
  perform makeflow_audit('cashier', 'shop.set', p_shop::text, (select name from cashier_shops where id = p_shop), p_patch);
  return true;
end $$;

-- دفعة سُجّلت خطأً: تُحذف من الدخل. تاريخ الاشتراك لا يتغير (عدّله من cashier_admin_set إن لزم).
create or replace function public.cashier_admin_payment_delete(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare p cashier_admin_payments%rowtype;
begin
  perform makeflow_need_admin();
  delete from cashier_admin_payments where id = p_id returning * into p;
  if not found then return false; end if;
  perform makeflow_audit('cashier', 'payment.delete', p.shop_id::text, (select name from cashier_shops where id = p.shop_id),
    jsonb_build_object('plan', p.plan, 'amount', p.amount));
  return true;
end $$;

-- صاحب محل نسي كلمة السر: كلمة سر مؤقتة لحسابه، ويُفك قفل المحاولات. (البديل بلا خادم: كود DCR.)
create or replace function public.cashier_admin_reset_password(p_phone text, p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform makeflow_need_admin();
  if length(coalesce(p_password, '')) < 6 then raise exception 'short password' using errcode = '22023'; end if;
  update cashier_accounts set pass_hash = crypt(p_password, gen_salt('bf', 8)), fails = 0, locked_until = null, updated_at = now()
  where phone = p_phone;
  if not found then return false; end if;
  perform makeflow_audit('cashier', 'shop.password', p_phone,
    (select s.name from cashier_shops s join cashier_accounts a on a.shop_id = s.id where a.phone = p_phone), '{}');
  return true;
end $$;

revoke all on function public.makeflow_is_admin() from public, anon;
revoke all on function public.makeflow_need_admin() from public, anon, authenticated;
revoke all on function public.makeflow_audit(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.makeflow_admin_audit(integer) from public, anon;
revoke all on function public.makeflow_admin_name(text) from public, anon;
grant execute on function public.makeflow_admin_audit(integer) to authenticated;
grant execute on function public.makeflow_admin_name(text) to authenticated;
revoke all on function public.cashier_admin_data() from public, anon;
revoke all on function public.cashier_admin_activate(uuid, text, numeric, text) from public, anon;
revoke all on function public.cashier_admin_set(uuid, jsonb) from public, anon;
revoke all on function public.cashier_admin_payment_delete(bigint) from public, anon;
revoke all on function public.cashier_admin_reset_password(text, text) from public, anon;
grant execute on function public.makeflow_is_admin() to authenticated;
grant execute on function public.cashier_admin_data() to authenticated;
grant execute on function public.cashier_admin_activate(uuid, text, numeric, text) to authenticated;
grant execute on function public.cashier_admin_set(uuid, jsonb) to authenticated;
grant execute on function public.cashier_admin_payment_delete(bigint) to authenticated;
grant execute on function public.cashier_admin_reset_password(text, text) to authenticated;
