-- Migration 017: calculate_estimate — server-side quote estimate engine
--
-- Business rules (from 2026-2027 rate sheet):
--   Bus capacity (2-per-bench): 18→36 pax, 47→94 pax, 56→112 pax
--   bus_count = ceil(headcount / bench_capacity)
--   billable_hours = max(trip_hours + driver_yard_hours, min_hours) per bus
--   fuel_surcharge = $50 flat × bus_count
--   long_distance = $1/km × km_beyond_200 (only when Google Maps key available)
--   overtime = $16/hr × (total_hours - 8) when total_hours > 8, per bus
--   gst = 5%
--   customer_type: member (is_member=true) | church | non_member
--
-- Also updates quote_versions.total/subtotal/surcharge_total so quote display
-- always shows a current estimate.

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
  v_headcount    int;
  v_bench_cap    int;
  v_bench_count  int;
  v_bus_count    int;
  v_customer     text;
  v_trip_hours   numeric;
  v_pre_hours    numeric := 0;
  v_post_hours   numeric := 0;
  v_driver_hours numeric;
  v_total_hours  numeric;
  v_min_hours    numeric;
  v_bill_hours   numeric;
  v_rate         numeric;
  v_base_cost    numeric;
  v_fuel         numeric;
  v_overtime     numeric := 0;
  v_overtime_rate numeric;
  v_ot_threshold  numeric;
  v_fuel_per_trip numeric;
  v_subtotal     numeric;
  v_gst_rate     numeric;
  v_gst          numeric;
  v_total        numeric;
  v_dest_match   destinations%ROWTYPE;
BEGIN
  -- Any authenticated user can call this (customers see their own estimate,
  -- admins see all quotes).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;

  -- Only the customer who owns it, or an admin, can see it.
  IF v_quote.customer_id != auth.uid() THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;

  SELECT * INTO v_ver   FROM quote_versions WHERE id = v_quote.current_version_id;
  SELECT * INTO v_school FROM schools        WHERE id = v_quote.school_id;

  -- Headcount
  v_headcount := COALESCE(v_ver.student_count, 0) + COALESCE(v_ver.adults_count, 0);
  IF v_headcount = 0 THEN v_headcount := 1; END IF;

  -- Bus size + count
  IF    v_headcount <= 36  THEN v_bench_count := 18; v_bench_cap := 36;
  ELSIF v_headcount <= 94  THEN v_bench_count := 47; v_bench_cap := 94;
  ELSE                          v_bench_count := 56; v_bench_cap := 112;
  END IF;
  v_bus_count := CEIL(v_headcount::numeric / v_bench_cap);

  -- Customer type
  v_customer := CASE
    WHEN v_school.is_member THEN 'member'
    ELSE 'non_member'
  END;

  -- Rate lookup
  SELECT hourly_rate, min_hours
  INTO v_rate, v_min_hours
  FROM rate_config
  WHERE bench_count = v_bench_count AND customer_type = v_customer
  LIMIT 1;

  -- Fallback: non-member if member row missing
  IF v_rate IS NULL THEN
    SELECT hourly_rate, min_hours INTO v_rate, v_min_hours
    FROM rate_config WHERE bench_count = v_bench_count AND customer_type = 'non_member'
    LIMIT 1;
  END IF;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'no rate found for bench_count=%, customer_type=%', v_bench_count, v_customer;
  END IF;

  -- Surcharge config
  SELECT value INTO v_fuel_per_trip   FROM surcharge_config WHERE key = 'fuel_surcharge_per_trip';
  SELECT value INTO v_gst_rate        FROM surcharge_config WHERE key = 'gst_rate_pct';
  SELECT value INTO v_overtime_rate   FROM surcharge_config WHERE key = 'overtime_rate_per_hour';
  SELECT value INTO v_ot_threshold    FROM surcharge_config WHERE key = 'overtime_threshold_hours';

  -- Trip duration (hours)
  IF v_ver.departure_time IS NOT NULL AND v_ver.return_time IS NOT NULL THEN
    v_trip_hours := EXTRACT(EPOCH FROM (v_ver.return_time - v_ver.departure_time)) / 3600.0;
    IF v_trip_hours < 0 THEN v_trip_hours := v_trip_hours + 24; END IF; -- past midnight
  ELSE
    v_trip_hours := COALESCE(v_min_hours, 4);
  END IF;

  -- Driver yard travel time: fuzzy-match pickup_address against destinations table.
  -- Try exact school name first, then prefix match on address.
  SELECT * INTO v_dest_match
  FROM destinations
  WHERE lower(trim(name)) = lower(trim(v_school.name))
  LIMIT 1;

  IF v_dest_match.id IS NULL AND v_ver.pickup_address IS NOT NULL THEN
    SELECT * INTO v_dest_match
    FROM destinations
    WHERE lower(trim(address)) ILIKE lower(trim(split_part(v_ver.pickup_address, ',', 1))) || '%'
    LIMIT 1;
  END IF;

  IF v_dest_match.id IS NOT NULL THEN
    v_pre_hours  := COALESCE(v_dest_match.pre_hours,  0);
    v_post_hours := COALESCE(v_dest_match.post_hours, 0);
  END IF;

  -- Total driver hours for this trip
  v_driver_hours := v_trip_hours + v_pre_hours + v_post_hours;

  -- Billable hours (apply minimum per bus)
  v_bill_hours := GREATEST(v_driver_hours, COALESCE(v_min_hours, 4));

  -- Overtime (per bus, hours beyond threshold)
  IF v_ot_threshold IS NOT NULL AND v_driver_hours > v_ot_threshold THEN
    v_overtime := (v_driver_hours - v_ot_threshold) * COALESCE(v_overtime_rate, 16) * v_bus_count;
  END IF;

  -- Base cost
  v_base_cost := v_bill_hours * v_rate * v_bus_count;

  -- Fuel surcharge
  v_fuel := COALESCE(v_fuel_per_trip, 50) * v_bus_count;

  -- Subtotal
  v_subtotal := v_base_cost + v_fuel + v_overtime;

  -- GST
  v_gst := v_subtotal * COALESCE(v_gst_rate, 5) / 100.0;

  v_total := v_subtotal + v_gst;

  -- Persist onto the quote version so quote display stays current
  UPDATE quote_versions
  SET
    subtotal        = v_base_cost,
    surcharge_total = v_fuel + v_overtime,
    total           = v_total,
    updated_at      = now()
  WHERE id = v_ver.id;

  RETURN jsonb_build_object(
    'quote_id',           p_quote_id,
    'bench_count',        v_bench_count,
    'bus_count',          v_bus_count,
    'customer_type',      v_customer,
    'hourly_rate',        v_rate,
    'trip_hours',         round(v_trip_hours::numeric,   2),
    'driver_pre_hours',   round(v_pre_hours::numeric,    3),
    'driver_post_hours',  round(v_post_hours::numeric,   3),
    'total_driver_hours', round(v_driver_hours::numeric, 2),
    'billable_hours',     round(v_bill_hours::numeric,   2),
    'min_hours',          v_min_hours,
    'base_cost',          round(v_base_cost::numeric,    2),
    'fuel_surcharge',     round(v_fuel::numeric,         2),
    'overtime_charge',    round(v_overtime::numeric,     2),
    'subtotal',           round(v_subtotal::numeric,     2),
    'gst_pct',            COALESCE(v_gst_rate, 5),
    'gst',                round(v_gst::numeric,          2),
    'total',              round(v_total::numeric,        2),
    'destination_matched', v_dest_match.name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_estimate(uuid) TO authenticated;
