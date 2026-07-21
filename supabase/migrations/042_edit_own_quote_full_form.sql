-- Migration 042: full-form customer quote editing.
--
-- Supersedes migration 041's edit_own_quote again (CREATE OR REPLACE, same
-- function) -- 041 only accepted a handful of named fields (date, envelope
-- times, passenger counts, pickup address, shuttle_runs/stops). The customer
-- portal now reopens the FULL quote form (quote.tsx) pre-filled with the
-- quote's existing data, in an "edit mode" that reuses submit_quote's exact
-- form/validation -- so this function needs to accept everything that form
-- can send: trip_type itself, destination, contacts, cargo, special
-- requests, and driver preference, on top of what 041 already handled.
--
-- Isolated to edit_own_quote only -- submit_quote, _queue_email,
-- _admin_email, and the notification pipeline are untouched, same as 040/041.
-- The only email is the existing "Quote ... was edited by the customer"
-- notice (same body/recipient as before) -- no new email path. No
-- re-testing of submit_quote's confirmation emails is needed.
--
-- Key change in shape: because the client now always submits the COMPLETE
-- form (the same form used to create a quote, just pre-filled), almost every
-- field is now taken DIRECTLY from p_data -- the same way submit_quote
-- already does at initial creation -- instead of the narrower
-- COALESCE(p_data, v_ver.field) fallback 040/041 used when only a few named
-- fields were ever exposed to the customer. The only fields still carried
-- forward from the old version unconditionally are internal_notes
-- (admin-only, never touched by the customer) and customer_notes (never
-- sent by the client). driver_preference moves from a separate best-effort
-- RPC call (set_quote_driver_preference, still used at initial submission)
-- into this function's main payload, since the edit form now collects it
-- directly.
--
-- trip_type is now itself editable, and can change between versions (e.g. a
-- two-way quote edited into a shuttle). Every place that used to branch on
-- the OLD version's trip_type (v_ver.trip_type) now branches on the NEW one
-- (v_new_trip_type) instead:
--   - destination_name/destination_address: NULL when the new type is
--     multi_destination (real destinations live in quote_multi_stops), taken
--     from the form otherwise -- same convention submit_quote uses.
--   - the departure_time/return_time envelope: derived from the new
--     shuttle_runs (MIN pickup / MAX dropoff) or stops (MAX arrival) when
--     converting into those types, exactly like submit_quote derives it at
--     initial creation; taken directly from the form for two_way/one_way.
--   - the quote_shuttle_runs/quote_multi_stops insert: keyed off the new
--     type, so converting AWAY from shuttle/multi_destination correctly
--     stops attaching new child rows to the new version (the old version's
--     rows are untouched either way -- nothing is deleted or orphaned).
-- Converting into multi_trip is rejected with the same guard submit_quote
-- has (not self-serve) -- defense in depth, since the client's own form
-- already hides the submit button whenever multi_trip is selected.
--
-- Versioning, timing rule, statuses, and notification behavior are all
-- UNCHANGED from 040/041:
--   - Editable statuses: requested, in_review, approved, confirmed.
--   - Blocked within 1 week of the CURRENT trip_date, UNLESS the new
--     trip_date is LATER than the current one -- and once that exception
--     applies, every other change in the same edit is allowed too (the
--     check only ever compares trip dates, never gates on which other
--     fields changed).
--   - Mutually exclusive with a pending cancellation request.
--   - New quote_versions row (version_number + 1), quotes.current_version_id
--     flipped, status reset to 'in_review', edited_at stamped, Melody
--     notified. No new price is computed or shown to the customer.
--   - Pricing/assignment fields (subtotal/total/distance_km/suggested
--     bus+driver/approved_driver_hours/etc.) still deliberately left NULL on
--     the new version (omitted from the INSERT) so Melody re-prices from
--     scratch -- unchanged from 040/041.
--
-- Pure CREATE OR REPLACE FUNCTION, no schema/enum changes -- no
-- same-transaction restriction, safe as one script (same reasoning as 040/041).

