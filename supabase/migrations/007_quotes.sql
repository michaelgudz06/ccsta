-- Migration 007: quotes and quote_versions
-- Quotes go through a multi-step approval flow. Each admin edit creates a new
-- version (snapshot) so the full pricing history is preserved.
-- The circular FK (quotes.current_version_id → quote_versions) is handled by
-- creating quotes first, then versions, then adding the FK column.

create type public.quote_status as enum (
  'requested',   -- customer submitted the form
  'in_review',   -- Melody/Alan looking at it
  'approved',    -- Melody signed off on the estimate
  'confirmed',   -- customer accepted
  'scheduled',   -- driver + bus assigned
  'completed',   -- trip happened
  'invoiced',    -- invoice sent
  'cancelled'
);

-- Step 1: quotes without current_version_id (avoids circular FK at create time)
create table if not exists public.quotes (
  id                  uuid primary key default gen_random_uuid(),
  quote_number        text not null unique,        -- e.g. 'Q-2026-0142'
  school_id           uuid references public.schools(id),
  customer_id         uuid not null references public.profiles(id),
  status              public.quote_status not null default 'requested',
  current_version_id  uuid,                        -- FK added after quote_versions exists
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger quotes_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

-- Step 2: quote_versions — locked snapshot of each estimate revision
create table if not exists public.quote_versions (
  id                   uuid primary key default gen_random_uuid(),
  quote_id             uuid not null references public.quotes(id) on delete cascade,
  version_number       smallint not null,
  -- Trip details at time of version
  destination_name     text,
  destination_address  text,
  trip_date            date,
  departure_time       time,
  return_time          time,
  student_count        smallint,
  -- Suggested assignment (may differ from final trip assignment)
  suggested_bus_id     uuid references public.buses(id),
  suggested_driver_id  uuid references public.drivers(id),
  -- Pricing snapshot (rates frozen at version creation, not live rate_config)
  estimated_hours      numeric(5,2),
  rate_snapshot        jsonb,                       -- copy of rate_config row at time of quote
  surcharge_snapshot   jsonb,                       -- copy of surcharge_config at time of quote
  subtotal             numeric(10,2),
  surcharge_total      numeric(10,2) default 0,
  total                numeric(10,2),
  -- Notes
  internal_notes       text,                        -- admin only
  customer_notes       text,                        -- visible to customer
  -- Audit
  created_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  unique (quote_id, version_number)
);

-- Step 3: add the FK back to quotes now that quote_versions exists
alter table public.quotes
  add constraint quotes_current_version_fk
  foreign key (current_version_id)
  references public.quote_versions(id)
  on delete set null;

-- Indexes for common lookups
create index quotes_customer_id_idx on public.quotes (customer_id);
create index quotes_status_idx on public.quotes (status);
create index quote_versions_quote_id_idx on public.quote_versions (quote_id);

-- RLS: customers can read their own quotes; admins can manage all
alter table public.quotes enable row level security;

create policy "quotes_own_read"
  on public.quotes for select
  using (
    customer_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "quotes_customer_insert"
  on public.quotes for insert
  with check (customer_id = auth.uid());

create policy "quotes_admin_write"
  on public.quotes for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

alter table public.quote_versions enable row level security;

create policy "quote_versions_own_read"
  on public.quote_versions for select
  using (
    exists (
      select 1 from public.quotes q
      where q.id = quote_id and q.customer_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

create policy "quote_versions_admin_write"
  on public.quote_versions for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
