-- Migration 035: trip types (two-way / one-way / shuttle / multi-trip)
--
-- Pricing is unchanged for every type — calculate_estimate keeps deriving
-- billable hours from quote_versions.departure_time/return_time exactly as
-- before. What changes is only how those two columns get populated at
-- submit time: for shuttle trips they become the envelope (first pickup ->
-- last drop-off) across a variable number of runs, stored in the new
-- quote_shuttle_runs table so a future calendar/availability system can
-- read exactly when a bus is engaged.
--
-- Not named "trip_type" — that enum already exists on public.drivers
-- (driver_trip_type: route/field_trip/both), an unrelated concept.

CREATE TYPE public.quote_trip_type AS ENUM ('two_way', 'one_way', 'shuttle', 'multi_trip');

ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS trip_type public.quote_trip_type NOT NULL DEFAULT 'two_way';

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS trip_type public.quote_trip_type NOT NULL DEFAULT 'two_way';

-- Per-run pickup/drop-off times for shuttle trips. Keyed by quote_version_id
-- only — once a quote is confirmed, trips.quote_version_id already points
-- back at this same version (see confirm_trip below), so a future calendar
-- system can join trips -> quote_shuttle_runs through that existing FK
-- without duplicating run data onto trips.
CREATE TABLE public.quote_shuttle_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_version_id  uuid NOT NULL REFERENCES public.quote_versions(id) ON DELETE CASCADE,
  run_number        smallint NOT NULL,
  pickup_time       time NOT NULL,
  dropoff_time      time NOT NULL,
  UNIQUE (quote_version_id, run_number)
);

CREATE INDEX quote_shuttle_runs_version_id_idx ON public.quote_shuttle_runs (quote_version_id);

ALTER TABLE public.quote_shuttle_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_shuttle_runs_own_read"
  ON public.quote_shuttle_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.quote_versions v
      JOIN public.quotes q ON q.id = v.quote_id
      WHERE v.id = quote_version_id AND q.customer_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "quote_shuttle_runs_admin_write"
  ON public.quote_shuttle_runs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- ── submit_quote: accept trip_type + shuttle_runs, derive the envelope ──────
