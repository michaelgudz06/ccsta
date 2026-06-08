-- Migration 002: buses
-- Every trip requires a bus. Buses belong to a home yard and have a bench
-- count that determines which rate tier applies. Air-brake flag gates which
-- drivers can operate the bus (requires air-brake cert).

create table if not exists public.buses (
  id               uuid primary key default gen_random_uuid(),
  fleet_number     text not null unique,        -- e.g. "Bus 14", "Bus 22"
  bench_count      smallint not null,            -- 18 | 47 | 56 (determines rate tier)
  air_brake_req    boolean not null default false, -- true → driver must have air-brake cert
  home_yard_id     uuid references public.yards(id),
  serial_number    text,
  active           boolean not null default true,
  notes            text,
  samsara_vehicle_id text,                        -- populated in Phase 5
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger buses_updated_at
  before update on public.buses
  for each row execute function public.set_updated_at();

-- RLS: admins can manage; all authenticated users can read (needed to display
-- bus assignments on quotes and driver dashboard)
alter table public.buses enable row level security;

create policy "buses_auth_read"
  on public.buses for select
  using (auth.uid() is not null);

create policy "buses_admin_write"
  on public.buses for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
