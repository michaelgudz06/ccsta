-- Migration 033: long-distance surcharge — $1/km beyond 200km (one-way),
-- per bus, same pattern as the existing fuel and overtime surcharges.
--
-- distance_km is captured client-side from the free OSRM route lookup
-- (RouteMap.tsx) and persisted here since calculate_estimate runs in
-- Postgres and has no live route access of its own.

ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS distance_km numeric;

-- Customer sets the one-way route distance on their own quote (mirrors
-- set_quote_driver_preference — called right after submit_quote).
CREATE OR REPLACE FUNCTION public.set_quote_distance_km(p_quote_id uuid, p_distance_km numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE quote_versions v
  SET distance_km = p_distance_km
  FROM quotes q
  WHERE q.id = p_quote_id
    AND v.id = q.current_version_id
    AND q.customer_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_quote_distance_km(uuid, numeric) TO authenticated;

-- ── calculate_estimate: add long-distance charge ─────────────────────────────
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

  IF v_ver.departure_time IS NOT NULL AND v_ver.return_time IS NOT NULL THEN
    v_trip_hours := EXTRACT(EPOCH FROM (v_ver.return_time - v_ver.departure_time)) / 3600.0;
    IF v_trip_hours < 0 THEN v_trip_hours := v_trip_hours + 24; END IF;
  ELSE
    v_trip_hours := COALESCE(v_min_hours, 4);
  END IF;

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

  v_driver_hours := v_trip_hours + v_pre_hours + v_post_hours;
  v_bill_hours   := GREATEST(v_driver_hours, COALESCE(v_min_hours, 4));

  IF v_ot_threshold IS NOT NULL AND v_driver_hours > v_ot_threshold THEN
    v_overtime := (v_driver_hours - v_ot_threshold) * COALESCE(v_overtime_rate, 17) * v_bus_count;
  END IF;

  -- Long-distance surcharge: $1/km for each one-way km beyond 200km, per bus
  -- (same per-bus pattern as fuel and overtime — each bus makes the full trip).
  v_distance_km := COALESCE(v_ver.distance_km, 0);
  IF v_ld_threshold IS NOT NULL AND v_distance_km > v_ld_threshold THEN
    v_long_distance := (v_distance_km - v_ld_threshold) * COALESCE(v_ld_rate, 1) * v_bus_count;
  END IF;

  v_base_cost := v_bill_hours * v_rate * v_bus_count;
  v_fuel      := COALESCE(v_fuel_per_trip, 50) * v_bus_count;
  v_subtotal  := v_base_cost + v_fuel + v_overtime + v_long_distance;
  v_gst       := v_subtotal * COALESCE(v_gst_rate, 5) / 100.0;
  v_total     := v_subtotal + v_gst;

  UPDATE quote_versions
  SET subtotal = v_base_cost, surcharge_total = v_fuel + v_overtime + v_long_distance, total = v_total, updated_at = now()
  WHERE id = v_ver.id;

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'bench_count', v_bench_count,
    'bus_count', v_bus_count,
    'seats_needed', round(v_seats, 2),
    'customer_type', v_customer,
    'hourly_rate', v_rate,
    'trip_hours', round(v_trip_hours, 2),
    'driver_pre_hours', round(v_pre_hours, 3),
    'driver_post_hours', round(v_post_hours, 3),
    'total_driver_hours', round(v_driver_hours, 2),
    'billable_hours', round(v_bill_hours, 2),
    'min_hours', v_min_hours,
    'base_cost', round(v_base_cost, 2),
    'fuel_surcharge', round(v_fuel, 2),
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
