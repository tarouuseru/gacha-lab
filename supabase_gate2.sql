-- Gate-2 schema: billing + moderation + audit

create table if not exists seller_subscriptions (
  user_id uuid primary key,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_code text not null default 'creator_monthly',
  status text not null default 'inactive',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_seller_subscriptions_status on seller_subscriptions(status);
create unique index if not exists idx_seller_subscriptions_customer on seller_subscriptions(stripe_customer_id);
create unique index if not exists idx_seller_subscriptions_subscription on seller_subscriptions(stripe_subscription_id);

create table if not exists series_reports (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references series(id) on delete cascade,
  reporter_contact text,
  reason_code text not null,
  detail text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint series_reports_status_check check (status in ('open', 'closed'))
);

create index if not exists idx_series_reports_series on series_reports(series_id, created_at desc);
create index if not exists idx_series_reports_status on series_reports(status, created_at desc);

create table if not exists moderation_actions (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  action text not null,
  reason text,
  actor text not null default 'admin',
  created_at timestamptz not null default now(),
  constraint moderation_actions_target_type_check check (target_type in ('series', 'user')),
  constraint moderation_actions_action_check check (action in ('suspend', 'unsuspend'))
);

create index if not exists idx_moderation_actions_target on moderation_actions(target_type, target_id, created_at desc);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_action on audit_logs(action, created_at desc);
create index if not exists idx_audit_logs_target on audit_logs(target_type, target_id, created_at desc);
