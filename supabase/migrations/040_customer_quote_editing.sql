-- Migration 040: customer quote editing (non-scheduled quotes only).
--
-- Scope, per confirmed decisions:
--   - Editable statuses: requested, in_review, approved, confirmed.
--     NOT scheduled (a bus/driver is already assigned -- deferred until
--     the unassign flow is confirmed with Melody), NOT cancelled/completed/
--     invoiced.
--   - Editable fields: trip_date, departure_time, return_time,
--     student_count/adults_count/grade_breakdown (passenger counts),
--     pickup_address. NOT destination, NOT trip_type.
--   - Timing rule: blocked within 1 week of the CURRENT trip_date, UNLESS
--     the new trip_date is LATER than the current one (pushing out is
--     always fine).
--   - Mutually exclusive with a pending cancellation request.
--   - Creates a NEW quote_versions row (version_number + 1), flips
--     quotes.current_version_id, resets status to 'in_review' always,
--     stamps the new version's edited_at, and notifies Melody. No new
--     price is computed or shown to the customer -- it's pending
--     re-review, same as a fresh submission.
--
-- Scope note flagged, not silently assumed: shuttle/multi_destination
-- quotes CAN be edited for date/passengers/pickup-address, but their
-- per-run/per-stop times (quote_shuttle_runs.pickup_time/dropoff_time,
-- quote_multi_stops.arrival_time/departure_time) are NOT editable in this
-- iteration -- only the top-level departure_time/return_time envelope is.
-- Those child rows are still copied forward to the new version so the
-- admin view's run/stop breakdown doesn't go blank, but they'll reflect
-- the OLD, pre-edit times if the customer changes the envelope. The
-- client-side UI should hide/disable envelope time editing for these two
-- trip types to avoid creating a confusing mismatch (a customer editing
-- passenger counts on a shuttle quote is fine and unambiguous; editing its
-- time is not, until per-run/per-stop editing exists).
--
-- "One version per quote" audit: grepped the whole codebase for any
-- quote_versions query scoped by quote_id (not by a specific version id)
-- that would break once version 2 exists. Found none -- every read in
-- admin.tsx, portal.tsx, quote.tsx, and every SQL function goes through
-- quotes.current_version_id (or a specific .id), never an unscoped
-- "one row per quote_id" assumption. Safe to introduce a second version.
--
-- No same-transaction gotcha: plain column add + new function, no enum/type
-- changes. Safe to run as one script.

ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

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

  -- Resolve edited fields, falling back to the current version's values for
  -- anything not supplied -- a partial edit shouldn't null out the rest.
  v_new_trip_date := COALESCE(NULLIF(p_data->>'trip_date', '')::date, v_ver.trip_date);
  v_new_departure := COALESCE(NULLIF(p_data->>'departure_time', '')::time, v_ver.departure_time);
  v_new_return    := COALESCE(NULLIF(p_data->>'return_time', '')::time, v_ver.return_time);

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

  -- Carry forward shuttle runs / multi-destination stops unchanged (see
  -- header note: their own times aren't editable here) so the admin view
  -- still shows the full run/stop breakdown against the new version.
  IF v_ver.trip_type = 'shuttle' THEN
    INSERT INTO public.quote_shuttle_runs (quote_version_id, run_number, pickup_time, dropoff_time)
    SELECT v_new_ver_id, run_number, pickup_time, dropoff_time
    FROM public.quote_shuttle_runs WHERE quote_version_id = v_ver.id;
  ELSIF v_ver.trip_type = 'multi_destination' THEN
    INSERT INTO public.quote_multi_stops (quote_version_id, stop_number, destination_name, destination_address, arrival_time, departure_time, lat, lng)
    SELECT v_new_ver_id, stop_number, destination_name, destination_address, arrival_time, departure_time, lat, lng
    FROM public.quote_multi_stops WHERE quote_version_id = v_ver.id;
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
