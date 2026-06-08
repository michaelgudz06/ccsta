-- Migration 000: profiles (must run before any table that references profiles.id)
-- Extends Supabase Auth users with the application role and shared fields.

-- Shared utility: set updated_at to now() on every row update.
-- Referenced by all tables with an updated_at column.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create type public.app_role as enum ('customer', 'driver', 'admin');

create table if not exists public.profiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  role    public.app_role not null default 'customer',
  email   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- RLS
alter table public.profiles enable row level security;

-- Users can read their own profile; admins can read all
create policy "profiles_self_read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_admin_read"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id);

create policy "profiles_admin_write"
  on public.profiles for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Auto-create a profile row when a new Auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, role, email)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'customer'),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
