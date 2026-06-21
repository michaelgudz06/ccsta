-- Migration 029: give drivers the day-of details they need.
-- confirm_trip previously dropped pickup address, day-of contact, and special
-- requests — so the driver screen had no way to show them. Add the columns,
-- copy them when a trip is confirmed, and re-check double-booking at confirm time.

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS pickup_address   text,
  ADD COLUMN IF NOT EXISTS contact_day_of   jsonb,
  ADD COLUMN IF NOT EXISTS special_requests text;

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
  v_trip_date   date;
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
  v_trip_date := v_ver.trip_date::date;

  -- Re-check double-booking at confirm time (the suggestion list could be stale).
  IF EXISTS (
    SELECT 1 FROM trips
    WHERE driver_id = p_driver_id AND trip_date = v_trip_date AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'That driver is already booked on %.', to_char(v_trip_date, 'Mon DD');
  END IF;
  IF EXISTS (
    SELECT 1 FROM trips
    WHERE bus_id = p_bus_id AND trip_date = v_trip_date AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'That bus is already booked on %.', to_char(v_trip_date, 'Mon DD');
  END IF;

  v_trip_number := 'T-' || nextval('trip_number_seq');

  INSERT INTO trips (
    trip_number, quote_id, quote_version_id, school_id,
    driver_id, bus_id,
    trip_date, departure_time, return_time,
    destination_name, destination_address,
    pickup_address, contact_day_of, special_requests,
    student_count, status
  ) VALUES (
    v_trip_number,
    p_quote_id,
    v_quote.current_version_id,
    v_quote.school_id,
    p_driver_id,
    p_bus_id,
    v_trip_date,
    v_ver.departure_time::time,
    v_ver.return_time::time,
    v_ver.destination_name,
    v_ver.destination_address,
    v_ver.pickup_address,
    v_ver.contact_day_of,
    v_ver.special_requests,
    v_ver.student_count,
    'scheduled'
  )
  RETURNING id INTO v_trip_id;

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
