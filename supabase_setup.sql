-- ========================================================
-- ビリヤード場 レジシステム - Supabase セットアップSQL
-- Supabase Dashboard > SQL Editor で実行してください
-- ========================================================

-- user_profiles (auth.usersと1:1)
create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('staff', 'admin')) default 'staff'
);
alter table user_profiles enable row level security;
create policy "self or admin" on user_profiles for all using (
  auth.uid() = id or exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
);

-- tables (ビリヤード台)
create table if not exists tables (
  id uuid primary key default gen_random_uuid(),
  table_number int not null unique,
  status text not null check (status in ('empty', 'in_use')) default 'empty',
  note text
);
alter table tables enable row level security;
create policy "all authenticated" on tables for all using (auth.role() = 'authenticated');

-- members (会員)
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  member_number text unique not null,
  name text not null,
  customer_type text not null check (customer_type in ('general', 'female', 'student')) default 'general',
  phone text,
  birthday date,
  notes text,
  visit_count int default 0,
  total_spent int default 0,
  created_at timestamptz default now()
);
alter table members enable row level security;
create policy "all authenticated" on members for all using (auth.role() = 'authenticated');

-- sessions (プレーセッション)
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references tables(id),
  member_id uuid references members(id),
  customer_type text not null check (customer_type in ('general', 'female', 'student')) default 'general',
  pricing_type text not null check (pricing_type in ('hourly', 'freetime')) default 'hourly',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  total_play_fee int,
  total_food_fee int,
  grand_total int,
  is_paid boolean default false,
  created_at timestamptz default now()
);
alter table sessions enable row level security;
create policy "all authenticated" on sessions for all using (auth.role() = 'authenticated');

-- menu_items
create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('drink', 'food')),
  price int not null,
  is_available boolean default true
);
alter table menu_items enable row level security;
create policy "all authenticated" on menu_items for all using (auth.role() = 'authenticated');

-- order_items
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id),
  quantity int not null default 1,
  unit_price int not null
);
alter table order_items enable row level security;
create policy "all authenticated" on order_items for all using (auth.role() = 'authenticated');

-- pricing_master
create table if not exists pricing_master (
  id uuid primary key default gen_random_uuid(),
  customer_type text not null check (customer_type in ('general', 'female', 'student')),
  pricing_type text not null check (pricing_type in ('hourly', 'freetime')),
  price_per_minute numeric,
  freetime_price int,
  unique (customer_type, pricing_type)
);
alter table pricing_master enable row level security;
create policy "read authenticated" on pricing_master for select using (auth.role() = 'authenticated');
create policy "write admin" on pricing_master for all using (
  exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
);

-- shop_settings
create table if not exists shop_settings (
  id uuid primary key default gen_random_uuid(),
  business_start_time time not null default '10:00',
  business_end_time time not null default '03:00',
  updated_at timestamptz default now()
);
alter table shop_settings enable row level security;
create policy "read authenticated" on shop_settings for select using (auth.role() = 'authenticated');
create policy "write admin" on shop_settings for all using (
  exists (select 1 from user_profiles where id = auth.uid() and role = 'admin')
);

-- ========================================================
-- 初期データ投入
-- ========================================================

-- 台を作成
insert into tables (table_number) values
  (1), (2), (3), (4), (5), (99)
on conflict (table_number) do nothing;

-- 料金マスタ初期値
insert into pricing_master (customer_type, pricing_type, price_per_minute, freetime_price) values
  ('general', 'hourly',   10, null),
  ('general', 'freetime', null, 1500),
  ('female',  'hourly',   8,  null),
  ('female',  'freetime', null, 1200),
  ('student', 'hourly',   7,  null),
  ('student', 'freetime', null, 1000)
on conflict (customer_type, pricing_type) do nothing;

-- 店舗設定初期値
insert into shop_settings (business_start_time, business_end_time) values ('10:00', '03:00')
on conflict do nothing;

-- サンプルメニュー
insert into menu_items (name, category, price) values
  ('コーラ',         'drink', 300),
  ('オレンジジュース','drink', 300),
  ('ビール',         'drink', 500),
  ('ウーロン茶',     'drink', 300),
  ('ポテト',         'food',  400),
  ('唐揚げ',         'food',  500),
  ('ナポリタン',     'food',  700)
on conflict do nothing;

-- ========================================================
-- 管理者ユーザーの作成手順
-- ========================================================
-- 1. Supabase Dashboard > Authentication > Users > "Add user" でユーザーを作成
-- 2. 作成したユーザーのIDを確認してから以下を実行:
--
-- insert into user_profiles (id, name, role) values
--   ('ここにuser id を貼り付け', '管理者名', 'admin');
--
-- スタッフを追加する場合:
-- insert into user_profiles (id, name, role) values
--   ('ここにuser id を貼り付け', 'スタッフ名', 'staff');
-- ========================================================