CREATE OR REPLACE FUNCTION public.edit_own_quote(p_quote_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote          quotes%ROWTYPE;
  v_ver            quote_versions%ROWTYPE;
  v_new_ver_id     uuid;
  v_next_version   smallint;
  v_new_trip_date  date;
  v_new_trip_type  public.quote_trip_type;
  v_new_dest_name  text;
  v_new_dest_addr  text;
  v_new_departure  time;
  v_new_return     time;
  v_shuttle_runs   jsonb;
  v_stops          jsonb;
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

  v_new_trip_date := COALESCE(NULLIF(p_data->>'trip_date', '')::date, v_ver.trip_date);
  v_new_trip_type := COALESCE(NULLIF(p_data->>'trip_type', '')::public.quote_trip_type, v_ver.trip_type);

  IF v_new_trip_type = 'multi_trip' THEN
    RAISE EXCEPTION 'multi_trip bookings are not self-serve — contact the office directly';
  END IF;

  -- Destination: NULL for multi-destination (real destinations live in
  -- quote_multi_stops instead), otherwise taken straight from the form --
  -- same convention submit_quote uses at initial creation.
  IF v_new_trip_type = 'multi_destination' THEN
    v_new_dest_name := NULL;
    v_new_dest_addr := NULL;
  ELSE
    v_new_dest_name := p_data->>'destination_name';
    v_new_dest_addr := p_data->>'destination_address';
  END IF;

  -- Envelope (departure_time/return_time), derived by the NEW trip type so
  -- switching types mid-edit is handled correctly, same derivation
  -- submit_quote uses at initial creation.
  IF v_new_trip_type = 'shuttle' THEN
    IF v_shuttle_runs IS NULL OR jsonb_typeof(v_shuttle_runs) <> 'array' OR jsonb_array_length(v_shuttle_runs) = 0 THEN
      RAISE EXCEPTION 'shuttle trips require at least one run';
    END IF;
    SELECT MIN((elem->>'pickup_time')::time), MAX((elem->>'dropoff_time')::time)
    INTO v_new_departure, v_new_return
    FROM jsonb_array_elements(v_shuttle_runs) AS elem;
  ELSIF v_new_trip_type = 'multi_destination' THEN
    IF v_stops IS NULL OR jsonb_typeof(v_stops) <> 'array' OR jsonb_array_length(v_stops) = 0 THEN
      RAISE EXCEPTION 'multi-destination trips require at least one stop';
    END IF;
    v_new_departure := NULLIF(p_data->>'departure_time', '')::time;
    SELECT MAX((elem->>'arrival_time')::time)
    INTO v_new_return
    FROM jsonb_array_elements(v_stops) AS elem;
  ELSE
    v_new_departure := NULLIF(p_data->>'departure_time', '')::time;
    v_new_return    := NULLIF(p_data->>'return_time', '')::time;
  END IF;

  -- Timing rule: within 1 week of the CURRENT trip date, edits are blocked
  -- UNLESS the new date is later than the current one. Unchanged from
  -- 040/041 -- this only ever compares trip dates, so once the exception
  -- applies, every other change in the same edit is allowed too.
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

  -- New version: the client now always submits the complete form, so fields
  -- are taken directly from p_data -- same as submit_quote's initial INSERT
  -- -- rather than falling back to the old version's value. internal_notes
  -- (admin-only) and customer_notes (never sent by the client) are the only
  -- fields still carried forward unconditionally. Pricing/assignment fields
  -- are still deliberately left NULL (omitted below) so Melody re-prices
  -- from scratch -- any prior driver-time override, distance, or suggested
  -- bus/driver was tied to the old specifics and no longer applies.
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
    v_new_dest_name, v_new_dest_addr, v_new_trip_type,
    v_new_trip_date, v_new_departure, v_new_return,
    NULLIF(p_data->>'student_count', '')::smallint,
    NULLIF(p_data->>'adults_count', '')::smallint,
    p_data->'grade_breakdown',
    COALESCE((p_data->>'cargo_needed')::boolean, false),
    p_data->>'pickup_address',
    p_data->'contact_primary',
    p_data->'contact_secondary',
    p_data->'contact_day_of',
    p_data->>'special_requests',
    NULLIF(p_data->>'driver_preference', ''),
    v_ver.internal_notes, v_ver.customer_notes,
    auth.uid(), now()
  )
  RETURNING id INTO v_new_ver_id;

  -- Shuttle runs / multi-destination stops: insert fresh, keyed off the NEW
  -- trip type (not the old one), tied to v_new_ver_id. Converting AWAY from
  -- shuttle/multi_destination simply attaches nothing to the new version --
  -- the old version's rows are left completely alone either way, never
  -- deleted or re-pointed.
  IF v_new_trip_type = 'shuttle' THEN
    INSERT INTO public.quote_shuttle_runs (quote_version_id, run_number, pickup_time, dropoff_time)
    SELECT v_new_ver_id,
           COALESCE(NULLIF(elem->>'run_number', '')::smallint, ord::smallint),
           (elem->>'pickup_time')::time,
           (elem->>'dropoff_time')::time
    FROM jsonb_array_elements(v_shuttle_runs) WITH ORDINALITY AS t(elem, ord);
  ELSIF v_new_trip_type = 'multi_destination' THEN
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
