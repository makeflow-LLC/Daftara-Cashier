-- دفترة كاشير — إعداد الخادم كاملًا (0001_init.sql + 0002_invoice_line_position.sql + 0003_licensing.sql)
-- يُبنى تلقائيًا من supabase/migrations — لا تعدّله هنا. آمن لإعادة التشغيل.
-- Supabase Studio ← SQL Editor ← New query ← الصق كل الملف ← Run

-- ===== 0001_init.sql =====
-- ================= دفترة كاشير — مخطط Supabase (المرحلة 1، جاهز للمرحلة 2) =================
-- يُشغَّل على نفس خادم Supabase الخاص بدفترة. كل جداول هذا التطبيق باسم يبدأ بـ cashier_
-- فلا تلمس جداول دفترة (sync_*) ولا تتعارض معها. آمن لإعادة التشغيل.
--
-- المبادئ:
--  * كل سجل يحمل shop_id، و Row Level Security على كل جدول: لا يرى عضو محل إلا محله.
--  * المعرّفات UUID يولّدها الجهاز (يعمل بلا إنترنت)، والخادم يقبلها كما هي.
--  * جداول «آخر تعديل يفوز» (أصناف، زبائن…): updated_at من الجهاز، والخادم يرفض تعديلًا أقدم مما عنده.
--  * جداول «إضافة فقط» (حركات المخزون، الدفعات، القيود، سطور الفواتير): لا تعديل ولا حذف، فلا تعارض.
--  * الحذف علامة deleted = true (لا حذف فعلي) حتى لا يعيد جهاز آخر السجل.
--  * server_seq رقم متزايد يضعه الخادم مع كل كتابة؛ الأجهزة تسحب «ما بعد آخر رقم رأيته».
--    الكتابات في المحل الواحد تُرتَّب بقفل (advisory lock)، فترتيب server_seq = ترتيب الحفظ الفعلي،
--    ولا يفوت جهازًا سجلٌّ حُفظ متأخرًا برقم أصغر.
--  * المال أعداد صحيحة بأصغر وحدة (bigint)، والكميات بالألف (bigint). لا float.
--  * الجدول الوحيد المشترك بين المحلات: cashier_barcode_catalog (باركود + اسم + عدد استخدام فقط).
-- ==============================================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- العدّاد العام للمزامنة
-- ---------------------------------------------------------------------------
create sequence if not exists public.cashier_sync_seq;

-- ---------------------------------------------------------------------------
-- المحلات والأعضاء والأجهزة
-- ---------------------------------------------------------------------------
create table if not exists public.cashier_shops (
  id            uuid primary key,
  shop_id       uuid not null,                       -- = id (حتى يعامل محرك المزامنة كل الجداول بنفس الطريقة)
  name          text not null check (length(name) between 1 and 120),
  shop_type     text not null default 'other',
  phone         text,
  address       text,
  logo_path     text,
  base_currency text not null default 'ILS',
  settings      jsonb not null default '{}'::jsonb,  -- الميزات، أسعار الصرف، تذييل الفاتورة…
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false,
  server_seq    bigint,
  server_at     timestamptz,
  constraint cashier_shops_self check (shop_id = id)
);

