-- Migration 014: seed real 2026-2027 rates from the quote templates

-- Add customer_type to support member / non-member / church pricing tiers
ALTER TABLE public.rate_config
  ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'non_member'
  CHECK (customer_type IN ('non_member', 'member', 'church'));

-- Replace single-column unique key with composite
ALTER TABLE public.rate_config DROP CONSTRAINT IF EXISTS rate_config_bench_count_key;
ALTER TABLE public.rate_config
  ADD CONSTRAINT rate_config_bench_customer_unique UNIQUE (bench_count, customer_type);

-- Real rates from 2026-2027 rate sheet
INSERT INTO public.rate_config (bench_count, customer_type, hourly_rate, min_hours, min_charge, label) VALUES
  (18, 'non_member', 92.50,  4.0, 370.00, '18-seat mini-bus (non-member)'),
  (47, 'non_member', 92.50,  4.0, 370.00, '47-seat coach (non-member)'),
  (56, 'non_member', 105.00, 4.0, 420.00, '56-seat coach (non-member)'),
  (18, 'member',     68.25,  2.0, 136.50, '18-seat mini-bus (member)'),
  (47, 'member',     68.25,  2.0, 136.50, '47-seat coach (member)'),
  (56, 'member',     78.75,  2.0, 157.50, '56-seat coach (member)'),
  (47, 'church',     78.75,  2.0, 157.50, '47-seat coach (church)'),
  (56, 'church',     89.25,  2.0, 178.50, '56-seat coach (church)')
ON CONFLICT (bench_count, customer_type) DO UPDATE SET
  hourly_rate = EXCLUDED.hourly_rate,
  min_hours   = EXCLUDED.min_hours,
  min_charge  = EXCLUDED.min_charge,
  label       = EXCLUDED.label,
  updated_at  = now();

-- Real surcharges from 2026-2027 rate sheet
-- Fuel = $50 flat per trip (NOT a percentage)
-- Long distance = $1/km beyond first 200km
-- Overtime = $17/hr for driver time beyond 8h
-- GST = 5%  (GST# 129645727)
-- Driver buffer = 10 min before pickup (per template formula)
INSERT INTO public.surcharge_config (key, value, unit, description) VALUES
  ('fuel_surcharge_per_trip',    50.00, 'dollars',          'Flat fuel surcharge per trip per bus'),
  ('long_distance_threshold_km', 200.00, 'km',              'One-way km threshold before per-km charge'),
  ('long_distance_rate_per_km',  1.00,  'dollars_per_km',   'Additional charge per km beyond threshold'),
  ('overtime_threshold_hours',   8.00,  'hours',            'Trip hours before overtime applies'),
  ('overtime_rate_per_hour',     17.00, 'dollars_per_hour', 'Per-hour charge for driver time beyond 8h'),
  ('gst_rate_pct',               5.00,  'percent',          'GST rate — GST# 129645727'),
  ('driver_buffer_minutes',      10.00, 'minutes',          'Pre-trip buffer before scheduled pickup')
ON CONFLICT (key) DO UPDATE SET
  value       = EXCLUDED.value,
  unit        = EXCLUDED.unit,
  description = EXCLUDED.description,
  updated_at  = now();
