-- Migration 009: invoices
-- One invoice per quote (may cover multiple trips if a school books several).
-- sage_export_data stores the formatted payload for Sage 50 import so
-- Melody can download it directly from the admin console.

create type public.invoice_status as enum (
  'draft',
  'sent',
  'paid',
  'overdue',
  'cancelled'
);

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  text not null unique,            -- e.g. 'INV-2026-0142'
  quote_id        uuid references public.quotes(id),
  school_id       uuid references public.schools(id),
  -- Line amounts
  subtotal        numeric(10,2) not null,
  tax_amount      numeric(10,2) not null default 0,
  total           numeric(10,2) not null,
  -- Status and dates
  status          public.invoice_status not null default 'draft',
  issued_date     date,
  due_date        date,
  paid_at         timestamptz,
  -- Sage 50 export payload (generated server-side, downloaded by admin)
  sage_export_data jsonb,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create index invoices_quote_id_idx   on public.invoices (quote_id);
create index invoices_school_id_idx  on public.invoices (school_id);

alter table public.invoices enable row level security;

-- Customers can read invoices for their own quotes
create policy "invoices_own_read"
  on public.invoices for select
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

create policy "invoices_admin_write"
  on public.invoices for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
