-- ============================================================
-- AA Drop Log & Farm Tracker - Supabase PostgreSQL Schema
-- Run this entire script in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- 1. API Keys (Per Discord User)
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Default Key',
  api_key text not null unique,
  discord_webhook_url text,
  alert_on_rare boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_api_keys_key on public.api_keys(api_key);
create index if not exists idx_api_keys_user on public.api_keys(user_id);

-- 2. Bot Accounts & Heartbeat Status
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bot_name text not null,
  roblox_username text,
  roblox_user_id bigint,
  status text not null default 'lobby', -- 'farming' | 'lobby' | 'offline'
  current_mode text,
  current_map text,
  current_wave text,
  last_heartbeat timestamptz not null default now(),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, bot_name)
);

create index if not exists idx_accounts_user on public.accounts(user_id);

-- 3. Run & Drop Logs
create table if not exists public.run_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  bot_name text not null,
  mode text not null default 'Dungeon',
  map_name text not null default 'Unknown',
  result text not null default 'Win', -- 'Win' | 'Lose'
  duration_sec integer not null default 0,
  rewards jsonb not null default '[]'::jsonb,
  -- rewards format: [{ "name": "Gems", "amount": 150, "category": "currency", "rarity": "common" }, ...]
  created_at timestamptz not null default now()
);

create index if not exists idx_run_logs_user_time on public.run_logs(user_id, created_at desc);

-- 4. Inventory Snapshots (Latest balance per bot)
create table if not exists public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  currencies jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security (RLS)
-- Users can only view/manage their own data
-- ============================================================
alter table public.api_keys enable row level security;
alter table public.accounts enable row level security;
alter table public.run_logs enable row level security;
alter table public.inventory_snapshots enable row level security;

create policy "Users manage own api_keys"
  on public.api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users view own accounts"
  on public.accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users view own run_logs"
  on public.run_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users view own inventory_snapshots"
  on public.inventory_snapshots for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Grant table permissions to Supabase API roles (RLS still enforces per-user isolation)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
