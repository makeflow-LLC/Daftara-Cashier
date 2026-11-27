-- المحاسبة: السندات (قبض، صرف، تحويل بين الصناديق، قيد يومية) والشيكات (واردة وصادرة). آمن لإعادة التشغيل.
--  * الصناديق نفسها (خزنة، حساب بنك…) والحسابات الخاصة في cashier_shops.settings — لا جدول لها.
--  * السند يُكتب مرة واحدة؛ التعديل الوحيد المسموح لاحقًا هو الإلغاء (status = void) — كرأس الفاتورة.
--  * الشيك تتغير حالته: بانتظار ← صُرف / رجع / جُيّر / أُلغي. أثره على كشف الزبون أو التاجر قيود «إضافة فقط»
--    في cashier_customer_entries / cashier_supplier_entries تحمل payment_id = رقم الشيك.
--  * ميزان المراجعة ودفتر الأستاذ والميزانية لا تُحفظ: تُحسب على الجهاز من هذه الجداول ومن الفواتير والدفعات.

create table if not exists public.cashier_vouchers (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  number text not null,                           -- A-V0007 قبض، A-S0003 صرف، A-T0001 تحويل، A-J0002 قيد
  seq integer not null,
  type text not null check (type in ('receipt', 'payment', 'transfer', 'journal')),
  status text not null default 'final' check (status in ('final', 'void')),
  amount bigint not null check (amount >= 0),
  account text,                                   -- الصندوق: drawer أو معرّف طريقة دفع أو صندوق (للقبض: إليه، للصرف والتحويل: منه)
  to_account text,                                -- للتحويل: الصندوق المستلم
  contra text,                                    -- الحساب المقابل: owner | capital | other_income | other_expense | acc:<معرّف حساب خاص>
  party_name text check (party_name is null or length(party_name) <= 120),
  ref_table text, ref_id uuid,                    -- سند أثره المالي في سجل آخر (مصروف): expenses + رقمه
  lines jsonb,                                    -- لقيد اليومية: [{"account":"…","debit":0,"credit":0,"note":"…"}]
  note text check (note is null or length(note) <= 500),
  voucher_at timestamptz not null default now(),
  cost_center uuid,                               -- مركز التكلفة (0011)
  device_id uuid, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

create table if not exists public.cashier_cheques (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),   -- in شيك استلمته، out شيك أعطيته
  number text, bank text,
  amount bigint not null check (amount > 0),
  due_date date not null,
  party_type text not null default 'other' check (party_type in ('customer', 'supplier', 'other')),
  party_id uuid, party_name text,
  status text not null default 'pending' check (status in ('pending', 'cleared', 'bounced', 'endorsed', 'cancelled')),
  status_at timestamptz,
  account text,                                   -- عند الصرف: الصندوق الذي دخله المال أو خرج منه
  endorsed_to uuid, endorsed_name text,           -- التجيير: التاجر الذي أُعطي له الشيك
  note text check (note is null or length(note) <= 500),
  device_id uuid, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);
create index if not exists cashier_cheques_due on public.cashier_cheques (shop_id, due_date);

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('cashier_vouchers', 'lww'), ('cashier_cheques', 'lww')
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
    execute format('grant select, insert, update on public.%I to authenticated', t.tbl);
    execute format('revoke delete on public.%I from authenticated', t.tbl);
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
      ('cashier_vouchers', 'lww'), ('cashier_cheques', 'lww')
    ) as x(tbl, mode)
  loop
    execute format('drop policy if exists member_insert on public.%I', t.tbl);
    execute format('create policy member_insert on public.%I for insert to authenticated
                    with check (public.cashier_can_write(shop_id))', t.tbl);
    execute format('drop policy if exists member_update on public.%I', t.tbl);
    execute format('create policy member_update on public.%I for update to authenticated
                    using (public.cashier_is_member(shop_id)) with check (public.cashier_can_write(shop_id))', t.tbl);
  end loop;
end $$;
