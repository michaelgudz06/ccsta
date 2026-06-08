-- Migration 001: yards
-- Every bus and driver has a home yard.
-- Customer-facing estimates are standardised on the Surrey yard.
-- Yards are also registered as Samsara geofences (Phase 5).

create table if not exists public.yards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                        -- e.g. "Surrey Main"
  address     text not null,
  lat         numeric(10, 7),
  lng         numeric(10, 7),
  is_default  boolean not null default false,       -- the yard used for customer-facing estimates
  samsara_geofence_id text,                         -- populated in Phase 5
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Only one yard can be the default
create unique index yards_single_default on public.yards (is_default) where is_default = true;

create trigger yards_updated_at
  before update on public.yards
  for each row execute function public.set_updated_at();

-- RLS: admins can manage yards; everyone else can read (needed to show pickup yard on quotes)
alter table public.yards enable row level security;

create policy "yards_read_all"
  on public.yards for select
  using (true);

create policy "yards_admin_write"
  on public.yards for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

-- Seed: Surrey main yard (the default for customer-facing estimates)
insert into public.yards (name, address, lat, lng, is_default)
values (
  'Surrey Main',
  '8888 162 Street, Surrey, BC, V4N 3G1',
  49.1547,
  -122.7761,
  true
)
on conflict do nothing;
