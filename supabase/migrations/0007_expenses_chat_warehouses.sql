-- المصاريف والرواتب، سند القبض، والمحادثة الداخلية والتعميمات. آمن لإعادة التشغيل.
--  * المصاريف: الموظف وشهر الراتب (للرواتب)، ومن سجّل المصروف.
--  * سند القبض: رقم لكل دفعة يستلمها المحل من زبون (A-V0001).
--  * المحادثة: رسائل أهل المحل وتعميمات صاحبه وإشعارات قراءتها — إضافة فقط.
--  * المخازن الخارجية لا تحتاج جدولًا جديدًا: المخزن سجل في cashier_branches، وحركاته تحمل branch_id.

alter table public.cashier_expenses add column if not exists employee_id uuid;
alter table public.cashier_expenses add column if not exists period text;
alter table public.cashier_expenses add column if not exists created_by uuid;
alter table public.cashier_payments add column if not exists number text;

create table if not exists public.cashier_messages (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  kind text not null default 'chat' check (kind in ('chat', 'announce', 'read')),
  from_id text,                                    -- owner | معرّف الموظف | dev:<حرف الجهاز> (محل بلا موظفين)
  from_name text,
  to_id text,                                      -- فارغ = لكل أهل المحل، أو معرّف من تُرسل له
  ref_id uuid,                                     -- لإشعار القراءة: التعميم المقروء
  body text not null default '' check (length(body) <= 2000),
  device_id uuid, created_by uuid,
  created_at timestamptz not null default now(), server_seq bigint, server_at timestamptz
);

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('cashier_messages', 'append')
    ) as x(tbl, mode)
  loop
    execute format('drop trigger if exists sync_stamp on public.%I', t.tbl);
    execute format('create trigger sync_stamp before insert or update on public.%I
                    for each row execute function public.cashier_sync_stamp(%L)', t.tbl, t.mode);
    execute format('drop trigger if exists sync_head on public.%I', t.tbl);
    execute format('create trigger sync_head after insert or update on public.%I
                    for each row execute function public.cashier_sync_head()', t.tbl);
    execute format('create index if not exists %I on public.%I (shop_id, server_seq)', t.tbl || '_pull', t.tbl);
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('revoke all on public.%I from anon', t.tbl);
    execute format('grant select, insert on public.%I to authenticated', t.tbl);
    execute format('revoke update, delete on public.%I from authenticated', t.tbl);
    execute format('drop policy if exists member_select on public.%I', t.tbl);
    execute format('create policy member_select on public.%I for select to authenticated
                    using (public.cashier_is_member(shop_id))', t.tbl);
  end loop;
end $$;

-- الكتابة تشترط الترخيص كباقي جداول المحل (0003)
do $$
declare t record;
begin
  for t in
    select * from (values
      ('cashier_messages', 'append')
    ) as x(tbl, mode)
  loop
    execute format('drop policy if exists member_insert on public.%I', t.tbl);
    execute format('create policy member_insert on public.%I for insert to authenticated
                    with check (public.cashier_can_write(shop_id))', t.tbl);
  end loop;
end $$;
