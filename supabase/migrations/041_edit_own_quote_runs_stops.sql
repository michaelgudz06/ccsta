-- Migration 041: let customers edit per-run (shuttle) and per-stop
-- (multi-destination) times through edit_own_quote.
--
-- Isolated to edit_own_quote only -- submit_quote, _queue_email,
-- _admin_email, and the notification pipeline are untouched. The only email
-- this migration affects is the existing "Quote ... was edited by the
-- customer" notice edit_own_quote already sends (same body/recipient as
-- migration 040) -- no new email path, no changed subject/body logic. No
-- re-testing of the submit_quote confirmation emails is needed.
--
-- Versioning: exactly the same pattern as every other edited field. New
-- quote_shuttle_runs / quote_multi_stops rows are INSERTed tied to the NEW
-- quote_versions.id (v_new_ver_id) -- never UPDATEd in place, never
-- re-pointed. The OLD version's rows are left completely alone, still
-- attached to the old (now superseded) version_id. This means:
--   - The new version's row COUNT can differ from the old one (customer
--     added/removed a run or stop) with no special-casing -- each version's
--     child rows are independently scoped by quote_version_id.
--   - Nothing is lost or orphaned: the old rows remain valid history under
--     the old version_id (nothing deletes them), and the new rows are a
--     complete fresh set under the new version_id (never a partial
--     patch/merge onto the old rows).
--
-- Behavior:
--   - If the client supplies p_data->'shuttle_runs' (shuttle trips) or
--     p_data->'stops' (multi-destination trips), those become the new
--     version's rows, inserted the same way submit_quote already inserts
--     them at initial submission (same jsonb shape, same
--     WITH ORDINALITY numbering fallback, same validation: at least one
--     run/stop required).
--   - The bus-engaged envelope (departure_time/return_time on the new
--     version) is DERIVED FROM THE NEW runs/stops, not from any
--     client-supplied top-level departure_time/return_time for those two
--     trip types -- MIN(pickup_time)/MAX(dropoff_time) for shuttle,
--     MAX(arrival_time) for multi-destination stops (pickup departure_time
--     for multi-destination stays a directly-supplied top-level field, same
--     as today).
--   - If neither array is supplied (defensive fallback only -- the client
--     will always send them going forward), falls back to today's
--     copy-forward-unchanged behavior from migration 040.
--   - two_way/one_way editing is completely unchanged.
--
-- Pure CREATE OR REPLACE FUNCTION, no schema/enum changes -- no
-- same-transaction restriction, safe as one script (same reasoning as 040).

