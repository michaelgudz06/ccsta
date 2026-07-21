-- Migration 039: fix minimum-hours order of operations in calculate_estimate.
--
-- WRONG (current): the 4hr/2hr minimum was applied to (trip_hours + driver
-- buffer) combined, so a short trip's 1hr buffer could get silently
-- absorbed into the minimum instead of always applying on top.
--
-- CORRECT (this migration): the minimum applies to TRIP TIME ONLY. The 1hr
-- driver buffer is always added on top of the (possibly floored) trip time.
--   billable_trip_hours = GREATEST(trip_hours, min_hours)
--   system_driver_hours = billable_trip_hours + driver_time_buffer_hours
-- Examples: non-member 2hr trip -> GREATEST(2,4)=4, +1 = 5hr billed.
--           member 1hr trip     -> GREATEST(1,2)=2, +1 = 3hr billed.
--
-- Two business decisions confirmed before this was written:
--   1. Melody's approved_driver_hours override is now FULLY AUTHORITATIVE —
--      the old outer GREATEST(driver_hours, min_hours) floor is removed
--      entirely. If she types a number below the minimum, that's what
--      bills. (For the system/default path this floor was already
--      redundant by construction, since billable_trip_hours + buffer is
--      always >= min_hours + 1 — removing it only changes behavior for
--      her manual override.)
--   2. reference_driver_hours (admin-only, informational, never billed)
--      keeps using the RAW trip_hours span, unchanged — it's meant to
--      show the true trip length for comparison, independent of the
--      minimum-billing rule.
--
-- New field in the returned jsonb: billable_trip_hours, so the admin/
-- customer "Trip time" display can show the floored value directly instead
-- of re-deriving it, and "Driver time" can be computed as
-- billable_hours - billable_trip_hours (not - trip_hours) to avoid
-- silently absorbing minimum-padding into the driver-time bucket.
--
-- No same-transaction gotcha: pure function-body change, no new
-- columns/types. Safe to run as one script.

