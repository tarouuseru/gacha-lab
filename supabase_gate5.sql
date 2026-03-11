-- Gate-5 schema: daily API usage limiter for free-tier protection

create table if not exists api_daily_usage (
  bucket_key text not null,
  usage_date date not null default ((now() at time zone 'utc')::date),
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint api_daily_usage_pkey primary key (bucket_key, usage_date),
  constraint api_daily_usage_count_check check (count >= 0)
);

create index if not exists idx_api_daily_usage_updated on api_daily_usage(updated_at desc);

create or replace function increment_daily_usage(p_bucket_key text, p_limit integer)
returns table (allowed boolean, current_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_bucket_key is null or length(trim(p_bucket_key)) = 0 then
    raise exception 'p_bucket_key is required';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be >= 1';
  end if;

  insert into public.api_daily_usage (bucket_key, usage_date, count, updated_at)
  values (p_bucket_key, (now() at time zone 'utc')::date, 1, now())
  on conflict (bucket_key, usage_date)
  do update
    set count = case
      when public.api_daily_usage.count < p_limit then public.api_daily_usage.count + 1
      else public.api_daily_usage.count
    end,
    updated_at = now()
  returning api_daily_usage.count into v_count;

  return query
  select (v_count <= p_limit) as allowed, v_count as current_count;
end;
$$;
