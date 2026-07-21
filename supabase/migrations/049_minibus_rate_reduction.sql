-- Migration 049: minibus (18-bench) is $10/hr cheaper than the 47-passenger
-- coach, for both tiers -- was incorrectly priced identically to the 47.
-- min_charge = hourly_rate x min_hours (unchanged: 4hr non-member, 2hr member).
-- Scoped update, not a full reseed -- only the two 18-bench rows change.
-- No church row exists for bench_count = 18 (church tier is only 47/56).

UPDATE public.rate_config
SET hourly_rate = 82.50, min_charge = 330.00, updated_at = now()
WHERE bench_count = 18 AND customer_type = 'non_member';

UPDATE public.rate_config
SET hourly_rate = 58.25, min_charge = 116.50, updated_at = now()
WHERE bench_count = 18 AND customer_type = 'member';
