-- ============================================================
--  每日记账 · Supabase 数据库建表脚本
--  使用方法：
--    1. 打开你的 Supabase 项目 → 左侧菜单 "SQL Editor" → "New query"
--    2. 把本文件全部内容粘贴进去 → 点 "Run" 运行
--    3. 看到 "Success" 即完成（三张表 + 权限策略全部建好）
--  说明：每张表都用 user_id 关联登录用户，并通过 RLS 策略保证
--        A 用户绝对看不到、改不了 B 用户的数据。
-- ============================================================

-- ---------- 开启 uuid 扩展（生成主键用） ----------
create extension if not exists "pgcrypto";

-- ============================================================
--  表 1：流水记录（每一笔收入 / 支出）
-- ============================================================
create table if not exists public.records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('expense', 'income')),  -- 支出 / 收入
  category    text not null,                                        -- 分类名称
  amount      numeric(12,2) not null check (amount >= 0),           -- 金额（元）
  note        text default '',                                       -- 备注
  txn_at      timestamptz not null default now(),                   -- 这笔钱发生的日期时间
  updated_at  timestamptz not null default now(),                   -- 最后修改时间（同步用）
  created_at  timestamptz not null default now()
);

create index if not exists records_user_txn_at_idx
  on public.records (user_id, txn_at desc);

-- ============================================================
--  表 2：分类（支出 / 收入分类，含图标与配色）
-- ============================================================
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('expense', 'income')),
  name        text not null,
  icon        text not null default '📦',   -- emoji 图标
  color       text not null default '#888888',
  builtin     boolean not null default false,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (user_id, type, name)
);

-- ============================================================
--  表 3：每月预算（总预算 + 各分类预算）
-- ============================================================
create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  month       text not null,                          -- 形如 2026-11
  total       numeric(12,2) not null default 0,       -- 当月总预算
  items       jsonb not null default '{}'::jsonb,     -- { "分类名": 分类预算金额 }
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (user_id, month)
);

-- ============================================================
--  RLS 行级安全：每张表只允许本人访问本人数据
-- ============================================================
alter table public.records   enable row level security;
alter table public.categories enable row level security;
alter table public.budgets    enable row level security;

-- ---- records ----
create policy "records_select_own" on public.records
  for select using (auth.uid() = user_id);
create policy "records_insert_own" on public.records
  for insert with check (auth.uid() = user_id);
create policy "records_update_own" on public.records
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "records_delete_own" on public.records
  for delete using (auth.uid() = user_id);

-- ---- categories ----
create policy "categories_select_own" on public.categories
  for select using (auth.uid() = user_id);
create policy "categories_insert_own" on public.categories
  for insert with check (auth.uid() = user_id);
create policy "categories_update_own" on public.categories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "categories_delete_own" on public.categories
  for delete using (auth.uid() = user_id);

-- ---- budgets ----
create policy "budgets_select_own" on public.budgets
  for select using (auth.uid() = user_id);
create policy "budgets_insert_own" on public.budgets
  for insert with check (auth.uid() = user_id);
create policy "budgets_update_own" on public.budgets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "budgets_delete_own" on public.budgets
  for delete using (auth.uid() = user_id);
