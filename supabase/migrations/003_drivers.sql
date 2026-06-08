-- Migration 003: drivers, driver_no_pair_constraints, driver_bus_clearances
-- Drivers are managed by admin. They optionally link to a Supabase Auth user
-- (profile_id) which enables the driver portal login.
-- Bus clearances and no-pair constraints live in separate tables for clarity.

create type public.driver_trip_type as enum ('route', 'field_trip', 'both');

create table if not exists public.drivers (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references public.profiles(id) on delete set null,  -- nullable: driver may not have login
  first_name    text not null,
  last_name     text not null,
  email         text,
  phone         text,
  home_yard_id  uuid references public.yards(id),
  air_brake_cert boolean not null default false,
  trip_type     public.driver_trip_type not null default 'both',
  active        boolean not null default true,
  notes         text,
  samsara_driver_id text,                          -- populated in Phase 5
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger drivers_updated_at
  before update on public.drivers
  for each row execute function public.set_updated_at();

-- Which bus bench sizes a driver is cleared to operate.
-- One row per (driver, bench_count) pair.
create table if not exists public.driver_bus_clearances (
  driver_id   uuid not null references public.drivers(id) on delete cascade,
  bench_count smallint not null,
  primary key (driver_id, bench_count)
);

-- Pairs of drivers that cannot be scheduled on the same trip.
-- driver_a_id < driver_b_id enforces canonical ordering to prevent duplicates.
create table if not exists public.driver_no_pair_constraints (
  id          uuid primary key default gen_random_uuid(),
  driver_a_id uuid not null references public.drivers(id) on delete cascade,
  driver_b_id uuid not null references public.drivers(id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint no_pair_ordered check (driver_a_id < driver_b_id),
  unique (driver_a_id, driver_b_id)
);

-- RLS: drivers can read their own record; admins can manage all
alter table public.drivers enable row level security;

create policy "drivers_own_read"
  on public.drivers for select
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "drivers_admin_write"
  on public.drivers for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Clearances: drivers can read own; admins manage all
alter table public.driver_bus_clearances enable row level security;

create policy "clearances_own_read"
  on public.driver_bus_clearances for select
  using (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "clearances_admin_write"
  on public.driver_bus_clearances for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- No-pair constraints: admin only
alter table public.driver_no_pair_constraints enable row level security;

create policy "no_pair_admin_all"
  on public.driver_no_pair_constraints for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
