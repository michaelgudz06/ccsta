-- Migration 071: refuse a trip whose end time is before its start.
--
-- APPLIED 2026-08-05. Verified the guard is present in both submit_quote and
-- edit_own_quote.
--
-- Found by audit. The AM/PM guard added for BUG_BACKLOG #11 lived in the CLIENT
-- and only covered two-way and one-way trips. Shuttle and multi-destination had
-- no guard at all, and both derive a billing envelope the same way --
-- MIN(pickup)..MAX(dropoff) for shuttle, departure..MAX(arrival) for
-- multi-destination.
--
-- calculate_estimate adds 24 hours when the return is earlier than the
-- departure, treating it as an overnight trip. A single shuttle run typed
-- 15:00 -> 08:00 (meaning 18:00) produced a 17-hour envelope. Computed against
-- the live config:
--
--   would have billed   $1,968.75
--   should have billed    $538.13
--
-- for a ~3-hour job. Nothing anywhere flagged it.
--
-- The guard sits at the ONE point in each function where the envelope is known
-- for every trip type, so a single check covers all four and can't be forgotten
-- when a fifth is added. Client-side validation (quote.tsx validateAll) is the
-- friendly version that explains the problem before submitting; this is the one
-- that can't be bypassed.
--
-- Note on the anchors: the two functions use different variable names --
-- submit_quote has v_departure/v_return, edit_own_quote has
-- v_new_departure/v_new_return -- so they are patched separately. A first
-- attempt using one shared anchor correctly ABORTED rather than silently
-- patching only one of the two, which is the whole point of asserting.
DO $mig$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'submit_quote' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'submit_quote not found'; END IF;

  IF position('Envelope sanity (071)' in v_src) = 0 THEN
    v_new := replace(v_src,
      '    v_return    := NULLIF(p_data->>''return_time'', '''')::time;' || E'\n' || '  END IF;',
      '    v_return    := NULLIF(p_data->>''return_time'', '''')::time;' || E'\n' || '  END IF;' || E'\n'
      || E'\n  -- Envelope sanity (071). calculate_estimate adds 24h when the return is'
      || E'\n  -- earlier than the departure, so a mistyped AM/PM silently bills a'
      || E'\n  -- 3-hour job as 17 hours. Covers every trip type: shuttle and'
      || E'\n  -- multi-destination envelopes are derived above and land here too.'
      || E'\n  IF v_departure IS NOT NULL AND v_return IS NOT NULL AND v_return <= v_departure THEN'
      || E'\n    RAISE EXCEPTION ''The trip end time (%) is not after the start time (%). Please check whether a time should be AM or PM.'', v_return, v_departure;'
      || E'\n  END IF;');
    IF v_new = v_src THEN RAISE EXCEPTION 'anchor not found in submit_quote'; END IF;
    EXECUTE v_new;
  END IF;

  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'edit_own_quote' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'edit_own_quote not found'; END IF;

  IF position('Envelope sanity (071)' in v_src) = 0 THEN
    v_new := replace(v_src,
      '    v_new_return    := NULLIF(p_data->>''return_time'', '''')::time;',
      '    v_new_return    := NULLIF(p_data->>''return_time'', '''')::time;' || E'\n'
      || E'\n  -- Envelope sanity (071). Same guard as submit_quote -- an edit can'
      || E'\n  -- introduce the same backwards envelope a fresh submission can.'
      || E'\n  IF v_new_departure IS NOT NULL AND v_new_return IS NOT NULL AND v_new_return <= v_new_departure THEN'
      || E'\n    RAISE EXCEPTION ''The trip end time (%) is not after the start time (%). Please check whether a time should be AM or PM.'', v_new_return, v_new_departure;'
      || E'\n  END IF;');
    IF v_new = v_src THEN RAISE EXCEPTION 'anchor not found in edit_own_quote'; END IF;
    EXECUTE v_new;
  END IF;

  RAISE NOTICE 'envelope guard added to submit_quote and edit_own_quote';
END
$mig$;