CREATE OR REPLACE FUNCTION public.calculate_estimate(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote        quotes%ROWTYPE;
  v_ver          quote_versions%ROWTYPE;
  v_school       schools%ROWTYPE;
  v_students     int;
  v_young        numeric := 0;
  v_older        numeric := 0;
  v_seats        numeric;
  v_bench_seats  numeric;
  v_bench_count  int;
  v_bus_count    int;
  v_customer     text;
  v_trip_hours   numeric;
  v_pre_hours    numeric := 0;
  v_post_hours   numeric := 0;
  v_reference_driver_hours numeric;
  v_buffer_hours numeric;
  v_billable_trip_hours  numeric;
  v_system_driver_hours   numeric;
  v_driver_hours numeric;
  v_min_hours    numeric;
  v_bill_hours   numeric;
  v_rate         numeric;
  v_base_cost    numeric;
  v_fuel         numeric;
  v_overtime     numeric := 0;
  v_overtime_rate numeric;
  v_ot_threshold  numeric;
  v_fuel_per_trip numeric;
  v_distance_km   numeric;
  v_ld_threshold  numeric;
  v_ld_rate       numeric;
  v_long_distance numeric := 0;
  v_subtotal     numeric;
  v_gst_rate     numeric;
  v_gst          numeric;
  v_total        numeric;
  v_dest_match   destinations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;

  IF v_quote.customer_id != auth.uid() THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;

  SELECT * INTO v_ver    FROM quote_versions WHERE id = v_quote.current_version_id;
  SELECT * INTO v_school FROM schools        WHERE id = v_quote.school_id;

  -- Seat-based bus size + count.
  v_students := COALESCE(v_ver.student_count, 0);
  IF v_ver.grade_breakdown IS NOT NULL AND jsonb_typeof(v_ver.grade_breakdown) = 'array' THEN
    SELECT COALESCE(SUM(NULLIF(elem->>'count', '')::numeric), 0)
    INTO v_young
    FROM jsonb_array_elements(v_ver.grade_breakdown) AS elem
    WHERE lower(trim(elem->>'grade')) IN ('k', '1', '2', '3', '4');
  END IF;
  v_young := LEAST(v_young, v_students);                          -- can't exceed students
  v_older := GREATEST(v_students - v_young, 0) + COALESCE(v_ver.adults_count, 0);
  v_seats := v_young / 3.0 + v_older / 2.0;                       -- 3 young or 2 older per seat
  IF v_seats <= 0 THEN v_seats := 1; END IF;

  IF    v_seats <= 9     THEN v_bench_count := 18; v_bench_seats := 9;
  ELSIF v_seats <= 23.67 THEN v_bench_count := 47; v_bench_seats := 23.67;
  ELSE                        v_bench_count := 56; v_bench_seats := 28;
  END IF;
  v_bus_count := GREATEST(1, CEIL(v_seats / v_bench_seats));

  v_customer := CASE WHEN v_school.is_member THEN 'member' ELSE 'non_member' END;

  SELECT hourly_rate, min_hours INTO v_rate, v_min_hours
  FROM rate_config WHERE bench_count = v_bench_count AND customer_type = v_customer LIMIT 1;

  IF v_rate IS NULL THEN
    SELECT hourly_rate, min_hours INTO v_rate, v_min_hours
    FROM rate_config WHERE bench_count = v_bench_count AND customer_type = 'non_member' LIMIT 1;
  END IF;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'no rate found for bench_count=%, customer_type=%', v_bench_count, v_customer;
  END IF;

  SELECT value INTO v_fuel_per_trip FROM surcharge_config WHERE key = 'fuel_surcharge_per_trip';
  SELECT value INTO v_gst_rate      FROM surcharge_config WHERE key = 'gst_rate_pct';
  SELECT value INTO v_overtime_rate FROM surcharge_config WHERE key = 'overtime_rate_per_hour';
  SELECT value INTO v_ot_threshold  FROM surcharge_config WHERE key = 'overtime_threshold_hours';
  SELECT value INTO v_ld_threshold  FROM surcharge_config WHERE key = 'long_distance_threshold_km';
  SELECT value INTO v_ld_rate       FROM surcharge_config WHERE key = 'long_distance_rate_per_km';
  SELECT value INTO v_buffer_hours  FROM surcharge_config WHERE key = 'driver_time_buffer_hours';

  IF v_ver.departure_time IS NOT NULL AND v_ver.return_time IS NOT NULL THEN
    v_trip_hours := EXTRACT(EPOCH FROM (v_ver.return_time - v_ver.departure_time)) / 3600.0;
    IF v_trip_hours < 0 THEN v_trip_hours := v_trip_hours + 24; END IF;
  ELSE
    v_trip_hours := COALESCE(v_min_hours, 4);
  END IF;

  -- Per-location reference (informational, for admin only — no longer drives
  -- billing by default). Still computed live every call; not persisted.
  -- Deliberately uses the RAW trip_hours span (not the floored billable
  -- version below) — this stays honest to the true trip length for
  -- comparison, independent of the minimum-billing rule.
  SELECT * INTO v_dest_match FROM destinations
  WHERE lower(trim(name)) = lower(trim(v_school.name)) LIMIT 1;

  IF v_dest_match.id IS NULL AND v_ver.pickup_address IS NOT NULL THEN
    SELECT * INTO v_dest_match FROM destinations
    WHERE lower(trim(address)) ILIKE lower(trim(split_part(v_ver.pickup_address, ',', 1))) || '%' LIMIT 1;
  END IF;

  IF v_dest_match.id IS NOT NULL THEN
    v_pre_hours  := COALESCE(v_dest_match.pre_hours,  0);
    v_post_hours := COALESCE(v_dest_match.post_hours, 0);
  END IF;

  v_reference_driver_hours := v_trip_hours + v_pre_hours + v_post_hours;

  -- Minimum applies to TRIP TIME ONLY (the fix). The driver-time buffer is
  -- always added on top of the (possibly floored) trip time, never
  -- absorbed into the minimum.
  v_billable_trip_hours := GREATEST(v_trip_hours, COALESCE(v_min_hours, 4));

  -- System/public estimate: floored trip time + flat buffer — this is the
  -- audited "system-suggested" number, persisted every call.
  v_system_driver_hours := v_billable_trip_hours + COALESCE(v_buffer_hours, 1);

  -- Actual billing input: Melody's accurate override if she's set one,
  -- otherwise the system estimate above.
  v_driver_hours := COALESCE(v_ver.approved_driver_hours, v_system_driver_hours);

  -- No outer floor here (the fix, part 2): the system path already has the
  -- minimum baked in via v_billable_trip_hours above, so it's always
  -- >= min_hours + buffer regardless. Melody's override, if set, is now
  -- fully authoritative with no floor re-applied to it.
  v_bill_hours := v_driver_hours;

  IF v_ot_threshold IS NOT NULL AND v_driver_hours > v_ot_threshold THEN
    v_overtime := (v_driver_hours - v_ot_threshold) * COALESCE(v_overtime_rate, 17) * v_bus_count;
  END IF;

  -- Long-distance surcharge: $1/km for each one-way km beyond 200km, per bus.
  v_distance_km := COALESCE(v_ver.distance_km, 0);
  IF v_ld_threshold IS NOT NULL AND v_distance_km > v_ld_threshold THEN
    v_long_distance := (v_distance_km - v_ld_threshold) * COALESCE(v_ld_rate, 1) * v_bus_count;
  END IF;

  v_base_cost := v_bill_hours * v_rate * v_bus_count;
  v_fuel      := CASE WHEN v_ver.fuel_waived THEN 0
                       ELSE COALESCE(v_fuel_per_trip, 50) * v_bus_count END;
  v_subtotal  := v_base_cost + v_fuel + v_overtime + v_long_distance;
  v_gst       := v_subtotal * COALESCE(v_gst_rate, 5) / 100.0;
  v_total     := v_subtotal + v_gst;

  UPDATE quote_versions
  SET subtotal            = v_base_cost,
      surcharge_total     = v_fuel + v_overtime + v_long_distance,
      total               = v_total,
      system_driver_hours = v_system_driver_hours,
      updated_at          = now()
  WHERE id = v_ver.id;

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'bench_count', v_bench_count,
    'bus_count', v_bus_count,
    'seats_needed', round(v_seats, 2),
    'customer_type', v_customer,
    'hourly_rate', v_rate,
    'trip_hours', round(v_trip_hours, 2),
    'billable_trip_hours', round(v_billable_trip_hours, 2),
    'driver_pre_hours', round(v_pre_hours, 3),
    'driver_post_hours', round(v_post_hours, 3),
    'reference_driver_hours', round(v_reference_driver_hours, 2),
    'system_driver_hours', round(v_system_driver_hours, 2),
    'approved_driver_hours', v_ver.approved_driver_hours,
    'driver_hours_used', round(v_driver_hours, 2),
    'billable_hours', round(v_bill_hours, 2),
    'min_hours', v_min_hours,
    'base_cost', round(v_base_cost, 2),
    'fuel_surcharge', round(v_fuel, 2),
    'fuel_waived', v_ver.fuel_waived,
    'overtime_charge', round(v_overtime, 2),
    'distance_km', v_distance_km,
    'long_distance_charge', round(v_long_distance, 2),
    'subtotal', round(v_subtotal, 2),
    'gst_pct', COALESCE(v_gst_rate, 5),
    'gst', round(v_gst, 2),
    'total', round(v_total, 2),
    'destination_matched', v_dest_match.name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_estimate(uuid) TO authenticated;
