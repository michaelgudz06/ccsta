-- Migration 004: driver_availability
-- Tracks per-driver, per-date availability. Defaults to 'unknown' (not 'unavailable')
-- because some drivers also work for other companies and don't pre-declare.
-- Both the driver (own dates) and admin (all dates) can set availability.

create type public.availability_status as enum ('available', 'unavailable', 'unknown');

create table if not exists public.driver_availability (
  id         uuid primary key default gen_random_uuid(),
  driver_id  uuid not null references public.drivers(id) on delete cascade,
  date       date not null,
  status     public.availability_status not null default 'unknown',
  note       text,                                  -- free-text e.g. "half day only"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, date)
);

create trigger driver_availability_updated_at
  before update on public.driver_availability
  for each row execute function public.set_updated_at();

alter table public.driver_availability enable row level security;

-- Drivers can read and write their own availability dates
create policy "availability_own_read"
  on public.driver_availability for select
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

create policy "availability_own_write"
  on public.driver_availability for insert
  with check (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "availability_own_update"
  on public.driver_availability for update
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

create policy "availability_admin_delete"
  on public.driver_availability for delete
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