CREATE OR REPLACE FUNCTION submit_quote(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_quote_no     text;
  v_quote_id     uuid;
  v_ver_id       uuid;
  v_school_id    uuid;
  v_cust_email   text;
  v_trip_type    public.quote_trip_type;
  v_shuttle_runs jsonb;
  v_departure    time;
  v_return       time;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_trip_type := COALESCE(NULLIF(p_data->>'trip_type', '')::public.quote_trip_type, 'two_way');
  IF v_trip_type = 'multi_trip' THEN
    RAISE EXCEPTION 'multi_trip bookings are not self-serve — contact the office directly';
  END IF;

  v_shuttle_runs := p_data->'shuttle_runs';

  IF v_trip_type = 'shuttle' THEN
    IF v_shuttle_runs IS NULL OR jsonb_typeof(v_shuttle_runs) <> 'array' OR jsonb_array_length(v_shuttle_runs) = 0 THEN
      RAISE EXCEPTION 'shuttle trips require at least one run';
    END IF;
    -- Bus is engaged continuously from the first pickup to the last drop-off.
    SELECT MIN((elem->>'pickup_time')::time), MAX((elem->>'dropoff_time')::time)
    INTO v_departure, v_return
    FROM jsonb_array_elements(v_shuttle_runs) AS elem;
  ELSE
    v_departure := NULLIF(p_data->>'departure_time', '')::time;
    v_return    := NULLIF(p_data->>'return_time', '')::time;
  END IF;

  -- Find existing school by name (case-insensitive) or create a new one
  SELECT id INTO v_school_id
  FROM public.schools
  WHERE lower(trim(name)) = lower(trim(p_data->>'school_name'))
  LIMIT 1;

  IF v_school_id IS NULL THEN
    INSERT INTO public.schools (name, address)
    VALUES (trim(p_data->>'school_name'), p_data->>'pickup_address')
    RETURNING id INTO v_school_id;
  END IF;

  -- Generate sequential quote number: Q-YYYY-NNNN
  v_quote_no := 'Q-' || extract(year FROM now())::text || '-' ||
                lpad(nextval('public.quote_number_seq')::text, 4, '0');

  -- Insert quote (without current_version_id first to avoid circular FK issue)
  INSERT INTO public.quotes (quote_number, school_id, customer_id, status)
  VALUES (v_quote_no, v_school_id, v_user_id, 'requested')
  RETURNING id INTO v_quote_id;

  -- Insert first version with all form data
  INSERT INTO public.quote_versions (
    quote_id, version_number,
    destination_name, destination_address,
    trip_date, departure_time, return_time, trip_type,
    student_count, adults_count, grade_breakdown,
    cargo_needed, pickup_address,
    contact_primary, contact_secondary, contact_day_of,
    special_requests, created_by
  ) VALUES (
    v_quote_id, 1,
    p_data->>'destination_name',
    p_data->>'destination_address',
    NULLIF(p_data->>'trip_date', '')::date,
    v_departure,
    v_return,
    v_trip_type,
    NULLIF(p_data->>'student_count', '')::smallint,
    NULLIF(p_data->>'adults_count', '')::smallint,
    p_data->'grade_breakdown',
    COALESCE((p_data->>'cargo_needed')::boolean, false),
    p_data->>'pickup_address',
    p_data->'contact_primary',
    p_data->'contact_secondary',
    p_data->'contact_day_of',
    p_data->>'special_requests',
    v_user_id
  )
  RETURNING id INTO v_ver_id;

  IF v_trip_type = 'shuttle' THEN
    INSERT INTO public.quote_shuttle_runs (quote_version_id, run_number, pickup_time, dropoff_time)
    SELECT v_ver_id,
           COALESCE(NULLIF(elem->>'run_number', '')::smallint, ord::smallint),
           (elem->>'pickup_time')::time,
           (elem->>'dropoff_time')::time
    FROM jsonb_array_elements(v_shuttle_runs) WITH ORDINALITY AS t(elem, ord);
  END IF;

  -- Link version back to quote
  UPDATE public.quotes
  SET current_version_id = v_ver_id
  WHERE id = v_quote_id;

  -- Queue notification emails (delivered by the notify-send Edge Function).
  v_cust_email := COALESCE(
    NULLIF(btrim(p_data->'contact_primary'->>'email'), ''),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  );

  PERFORM _queue_email(
    v_cust_email,
    'We received your quote request ' || v_quote_no,
    'Hi,' || E'\n\nThanks for your field trip request!'
      || E'\n\n  Quote number: ' || v_quote_no
      || E'\n  Destination:  ' || COALESCE(p_data->>'destination_name', 'TBD')
      || E'\n  Trip date:    ' || COALESCE(p_data->>'trip_date', 'TBD')
      || E'\n\nMelody will review it and you''ll get another email as soon as your price is ready.'
      || E'\nYou can check the status any time: ' || _site_url() || '/portal'
      || E'\n\n— CCSTA',
    v_quote_id
  );

  PERFORM _queue_email(
    _admin_email(),
    'New quote request ' || v_quote_no || ' — ' || COALESCE(trim(p_data->>'school_name'), 'Unknown school'),
    'A new field trip quote was just submitted.'
      || E'\n\n  Quote:       ' || v_quote_no
      || E'\n  School:      ' || COALESCE(trim(p_data->>'school_name'), '—')
      || E'\n  Destination: ' || COALESCE(p_data->>'destination_name', '—')
      || E'\n  Trip date:   ' || COALESCE(p_data->>'trip_date', '—')
      || E'\n  Riders:      ' || COALESCE(p_data->>'student_count', '0') || ' students + '
      || COALESCE(p_data->>'adults_count', '0') || ' adults'
      || E'\n\nReview it in the dispatch dashboard: ' || _site_url() || '/admin',
    v_quote_id
  );

  RETURN jsonb_build_object(
    'quote_number', v_quote_no,
    'quote_id',     v_quote_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_quote(jsonb) TO authenticated;

-- ── confirm_trip: carry trip_type onto the scheduled trip ───────────────────
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
    trip_date, departure_time, return_time, trip_type,
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
    v_ver.trip_type,
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
