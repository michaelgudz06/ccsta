-- Migration 069: a half-failed travel lookup must not discount the quote.
--
-- APPLIED 2026-08-05. Found by audit.
--
-- Migration 063's own comment claimed: "NULL legs mean the lookup was
-- unavailable, NOT that travel was zero -- falling back to the buffer keeps a
-- failed lookup from quietly discounting a quote."
--
-- That was only true when BOTH legs were NULL. The condition was OR, and
-- _driver_leg_minutes(NULL) returns 0, so ONE failed leg billed as zero travel
-- for that leg. Reachable: the edge function pushes {minutes: null} per leg
-- independently on no-route, google-error-*, fetch-failed, bad-date or
-- incomplete, then persists whatever each leg produced.
--
-- The pathological case this closes: a 3-minute leg plus a failed leg gives
-- 0 + 0 + 15 = 0.25 h -- BELOW the 1.00 h flat buffer the fallback exists to
-- guarantee. A failed lookup made the quote CHEAPER than having no lookup.
DO $mig$
DECLARE v_src text; v_new text; v_prev text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'calculate_estimate' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'calculate_estimate not found'; END IF;

  v_new := v_src;
  v_prev := v_new;
  v_new := replace(v_new,
    '  IF v_ver.leg_out_minutes IS NOT NULL OR v_ver.leg_back_minutes IS NOT NULL THEN',
    '  -- BOTH legs, not either (069). One failed lookup used to bill as zero'
    || E'\n  -- travel for that leg, which could land below the flat buffer this'
    || E'\n  -- branch exists to fall back to.'
    || E'\n  IF v_ver.leg_out_minutes IS NOT NULL AND v_ver.leg_back_minutes IS NOT NULL THEN');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 1 (measured branch) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '    ''driver_time_source'', CASE WHEN v_ver.leg_out_minutes IS NOT NULL OR v_ver.leg_back_minutes IS NOT NULL',
    '    ''driver_time_source'', CASE WHEN v_ver.leg_out_minutes IS NOT NULL AND v_ver.leg_back_minutes IS NOT NULL');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 2 (json source) not found'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'calculate_estimate: measured driver time now requires BOTH legs';
END
$mig$;
