-- Migration 005: schools
-- Member schools have a full saved profile (contact, district, etc.).
-- Non-member schools are captured by name + address from the quote request form
-- and can be promoted to member status later by admin.

create table if not exists public.schools (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  address         text,
  city            text,
  postal_code     text,
  district        text,
  is_member       boolean not null default false,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger schools_updated_at
  before update on public.schools
  for each row execute function public.set_updated_at();

alter table public.schools enable row level security;

-- All authenticated users can read schools (needed for quote form autocomplete
-- and for customers to associate their school with a quote)
create policy "schools_auth_read"
  on public.schools for select
  using (auth.uid() is not null);

create policy "schools_admin_write"
  on public.schools for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