CREATE OR REPLACE FUNCTION public.edit_own_quote(p_quote_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote        quotes%ROWTYPE;
  v_ver          quote_versions%ROWTYPE;
  v_new_ver_id   uuid;
  v_next_version smallint;
  v_new_trip_date date;
  v_new_departure time;
  v_new_return    time;
  v_shuttle_runs  jsonb;
  v_stops         jsonb;
BEGIN
  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;

  IF v_quote.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only edit your own quotes.';
  END IF;

  IF v_quote.status NOT IN ('requested', 'in_review', 'approved', 'confirmed') THEN
    RAISE EXCEPTION 'This quote can no longer be edited online — please call us.';
  END IF;

  IF v_quote.cancellation_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'A cancellation request is already pending for this quote — it can''t be edited at the same time.';
  END IF;

  SELECT * INTO v_ver FROM quote_versions WHERE id = v_quote.current_version_id;

  v_shuttle_runs := p_data->'shuttle_runs';
  v_stops        := p_data->'stops';

  -- Resolve edited fields, falling back to the current version's values for
  -- anything not supplied -- a partial edit shouldn't null out the rest.
  v_new_trip_date := COALESCE(NULLIF(p_data->>'trip_date', '')::date, v_ver.trip_date);

  -- Envelope (departure_time/return_time): for shuttle/multi-destination,
  -- derive from the NEW runs/stops when supplied -- those are the source of
  -- truth for the bus-engaged window, same as at initial submission
  -- (submit_quote, migration 038). Falls back to copy-forward-style COALESCE
  -- behavior when the arrays aren't supplied, or for two_way/one_way.
  IF v_ver.trip_type = 'shuttle' AND v_shuttle_runs IS NOT NULL THEN
    IF jsonb_typeof(v_shuttle_runs) <> 'array' OR jsonb_array_length(v_shuttle_runs) = 0 THEN
      RAISE EXCEPTION 'shuttle trips require at least one run';
    END IF;
    SELECT MIN((elem->>'pickup_time')::time), MAX((elem->>'dropoff_time')::time)
    INTO v_new_departure, v_new_return
    FROM jsonb_array_elements(v_shuttle_runs) AS elem;
  ELSIF v_ver.trip_type = 'multi_destination' AND v_stops IS NOT NULL THEN
    IF jsonb_typeof(v_stops) <> 'array' OR jsonb_array_length(v_stops) = 0 THEN
      RAISE EXCEPTION 'multi-destination trips require at least one stop';
    END IF;
    -- Pickup departure stays a direct top-level field, same as two_way/one_way.
    v_new_departure := COALESCE(NULLIF(p_data->>'departure_time', '')::time, v_ver.departure_time);
    SELECT MAX((elem->>'arrival_time')::time)
    INTO v_new_return
    FROM jsonb_array_elements(v_stops) AS elem;
  ELSE
    v_new_departure := COALESCE(NULLIF(p_data->>'departure_time', '')::time, v_ver.departure_time);
    v_new_return    := COALESCE(NULLIF(p_data->>'return_time', '')::time, v_ver.return_time);
  END IF;

  -- Timing rule: within 1 week of the CURRENT trip date, edits are blocked
  -- UNLESS the new date is later than the current one.
  IF v_ver.trip_date IS NOT NULL
     AND v_ver.trip_date < (CURRENT_DATE + INTERVAL '7 days')
     AND NOT (v_new_trip_date > v_ver.trip_date)
  THEN
    RAISE EXCEPTION 'This trip is within a week — online edits are only allowed if you''re pushing the date later. Please call us for last-minute changes.';
  END IF;

  v_next_version := (
    SELECT COALESCE(MAX(version_number), 0) + 1
    FROM quote_versions WHERE quote_id = p_quote_id
  );

  -- New version: copy everything from the current version, then apply the
  -- editable fields. Pricing/assignment fields are deliberately left NULL
  -- (omitted below, so they take their column defaults) so Melody re-prices
  -- against the new details rather than seeing a stale number -- any prior
  -- driver-time override, distance, or suggested bus/driver was tied to the
  -- old specifics and no longer applies.
  INSERT INTO public.quote_versions (
    quote_id, version_number,
    destination_name, destination_address, trip_type,
    trip_date, departure_time, return_time,
    student_count, adults_count, grade_breakdown,
    cargo_needed, pickup_address,
    contact_primary, contact_secondary, contact_day_of,
    special_requests, driver_preference,
    internal_notes, customer_notes,
    created_by, edited_at
  ) VALUES (
    p_quote_id, v_next_version,
    v_ver.destination_name, v_ver.destination_address, v_ver.trip_type,
    v_new_trip_date, v_new_departure, v_new_return,
    COALESCE(NULLIF(p_data->>'student_count', '')::smallint, v_ver.student_count),
    COALESCE(NULLIF(p_data->>'adults_count', '')::smallint, v_ver.adults_count),
    COALESCE(p_data->'grade_breakdown', v_ver.grade_breakdown),
    v_ver.cargo_needed,
    COALESCE(NULLIF(p_data->>'pickup_address', ''), v_ver.pickup_address),
    v_ver.contact_primary, v_ver.contact_secondary, v_ver.contact_day_of,
    v_ver.special_requests, v_ver.driver_preference,
    v_ver.internal_notes, v_ver.customer_notes,
    auth.uid(), now()
  )
  RETURNING id INTO v_new_ver_id;

  -- Shuttle runs / multi-destination stops: insert fresh from the client's
  -- new data when supplied (tied to v_new_ver_id, the NEW version -- never
  -- the old one, never an UPDATE onto existing rows), otherwise fall back to
  -- copying the old version's rows forward unchanged (migration 040
  -- behavior), so the admin view's run/stop breakdown never goes blank.
  IF v_ver.trip_type = 'shuttle' THEN
    IF v_shuttle_runs IS NOT NULL THEN
      INSERT INTO public.quote_shuttle_runs (quote_version_id, run_number, pickup_time, dropoff_time)
      SELECT v_new_ver_id,
             COALESCE(NULLIF(elem->>'run_number', '')::smallint, ord::smallint),
             (elem->>'pickup_time')::time,
             (elem->>'dropoff_time')::time
      FROM jsonb_array_elements(v_shuttle_runs) WITH ORDINALITY AS t(elem, ord);
    ELSE
      INSERT INTO public.quote_shuttle_runs (quote_version_id, run_number, pickup_time, dropoff_time)
      SELECT v_new_ver_id, run_number, pickup_time, dropoff_time
      FROM public.quote_shuttle_runs WHERE quote_version_id = v_ver.id;
    END IF;
  ELSIF v_ver.trip_type = 'multi_destination' THEN
    IF v_stops IS NOT NULL THEN
      INSERT INTO public.quote_multi_stops (quote_version_id, stop_number, destination_name, destination_address, arrival_time, departure_time, lat, lng)
      SELECT v_new_ver_id,
             COALESCE(NULLIF(elem->>'stop_number', '')::smallint, ord::smallint),
             elem->>'destination_name',
             elem->>'destination_address',
             (elem->>'arrival_time')::time,
             NULLIF(elem->>'departure_time', '')::time,
             NULLIF(elem->>'lat', '')::numeric,
             NULLIF(elem->>'lng', '')::numeric
      FROM jsonb_array_elements(v_stops) WITH ORDINALITY AS t(elem, ord);
    ELSE
      INSERT INTO public.quote_multi_stops (quote_version_id, stop_number, destination_name, destination_address, arrival_time, departure_time, lat, lng)
      SELECT v_new_ver_id, stop_number, destination_name, destination_address, arrival_time, departure_time, lat, lng
      FROM public.quote_multi_stops WHERE quote_version_id = v_ver.id;
    END IF;
  END IF;

  -- Point the quote at the new version and send it back for review.
  UPDATE public.quotes
  SET current_version_id = v_new_ver_id,
      status = 'in_review',
      updated_at = now()
  WHERE id = p_quote_id;

  PERFORM _queue_email(
    _admin_email(),
    'Quote ' || v_quote.quote_number || ' was edited by the customer',
    'The customer edited quote ' || v_quote.quote_number || ' — it needs review again.'
      || E'\n\n  Trip date: ' || COALESCE(v_new_trip_date::text, '—')
      || E'\n\nReview it in the dispatch dashboard: ' || _site_url() || '/admin',
    p_quote_id
  );

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'version_id', v_new_ver_id,
    'version_number', v_next_version,
    'status', 'in_review'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_own_quote(uuid, jsonb) TO authenticated;
