-- Migration 008: trips
-- A trip is a confirmed, scheduled event derived from an approved quote.
-- It records both the planned details (from quote_version) and actuals
-- (odometer, timestamps) filled in post-trip for payroll and reconciliation.

create type public.trip_status as enum (
  'scheduled',
  'in_progress',
  'completed',
  'cancelled'
);

create table if not exists public.trips (
  id                  uuid primary key default gen_random_uuid(),
  trip_number         text not null unique,         -- e.g. 'T-3041'
  quote_id            uuid references public.quotes(id),
  quote_version_id    uuid references public.quote_versions(id),
  school_id           uuid references public.schools(id),
  bus_id              uuid references public.buses(id),
  driver_id           uuid references public.drivers(id),
  -- Planned details (from the confirmed quote version)
  trip_date           date not null,
  departure_time      time,
  return_time         time,
  destination_name    text,
  destination_address text,
  student_count       smallint,
  -- Status tracking
  status              public.trip_status not null default 'scheduled',
  -- Post-trip actuals (filled in by driver / admin after the trip)
  actual_departure    timestamptz,
  actual_return       timestamptz,
  odometer_start      int,
  odometer_end        int,
  -- Notes
  driver_notes        text,                         -- visible to driver, editable by driver
  admin_notes         text,                         -- admin only
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trips_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

create index trips_driver_id_idx on public.trips (driver_id);
create index trips_trip_date_idx on public.trips (trip_date);
create index trips_quote_id_idx  on public.trips (quote_id);

alter table public.trips enable row level security;

-- Drivers can read trips assigned to them; customers can read their own;
-- admins can manage all
create policy "trips_driver_read"
  on public.trips for select
  using (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.quotes q
      where q.id = quote_id and q.customer_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Drivers can update their own trip notes and actuals (post-trip data entry)
create policy "trips_driver_update"
  on public.trips for update
  using (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.profile_id = auth.uid()
    )
  );

create policy "trips_admin_write"
  on public.trips for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
