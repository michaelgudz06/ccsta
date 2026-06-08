-- Migration 010: payroll_records
-- One record per driver per trip. Hours and category are determined by the
-- payroll engine (Phase 6); for now they can be set manually by admin.
-- hours_category is a configurable label (e.g. 'straight', 'overtime_1.5x')
-- whose meaning is set in admin config — not hardcoded here.

create type public.payroll_status as enum (
  'draft',
  'processed',
  'paid'
);

create table if not exists public.payroll_records (
  id               uuid primary key default gen_random_uuid(),
  driver_id        uuid not null references public.drivers(id),
  trip_id          uuid references public.trips(id),
  pay_period_start date not null,
  pay_period_end   date not null,
  -- Hours breakdown
  hours_worked     numeric(5,2) not null default 0,
  hours_category   text,                            -- 'straight' | 'overtime_1.5x' | etc. (admin-configured label)
  -- Rate snapshot (driver's rate at time of record, not a live lookup)
  hourly_rate_snapshot numeric(8,2),
  gross_pay        numeric(10,2),
  -- Status
  status           public.payroll_status not null default 'draft',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger payroll_records_updated_at
  before update on public.payroll_records
  for each row execute function public.set_updated_at();

create index payroll_driver_id_idx on public.payroll_records (driver_id);
create index payroll_period_idx    on public.payroll_records (pay_period_start, pay_period_end);

alter table public.payroll_records enable row level security;

-- Drivers can read their own payroll records
create policy "payroll_driver_read"
  on public.payroll_records for select
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

create policy "payroll_admin_write"
  on public.payroll_records for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
