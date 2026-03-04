-- Gate-1 schema for creator/public series flow

create extension if not exists pgcrypto;

create table if not exists seller_profiles (
  user_id uuid primary key,
  status text not null default 'active',
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists series (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  slug text not null unique,
  title text not null,
  description text not null,
  category text not null default 'lure',
  purchase_url text not null,
  status text not null default 'draft',
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_status_check check (status in ('draft', 'published', 'suspended'))
);

create index if not exists idx_series_owner on series(owner_user_id);
create index if not exists idx_series_slug on series(slug);
create index if not exists idx_series_status on series(status);

create table if not exists series_prizes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references series(id) on delete cascade,
  name text not null,
  image_url text,
  stock integer not null default 0,
  weight integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_prizes_stock_check check (stock >= 0),
  constraint series_prizes_weight_check check (weight >= 1)
);

create index if not exists idx_series_prizes_series on series_prizes(series_id);
create index if not exists idx_series_prizes_active on series_prizes(series_id, is_active, stock);

create table if not exists series_spin_results (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references series(id) on delete cascade,
  prize_id uuid references series_prizes(id) on delete set null,
  visitor_token_hash text,
  result text not null,
  created_at timestamptz not null default now(),
  constraint series_spin_results_result_check check (result in ('WIN', 'LOSE'))
);

create index if not exists idx_series_spin_results_series on series_spin_results(series_id, created_at desc);
