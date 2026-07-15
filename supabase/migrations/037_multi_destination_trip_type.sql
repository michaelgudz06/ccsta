-- Migration 037: multi-destination trip type — schema + submit_quote.
--
-- Requires migration 036 (ALTER TYPE ... ADD VALUE 'multi_destination') to
-- have already run and committed in a SEPARATE transaction before this
-- file runs — see 036's header comment for why.
--
-- Multi-destination = multiple different stops in ONE day, self-serve —
-- distinct from 'multi_trip', which is the existing admin-only "contact
-- Melody" dead-end for booking across MULTIPLE DAYS. Same envelope-billing
-- approach as shuttle: hours are derived from MIN/MAX stop time, no
-- calculate_estimate changes needed.
--
-- Distance handling (summing km across all legs, and whether a trip
-- implicitly returns to the school) is deliberately OUT OF SCOPE here —
-- distance_km stays a client-computed, single-number column set via the
-- existing set_quote_distance_km RPC (unchanged, any trip type). That
-- routing/summing work is commit 2 of this feature; this migration only
-- adds the schema + submit_quote branch to store stops and derive hours.

-- Per-stop destination + time for multi-destination trips. Same shape as
-- quote_shuttle_runs, plus a destination per stop (shuttle only varies
-- times; every stop here is a different place). Keyed by quote_version_id
-- only, same reasoning as quote_shuttle_runs: trips.quote_version_id
-- already links back once scheduled, so a future calendar system joins
-- through that existing FK without duplicating stop data onto trips.
CREATE TABLE public.quote_multi_stops (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_version_id     uuid NOT NULL REFERENCES public.quote_versions(id) ON DELETE CASCADE,
  stop_number          smallint NOT NULL,
  destination_name     text,
  destination_address  text NOT NULL,
  stop_time            time NOT NULL,
  -- Cached geocode result (commit 2 will populate these client-side) so
  -- the admin view and any future routing/calendar work don't need to
  -- re-geocode against the rate-limited free geocoder on every read.
  lat                  numeric,
  lng                  numeric,
  UNIQUE (quote_version_id, stop_number)
);

CREATE INDEX quote_multi_stops_version_id_idx ON public.quote_multi_stops (quote_version_id);

ALTER TABLE public.quote_multi_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_multi_stops_own_read"
  ON public.quote_multi_stops FOR SELECT
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

CREATE POLICY "quote_multi_stops_admin_write"
  ON public.quote_multi_stops FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- ── submit_quote: add a multi_destination branch alongside shuttle ──────────
-- multi_destination is self-serve (unlike multi_trip, which stays rejected
-- below) — customer submits an ordered list of stops, each with its own
-- destination + time.
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
  v_stops        jsonb;
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
  v_stops        := p_data->'stops';

  IF v_trip_type = 'shuttle' THEN
    IF v_shuttle_runs IS NULL OR jsonb_typeof(v_shuttle_runs) <> 'array' OR jsonb_array_length(v_shuttle_runs) = 0 THEN
      RAISE EXCEPTION 'shuttle trips require at least one run';
    END IF;
    -- Bus is engaged continuously from the first pickup to the last drop-off.
    SELECT MIN((elem->>'pickup_time')::time), MAX((elem->>'dropoff_time')::time)
    INTO v_departure, v_return
    FROM jsonb_array_elements(v_shuttle_runs) AS elem;
  ELSIF v_trip_type = 'multi_destination' THEN
    IF v_stops IS NULL OR jsonb_typeof(v_stops) <> 'array' OR jsonb_array_length(v_stops) = 0 THEN
      RAISE EXCEPTION 'multi-destination trips require at least one stop';
    END IF;
    -- Same envelope approach as shuttle: bus is engaged from the first
    -- stop's time to the last stop's time, whatever those stops turn out
    -- to be (no assumption of a return-to-school leg — see commit 2).
    SELECT MIN((elem->>'stop_time')::time), MAX((elem->>'stop_time')::time)
    INTO v_departure, v_return
    FROM jsonb_array_elements(v_stops) AS elem;
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

  -- Insert first version with all form data. destination_name/address stay
  -- NULL for multi_destination — the real destinations live in
  -- quote_multi_stops instead of this single-destination pair.
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
  ELSIF v_trip_type = 'multi_destination' THEN
    INSERT INTO public.quote_multi_stops (quote_version_id, stop_number, destination_name, destination_address, stop_time, lat, lng)
    SELECT v_ver_id,
           COALESCE(NULLIF(elem->>'stop_number', '')::smallint, ord::smallint),
           elem->>'destination_name',
           elem->>'destination_address',
           (elem->>'stop_time')::time,
           NULLIF(elem->>'lat', '')::numeric,
           NULLIF(elem->>'lng', '')::numeric
    FROM jsonb_array_elements(v_stops) WITH ORDINALITY AS t(elem, ord);
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

-- confirm_trip needs NO changes: it already copies v_ver.trip_type onto
-- trips generically (see migration 035), with no branching on specific
-- enum values, so it picks up 'multi_destination' automatically.
