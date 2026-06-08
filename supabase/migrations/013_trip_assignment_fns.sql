-- suggest_assignment: return available driver+bus pairs for a quote's trip date
CREATE OR REPLACE FUNCTION suggest_assignment(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote        quotes%ROWTYPE;
  v_ver          quote_versions%ROWTYPE;
  v_trip_date    date;
  v_headcount    int;
  v_needed_bench int;
  v_suggestions  jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;

  SELECT * INTO v_ver FROM quote_versions WHERE id = v_quote.current_version_id;

  v_trip_date := v_ver.trip_date::date;
  v_headcount := COALESCE(v_ver.student_count, 0) + COALESCE(v_ver.adults_count, 0);

  -- Conservative 2-per-bench capacity: 18→36, 47→94, 56→112
  v_needed_bench := CASE
    WHEN v_headcount <= 36 THEN 18
    WHEN v_headcount <= 94 THEN 47
    ELSE 56
  END;

  SELECT jsonb_agg(
    jsonb_build_object(
      'driver_id',       d.id,
      'driver_name',     d.first_name || ' ' || d.last_name,
      'air_brake_cert',  d.air_brake_cert,
      'phone',           d.phone,
      'bus_id',          b.id,
      'bus_fleet',       b.fleet_number,
      'bus_bench_count', b.bench_count
    )
    ORDER BY d.last_name, b.fleet_number
  )
  INTO v_suggestions
  FROM drivers d
  JOIN driver_bus_clearances dbc ON dbc.driver_id = d.id AND dbc.bench_count = v_needed_bench
  JOIN buses b ON b.bench_count = v_needed_bench AND b.active = true
  WHERE d.active = true
    AND d.trip_type IN ('field_trip', 'both')
    AND (b.air_brake_req = false OR d.air_brake_cert = true)
    AND NOT EXISTS (
      SELECT 1 FROM driver_availability da
      WHERE da.driver_id = d.id AND da.date = v_trip_date AND da.status = 'unavailable'
    )
    AND NOT EXISTS (
      SELECT 1 FROM trips t
      WHERE t.driver_id = d.id AND t.trip_date = v_trip_date AND t.status NOT IN ('cancelled')
    )
    AND NOT EXISTS (
      SELECT 1 FROM trips t
      WHERE t.bus_id = b.id AND t.trip_date = v_trip_date AND t.status NOT IN ('cancelled')
    );

  RETURN jsonb_build_object(
    'trip_date',    v_trip_date,
    'headcount',    v_headcount,
    'needed_bench', v_needed_bench,
    'suggestions',  COALESCE(v_suggestions, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION suggest_assignment(uuid) TO authenticated;

-- confirm_trip: create a trip from an approved quote, assign driver + bus
CREATE OR REPLACE FUNCTION confirm_trip(
  p_quote_id  uuid,
  p_driver_id uuid,
  p_bus_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote       quotes%ROWTYPE;
  v_ver         quote_versions%ROWTYPE;
  v_trip_number text;
  v_trip_id     uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;
  IF v_quote.status NOT IN ('approved', 'confirmed') THEN
    RAISE EXCEPTION 'quote must be approved before confirming a trip (current: %)', v_quote.status;
  END IF;

  SELECT * INTO v_ver FROM quote_versions WHERE id = v_quote.current_version_id;

  v_trip_number := 'T-' || nextval('trip_number_seq');

  INSERT INTO trips (
    trip_number, quote_id, quote_version_id, school_id,
    driver_id, bus_id,
    trip_date, departure_time, return_time,
    destination_name, destination_address,
    student_count, status
  ) VALUES (
    v_trip_number,
    p_quote_id,
    v_quote.current_version_id,
    v_quote.school_id,
    p_driver_id,
    p_bus_id,
    v_ver.trip_date::date,
    v_ver.departure_time::time,
    v_ver.return_time::time,
    v_ver.destination_name,
    v_ver.destination_address,
    v_ver.student_count,
    'scheduled'
  )
  RETURNING id INTO v_trip_id;

  -- Record assignment on the version for audit trail
  UPDATE quote_versions
  SET suggested_driver_id = p_driver_id, suggested_bus_id = p_bus_id
  WHERE id = v_quote.current_version_id;

  UPDATE quotes SET status = 'scheduled', updated_at = now() WHERE id = p_quote_id;

  RETURN jsonb_build_object(
    'trip_id',     v_trip_id,
    'trip_number', v_trip_number,
    'quote_id',    p_quote_id,
    'status',      'scheduled'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_trip(uuid, uuid, uuid) TO authenticated;