-- الأدوار: owner الآن؛ manager و cashier للمرحلة 2 (مستخدمون متعددون بصلاحيات)
create table if not exists public.cashier_shop_members (
  shop_id    uuid not null references public.cashier_shops(id) on delete cascade,
  user_id    uuid not null,
  role       text not null default 'owner' check (role in ('owner', 'manager', 'cashier')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index if not exists cashier_shop_members_user on public.cashier_shop_members (user_id);

-- كل جهاز له حرف (A, B…) يسبق أرقام فواتيره، فلا تتكرر الأرقام بين الأجهزة
create table if not exists public.cashier_devices (
  id           uuid primary key,
  shop_id      uuid not null references public.cashier_shops(id) on delete cascade,
  user_id      uuid,
  prefix       text not null check (prefix ~ '^[A-Z]{1,3}$'),
  name         text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (shop_id, prefix)
);

-- الاشتراك: يكتبه MakeFlow فقط (من Supabase Studio أو بمفتاح service_role). الأعضاء يقرؤونه.
create table if not exists public.cashier_licenses (
  shop_id       uuid primary key references public.cashier_shops(id) on delete cascade,
  is_active     boolean not null default true,
  plan          text not null default 'trial',          -- trial | monthly | yearly | lifetime …
  trial_ends_at timestamptz,
  expires_at    timestamptz,
  source        text,                                   -- direct | play
  play_token    text,                                   -- رمز شراء Google Play (المرحلة 9)
  note          text,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- دوال الصلاحيات
-- ---------------------------------------------------------------------------
create or replace function public.cashier_is_member(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cashier_shop_members m
    where m.shop_id = p_shop and m.user_id = auth.uid()
  );
$$;

create or replace function public.cashier_role(p_shop uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.cashier_shop_members m
  where m.shop_id = p_shop and m.user_id = auth.uid();
$$;

create or replace function public.cashier_try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- جداول المحل (كلها: id, shop_id, … , server_seq, server_at)
-- ---------------------------------------------------------------------------

-- الفروع (المرحلة 2). كل محل له فرع رئيسي واحد الآن.
create table if not exists public.cashier_branches (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  name text not null, is_main boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

create table if not exists public.cashier_categories (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  name text not null, color text, sort integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

create table if not exists public.cashier_products (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  name          text not null,
  barcode       text,
  internal_code boolean not null default false,       -- باركود داخلي ولّده التطبيق (لصنف بلا باركود)
  category_id   uuid,
  unit          text not null default 'piece' check (unit in ('piece', 'meter', 'kg', 'gram', 'liter')),
  cost_price    bigint not null default 0,            -- تكلفة الوحدة الأساسية (أصغر وحدة عملة)
  sell_price    bigint not null default 0,
  currency      text not null default 'ILS',          -- عملة التسعير (إكسسوارات بالدولار مثلًا)
  low_stock     bigint,                               -- حدّ التنبيه بالألف؛ null = الافتراضي
  track_expiry  boolean not null default false,
  expiry_date   date,
  is_quick      boolean not null default false,       -- زر في شبكة البيع السريع
  quick_sort    integer not null default 0,
  parent_id     uuid,                                 -- المرحلة 2: الصنف الأم للمقاسات والألوان
  variant       jsonb,                                -- المرحلة 2: {"size":"L","color":"أحمر"}
  note          text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);
create index if not exists cashier_products_barcode on public.cashier_products (shop_id, barcode);

-- عبوات البيع: كرتونة = 24 قطعة (factor = 24000 بالألف)
create table if not exists public.cashier_product_units (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  product_id uuid not null, name text not null,
  factor bigint not null check (factor > 0),
  barcode text, sell_price bigint,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);
create index if not exists cashier_product_units_barcode on public.cashier_product_units (shop_id, barcode);

create table if not exists public.cashier_product_images (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  product_id uuid not null,
  path       text not null,                 -- في Storage: <shop_id>/products/<id>.webp
  position   smallint not null default 0,
  width integer, height integer, bytes integer,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

create table if not exists public.cashier_price_history (   -- إضافة فقط
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  product_id uuid not null,
  old_sell bigint, new_sell bigint, old_cost bigint, new_cost bigint,
  reason text,                                   -- manual | bulk | purchase | import
  batch_id uuid,                                 -- تحديث جماعي واحد = دفعة واحدة (للتراجع)
  device_id uuid, created_by uuid,
  created_at timestamptz not null default now(), server_seq bigint, server_at timestamptz
);

create table if not exists public.cashier_customers (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  name text not null, phone text, note text,
  credit_limit bigint,
  source text,                                   -- daftara عند الاستيراد من دفترة
  external_ref text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

-- كشف حساب الزبون (إضافة فقط). amount موجب = يزيد ما على الزبون، سالب = ينقصه.
create table if not exists public.cashier_customer_entries (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  customer_id uuid not null,
  type text not null check (type in ('opening', 'sale_credit', 'payment', 'return_credit', 'adjustment', 'import')),
  amount bigint not null,
  invoice_id uuid, payment_id uuid, note text,
  device_id uuid, created_by uuid,
  created_at timestamptz not null default now(), server_seq bigint, server_at timestamptz
);
create index if not exists cashier_customer_entries_customer on public.cashier_customer_entries (shop_id, customer_id);

create table if not exists public.cashier_suppliers (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  name text not null, phone text, note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

-- حساب المورّد (إضافة فقط). amount موجب = يزيد ما على المحل للمورّد.
create table if not exists public.cashier_supplier_entries (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  supplier_id uuid not null,
  type text not null check (type in ('opening', 'purchase', 'payment', 'return', 'adjustment')),
  amount bigint not null,
  invoice_id uuid, payment_id uuid, note text,
  device_id uuid, created_by uuid,
  created_at timestamptz not null default now(), server_seq bigint, server_at timestamptz
);
create index if not exists cashier_supplier_entries_supplier on public.cashier_supplier_entries (shop_id, supplier_id);

create table if not exists public.cashier_payment_methods (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('cash', 'transfer', 'credit')),
  fee_bp integer not null default 0 check (fee_bp between 0 and 10000),  -- رسوم بنقاط الأساس: 150 = 1.5%
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

-- رأس الفاتورة: يُكتب مرة واحدة؛ التعديل الوحيد المسموح لاحقًا هو الإلغاء (status = void) والملاحظة.
create table if not exists public.cashier_invoices (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  branch_id uuid, device_id uuid,
  number text not null,                           -- A-0042
  seq integer not null,
  type text not null check (type in ('sale', 'sale_return', 'purchase', 'purchase_return')),
  status text not null default 'final' check (status in ('final', 'void')),
  customer_id uuid, supplier_id uuid,
  original_invoice_id uuid,                       -- للمرتجع: الفاتورة الأصلية
  currency text not null default 'ILS',
  subtotal bigint not null default 0,
  discount bigint not null default 0,
  total bigint not null default 0,
  cost_total bigint not null default 0,
  fee_total bigint not null default 0,
  paid bigint not null default 0,
  note text, attachment_path text,
  created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);
create index if not exists cashier_invoices_number on public.cashier_invoices (shop_id, number);
create index if not exists cashier_invoices_created on public.cashier_invoices (shop_id, created_at);

create table if not exists public.cashier_invoice_lines (  -- إضافة فقط
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  invoice_id uuid not null, product_id uuid, unit_id uuid,
  name text not null,                              -- لقطة من اسم الصنف وقت البيع
  unit text, unit_factor bigint not null default 1000,
  qty bigint not null, unit_price bigint not null,
  discount bigint not null default 0,
  total bigint not null,
  unit_cost bigint not null default 0,
  position smallint not null default 0,            -- ترتيب السطر كما في السلة
  created_at timestamptz not null default now(), server_seq bigint, server_at timestamptz
);
create index if not exists cashier_invoice_lines_invoice on public.cashier_invoice_lines (shop_id, invoice_id);

-- كل دفعة داخلة أو خارجة (إضافة فقط). amount بالعملة الأساسية؛ وإن دُفعت بعملة أخرى نحفظها وسعرها.
create table if not exists public.cashier_payments (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  invoice_id uuid, customer_id uuid, supplier_id uuid, cash_session_id uuid,
  direction text not null check (direction in ('in', 'out')),
  method_id uuid, method_kind text not null check (method_kind in ('cash', 'transfer', 'credit')),
  amount bigint not null,
  fee bigint not null default 0,
  currency text not null default 'ILS',
  amount_currency bigint,                          -- المبلغ بالعملة المدفوعة
  rate bigint,                                     -- سعر الصرف × 1,000,000
  note text, device_id uuid, created_by uuid,
  created_at timestamptz not null default now(), server_seq bigint, server_at timestamptz
);
create index if not exists cashier_payments_invoice on public.cashier_payments (shop_id, invoice_id);

-- حركات المخزون (إضافة فقط). المخزون = مجموع qty لكل صنف.
create table if not exists public.cashier_inventory_movements (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  branch_id uuid, product_id uuid not null,
  type text not null check (type in ('opening', 'purchase', 'sale', 'sale_return', 'purchase_return',
                                     'adjustment', 'damage', 'transfer_in', 'transfer_out')),
  qty bigint not null,                             -- بالوحدة الأساسية، بالألف، بإشارة
  unit_cost bigint,                                -- تكلفة الوحدة الأساسية لحركات الدخول
  ref_type text, ref_id uuid,                      -- invoice | stock_count | transfer …
  expiry_date date, note text,
  device_id uuid, created_by uuid,
  created_at timestamptz not null default now(), server_seq bigint, server_at timestamptz
);
create index if not exists cashier_movements_product on public.cashier_inventory_movements (shop_id, product_id);

create table if not exists public.cashier_stock_counts (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  branch_id uuid, status text not null default 'open' check (status in ('open', 'applied', 'cancelled')),
  diff_value bigint not null default 0, note text, applied_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

create table if not exists public.cashier_cash_sessions (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  branch_id uuid, device_id uuid,
  opened_at timestamptz not null, opening_cash bigint not null default 0,
  closed_at timestamptz,
  expected jsonb,                                   -- {method_id: مبلغ}
  counted jsonb,
  difference bigint, note text, closed_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

-- المرحلة 2: المصاريف وصافي الربح
create table if not exists public.cashier_expenses (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  branch_id uuid, category text, amount bigint not null, method_id uuid, cash_session_id uuid,
  note text, attachment_path text, spent_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false, server_seq bigint, server_at timestamptz
);

-- المرحلة 2: سجل العمليات (من فعل ماذا) — إضافة فقط
create table if not exists public.cashier_audit_log (
  id uuid primary key, shop_id uuid not null references public.cashier_shops(id) on delete cascade,
  user_id uuid, device_id uuid, action text not null, entity text, entity_id uuid, data jsonb,
  created_at timestamptz not null default now(), server_seq bigint, server_at timestamptz
);

-- ---------------------------------------------------------------------------
-- محرك المزامنة على الخادم: ختم server_seq، ورفض التعديل الأقدم، ومنع نقل سجل بين المحلات
-- ---------------------------------------------------------------------------
-- آخر server_seq لكل جدول في كل محل: الجهاز يسأل سؤالًا واحدًا صغيرًا «هل من جديد؟»
-- بدل 20 طلبًا كل مرة (توفير إنترنت وبطارية).
create table if not exists public.cashier_shop_heads (
  shop_id    uuid primary key references public.cashier_shops(id) on delete cascade,
  heads      jsonb not null default '{}'::jsonb,   -- {"cashier_products": 1234, …}
  updated_at timestamptz not null default now()
);

create or replace function public.cashier_sync_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.shop_id is distinct from OLD.shop_id or NEW.id is distinct from OLD.id then
      raise exception 'cannot move a record between shops' using errcode = '42501';
    end if;
    if TG_ARGV[0] = 'append' then
      return null;                                  -- إضافة فقط: الموجود لا يتغيّر (بصمت)
    end if;
    if NEW.updated_at < OLD.updated_at then
      return null;                                  -- آخر تعديل يفوز: تعديل أقدم من الموجود يُتجاهل
    end if;
    if NEW.updated_at = OLD.updated_at
       and (to_jsonb(NEW) - 'server_seq' - 'server_at') = (to_jsonb(OLD) - 'server_seq' - 'server_at') then
      return null;                                  -- لا تغيير: لا نزيد server_seq بلا داعٍ
    end if;
  end if;
  -- كتابات المحل الواحد بالترتيب حتى الحفظ (commit)، فلا يفوت السحبَ سجلٌّ برقم أصغر
  perform pg_advisory_xact_lock(hashtextextended('cashier:' || NEW.shop_id::text, 0));
  NEW.server_seq := nextval('public.cashier_sync_seq');
  NEW.server_at := now();
  return NEW;
end $$;

-- بعد الحفظ الفعلي فقط (upsert يمر بـ BEFORE INSERT حتى لو انتهى تعديلًا أو تجاهلًا)
create or replace function public.cashier_sync_head() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.cashier_shop_heads as h (shop_id, heads)
  values (NEW.shop_id, jsonb_build_object(TG_TABLE_NAME, NEW.server_seq))
  on conflict (shop_id) do update
    set heads = h.heads || jsonb_build_object(TG_TABLE_NAME, greatest(NEW.server_seq, coalesce((h.heads->>TG_TABLE_NAME)::bigint, 0))),
        updated_at = now();
  return null;
end $$;

do $$
declare
  t record;
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
    execute format('drop policy if exists member_select on public.%I', t.tbl);
    execute format('drop policy if exists member_insert on public.%I', t.tbl);
    execute format('drop policy if exists member_update on public.%I', t.tbl);
    execute format('create policy member_select on public.%I for select to authenticated
                    using (public.cashier_is_member(shop_id))', t.tbl);
    -- محل جديد لا يُنشأ بالإدراج المباشر (لا عضو فيه بعد): بالدالة cashier_create_shop فقط
    execute format('create policy member_insert on public.%I for insert to authenticated
                    with check (public.cashier_is_member(shop_id))', t.tbl);
    if t.mode = 'lww' then
      execute format('grant update on public.%I to authenticated', t.tbl);
      execute format('create policy member_update on public.%I for update to authenticated
                      using (public.cashier_is_member(shop_id)) with check (public.cashier_is_member(shop_id))', t.tbl);
    else
      execute format('revoke update on public.%I from authenticated', t.tbl);
    end if;
    -- لا حذف فعلي لأي أحد عبر الـ API (الحذف علامة deleted)
    execute format('revoke delete on public.%I from authenticated', t.tbl);
  end loop;
end $$;

-- جداول «إضافة فقط» تُرفع بـ ON CONFLICT DO NOTHING (Prefer: resolution=ignore-duplicates)، فلا تحتاج update.

alter table public.cashier_shop_heads enable row level security;
revoke all on public.cashier_shop_heads from anon, authenticated;
grant select on public.cashier_shop_heads to authenticated;
drop policy if exists member_select on public.cashier_shop_heads;
create policy member_select on public.cashier_shop_heads for select to authenticated using (public.cashier_is_member(shop_id));

alter table public.cashier_shop_members enable row level security;
alter table public.cashier_devices enable row level security;
alter table public.cashier_licenses enable row level security;
revoke all on public.cashier_shop_members, public.cashier_devices, public.cashier_licenses from anon, authenticated;
grant select on public.cashier_shop_members, public.cashier_devices, public.cashier_licenses to authenticated;
drop policy if exists member_select on public.cashier_shop_members;
create policy member_select on public.cashier_shop_members for select to authenticated using (public.cashier_is_member(shop_id));
drop policy if exists member_select on public.cashier_devices;
create policy member_select on public.cashier_devices for select to authenticated using (public.cashier_is_member(shop_id));
drop policy if exists member_select on public.cashier_licenses;
create policy member_select on public.cashier_licenses for select to authenticated using (public.cashier_is_member(shop_id));

-- ---------------------------------------------------------------------------
-- إنشاء المحل وتسجيل الجهاز (الجهاز ينشئ المحل وهو بلا إنترنت، ثم يسجّله هنا عند أول اتصال)
-- ---------------------------------------------------------------------------
create or replace function public.cashier_create_shop(
  p_id uuid, p_name text, p_type text, p_currency text default 'ILS', p_trial_days integer default 14
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
    values (p_id, 'trial', now() + make_interval(days => greatest(coalesce(p_trial_days, 14), 0)));
  end if;
  return jsonb_build_object('shop_id', p_id, 'role', cashier_role(p_id));
end $$;

-- يسجّل الجهاز ويعطيه حرفًا. يحاول الحرف المفضّل (الذي استعمله وهو بلا إنترنت) إن كان متاحًا.
create or replace function public.cashier_register_device(p_shop uuid, p_device uuid, p_name text, p_preferred text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  existing text;
  candidate text;
  n integer := 0;
begin
  if not cashier_is_member(p_shop) then raise exception 'not a member' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cashier-devices:' || p_shop::text, 0));
  select prefix into existing from cashier_devices where id = p_device and shop_id = p_shop;
  if existing is not null then
    update cashier_devices set last_seen_at = now(), name = coalesce(p_name, name) where id = p_device;
    return existing;
  end if;
  if p_preferred ~ '^[A-Z]{1,3}$' and not exists (select 1 from cashier_devices where shop_id = p_shop and prefix = p_preferred) then
    candidate := p_preferred;
  else
    loop
      -- 0 → A … 25 → Z، 26 → AA
      candidate := '';
      declare k integer := n + 1; r integer;
      begin
        while k > 0 loop
          r := (k - 1) % 26;
          candidate := chr(65 + r) || candidate;
          k := (k - 1) / 26;
        end loop;
      end;
      exit when not exists (select 1 from cashier_devices where shop_id = p_shop and prefix = candidate);
      n := n + 1;
    end loop;
  end if;
  insert into cashier_devices (id, shop_id, user_id, prefix, name) values (p_device, p_shop, auth.uid(), candidate, p_name);
  return candidate;
end $$;

-- المحلات التي ينتمي إليها المستخدم (للدخول من جهاز جديد)
create or replace function public.cashier_my_shops() returns table (shop_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, m.role from cashier_shop_members m join cashier_shops s on s.id = m.shop_id
  where m.user_id = auth.uid() and not s.deleted;
$$;

-- ---------------------------------------------------------------------------
-- كتالوج الباركود المشترك: باركود + اسم + عدد الاستخدام فقط. لا أسعار ولا كميات ولا صور ولا هوية محل.
-- ---------------------------------------------------------------------------
create table if not exists public.cashier_barcode_catalog (
  barcode     text not null check (barcode ~ '^[0-9A-Za-z-]{4,64}$'),
  name        text not null check (length(name) between 1 and 120),
  usage_count integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (barcode, name)
);
alter table public.cashier_barcode_catalog enable row level security;
revoke all on public.cashier_barcode_catalog from anon, authenticated;

-- الاسم الأكثر استخدامًا لكل باركود مطلوب
create or replace function public.cashier_catalog_lookup(p_barcodes text[])
returns table (barcode text, name text)
language sql stable security definer set search_path = public as $$
  select distinct on (c.barcode) c.barcode, c.name
  from cashier_barcode_catalog c
  where auth.uid() is not null and c.barcode = any (p_barcodes[1:200])
  order by c.barcode, c.usage_count desc, c.updated_at desc;
$$;

-- المساهمة: [{"barcode":"…","name":"…"}] — يُستدعى عند تسمية صنف بباركود حقيقي (لا الداخلي)
create or replace function public.cashier_catalog_contribute(p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; n integer := 0; b text; nm text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 200 loop
    b := btrim(it->>'barcode');
    nm := btrim(regexp_replace(coalesce(it->>'name', ''), '\s+', ' ', 'g'));
    continue when b !~ '^[0-9A-Za-z-]{4,64}$' or length(nm) not between 1 and 120;
    insert into cashier_barcode_catalog (barcode, name) values (b, nm)
    on conflict (barcode, name) do update set usage_count = cashier_barcode_catalog.usage_count + 1, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.cashier_create_shop(uuid, text, text, text, integer) from public, anon;
revoke all on function public.cashier_register_device(uuid, uuid, text, text) from public, anon;
revoke all on function public.cashier_my_shops() from public, anon;
revoke all on function public.cashier_catalog_lookup(text[]) from public, anon;
revoke all on function public.cashier_catalog_contribute(jsonb) from public, anon;
grant execute on function public.cashier_create_shop(uuid, text, text, text, integer) to authenticated;
grant execute on function public.cashier_register_device(uuid, uuid, text, text) to authenticated;
grant execute on function public.cashier_my_shops() to authenticated;
grant execute on function public.cashier_catalog_lookup(text[]) to authenticated;
grant execute on function public.cashier_catalog_contribute(jsonb) to authenticated;
grant usage on sequence public.cashier_sync_seq to authenticated;

-- ---------------------------------------------------------------------------
-- التخزين: صور الأصناف والشعار وصور فواتير الموردين. خاص؛ كل محل في مجلده <shop_id>/…
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cashier-media', 'cashier-media', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists cashier_media_select on storage.objects;
drop policy if exists cashier_media_insert on storage.objects;
drop policy if exists cashier_media_update on storage.objects;
drop policy if exists cashier_media_delete on storage.objects;
create policy cashier_media_select on storage.objects for select to authenticated
  using (bucket_id = 'cashier-media' and public.cashier_is_member(public.cashier_try_uuid((storage.foldername(name))[1])));
create policy cashier_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cashier-media' and public.cashier_is_member(public.cashier_try_uuid((storage.foldername(name))[1])));
create policy cashier_media_update on storage.objects for update to authenticated
  using (bucket_id = 'cashier-media' and public.cashier_is_member(public.cashier_try_uuid((storage.foldername(name))[1])));
create policy cashier_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cashier-media' and public.cashier_is_member(public.cashier_try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------------
-- للإدارة (MakeFlow، من SQL Editor):
--   المحلات واشتراكاتها:  select s.name, l.* from cashier_licenses l join cashier_shops s on s.id = l.shop_id;
--   تفعيل محل سنة:        update cashier_licenses set plan = 'yearly', is_active = true,
--                           expires_at = now() + interval '1 year', updated_at = now() where shop_id = '…';
--   إيقاف محل:            update cashier_licenses set is_active = false, updated_at = now() where shop_id = '…';
-- ---------------------------------------------------------------------------

-- ===== 0002_invoice_line_position.sql =====
-- ترتيب سطور الفاتورة كما في السلة (للطباعة والمرتجع). لمن شغّل 0001 قبل إضافة العمود. آمن لإعادة التشغيل.
alter table public.cashier_invoice_lines add column if not exists position smallint not null default 0;

-- ===== 0003_licensing.sql =====
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
language sql immutable as $$ select decode('HMMGz4JpCMXiMFuTm3ikWsTX6TYKucGN43AaGDMMF0c=', 'base64') $$;

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

select 'دفترة كاشير: تم تجهيز الخادم ✓' as result;
