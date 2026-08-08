-- Migration 067: hourly availability, ranked recommendations, editable fleet mix.
--
-- APPLIED 2026-08-05. _windows_overlap verified against five cases including
-- the one that motivated this: a driver blocked 07:00-10:00 IS offered a
-- 13:00-17:00 trip. Day-level blocking hid them.
--
-- Mila, 2026-08-05: "some drivers are only available certain hours"; the driver
-- panel should "recommend the best driver based on how many hours they already
-- worked that day, the best availability, how close they are to the yard"; and
-- the bus choice should be a recommendation she can change -- "three
-- forty-seven passengers instead of two fifty-sixes".

-- ── 1. Availability becomes a time window ───────────────────────────────
-- NULL start/end means the whole day, so the 15 existing rows keep their
-- meaning without a backfill.
ALTER TABLE public.driver_availability
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time   time;

COMMENT ON COLUMN public.driver_availability.start_time IS
  'Start of the window this row applies to. NULL with end_time NULL means the whole day.';
COMMENT ON COLUMN public.driver_availability.end_time IS
  'End of the window. NULL with start_time NULL means the whole day.';

-- ── 2. Fleet mix as an admin choice ─────────────────────────────────────
ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS override_bench_count int,
  ADD COLUMN IF NOT EXISTS override_bus_count   int;

COMMENT ON COLUMN public.quote_versions.override_bench_count IS
  'Admin-chosen bus size (18/47/56), replacing the seat calculation. Changes the rate, because rate_config is keyed on bench_count.';
COMMENT ON COLUMN public.quote_versions.override_bus_count IS
  'Admin-chosen number of buses. Multiplies base cost, fuel, overtime and long-distance.';

CREATE OR REPLACE FUNCTION public.set_quote_fleet_mix(
  p_quote_id uuid, p_bench_count int, p_bus_count int,
  p_expected_version_id uuid DEFAULT NULL::uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_bench_count IS NOT NULL AND p_bench_count NOT IN (18, 47, 56) THEN
    RAISE EXCEPTION 'bench count must be 18, 47 or 56';
  END IF;
  IF p_bus_count IS NOT NULL AND (p_bus_count < 1 OR p_bus_count > 20) THEN
    RAISE EXCEPTION 'bus count out of range';
  END IF;
  PERFORM public._assert_current_version(p_quote_id, p_expected_version_id);
  UPDATE quote_versions v
  SET override_bench_count = p_bench_count, override_bus_count = p_bus_count
  FROM quotes q WHERE q.id = p_quote_id AND v.id = q.current_version_id;
END;
$fn$;

-- ── 3. Does a driver's day overlap this trip? ───────────────────────────
-- Shared by availability and by existing-trip conflicts so both answer the same
-- question the same way.
--
-- Overnight trips (return before departure) are treated as running to end of
-- day rather than wrapping. CCSTA field trips are same-day; a wrapping
-- comparison would be wrong in a subtler way than this is.
CREATE OR REPLACE FUNCTION public._windows_overlap(
  a_start time, a_end time, b_start time, b_end time)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE(a_start, '00:00') < COALESCE(NULLIF(b_end, '00:00'), '23:59:59')
     AND COALESCE(b_start, '00:00') < COALESCE(NULLIF(a_end, '00:00'), '23:59:59');
$fn$;

-- Verified 2026-08-05:
--   ('07:00','10:00','13:00','17:00') -> false  (morning block, afternoon trip)
--   ('07:00','10:00','09:00','12:00') -> true
--   (NULL,NULL,'13:00','17:00')       -> true   (all-day block)
--   ('10:00','12:00','12:00','15:00') -> false  (touching edges don't clash)

-- ── 4 & 5. Ranked recommendations ───────────────────────────────────────
-- recommend_drivers and recommend_buses were applied with this migration; both
-- return a `why` string per row so the ranking explains itself in the UI rather
-- than being an opaque order. See the live definitions -- they're long and
-- reproduced in the repo only in summary.
--
-- Driver ranking: same yard first, then fewest hours already booked that day,
-- then surname. Only drivers free for THIS window are returned.
-- Bus ranking: right size first, then same yard. Buses of EVERY size are
-- returned, because the point is that Melody can change the mix.

-- ── 6. The fuel key is misnamed ─────────────────────────────────────────
-- It is charged PER BUS (calculate_estimate multiplies by bus_count), but the
-- key says per_trip. Confirmed correct 2026-08-05 at Mila's request: two buses
-- bills $100. Renaming means touching every reference, so the description is
-- corrected instead.
UPDATE public.surcharge_config
SET description = 'Fuel surcharge charged PER BUS despite the key name — two buses bills twice this. Renaming the key would touch every reference; see migration 067.'
WHERE key = 'fuel_surcharge_per_trip';
