-- Migration 006: rate_config and surcharge_config
-- NO hardcoded prices anywhere in application code. All rates live here and
-- are loaded server-side for estimate calculations.
-- Rows will be populated by admin once Curtis sends the rate sheet.

-- One row per bus size tier. Curtis's rate sheet will fill in the numbers.
create table if not exists public.rate_config (
  id          uuid primary key default gen_random_uuid(),
  bench_count smallint not null unique,  -- matches buses.bench_count (e.g. 18, 47, 56)
  hourly_rate numeric(8,2) not null,     -- $ per hour for this bus size
  min_hours   numeric(4,2) not null default 2.0,  -- minimum billable hours
  min_charge  numeric(10,2) not null,    -- minimum total charge regardless of hours
  label       text not null,             -- display label e.g. "18-seat mini-bus"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger rate_config_updated_at
  before update on public.rate_config
  for each row execute function public.set_updated_at();

-- Key-value store for surcharges and other variable config.
-- unit: 'percent' (e.g. fuel surcharge 5%) | 'dollars_per_km' | 'km' (threshold)
create table if not exists public.surcharge_config (
  key         text primary key,          -- e.g. 'fuel_surcharge_pct', 'out_of_radius_km'
  value       numeric(12,4) not null,
  unit        text not null,             -- 'percent' | 'dollars' | 'km' | 'dollars_per_km'
  description text,
  updated_at  timestamptz not null default now()
);

-- RLS: all authenticated users can read rates (needed for quote display).
-- Only admins can write (Melody / Alan set the rates).
alter table public.rate_config enable row level security;

create policy "rate_config_auth_read"
  on public.rate_config for select
  using (auth.uid() is not null);

create policy "rate_config_admin_write"
  on public.rate_config for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

alter table public.surcharge_config enable row level security;

create policy "surcharge_config_auth_read"
  on public.surcharge_config for select
  using (auth.uid() is not null);

create policy "surcharge_config_admin_write"
  on public.surcharge_config for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
