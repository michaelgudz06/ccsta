-- Migration 063: use real travel time for the driver-time estimate.
--
-- APPLIED 2026-08-04. Verified: the measured branch is present, the old flat
-- line is gone, and approved_driver_hours still wins.
--
-- ── The decision behind it ──────────────────────────────────────────────
-- Mila, 2026-08-04: "give a rough number for the estimates but melody has the
-- last say."
--
-- So system_driver_hours becomes accurate rather than flat, and
-- approved_driver_hours keeps overriding it. That split already existed --
-- driver_time_buffer_hours is even described as "default pricing; Melody can
-- override with an accurate time" -- so this changes how the estimate is
-- reached, not who decides the final number.
--
-- Effect on base cost, measured against real Google times before shipping:
--   school ~3 min from the yard    -15%  (-20% if the bus already ran a route)
--   school ~20 min from the yard     0%
--   Abbotsford, 4h trip            +20%
--   Abbotsford, 8h day             +11%
--
-- The zero row is the useful one: the flat hour was implicitly priced for a
-- school 20 minutes out. Nearer schools were subsidising further ones.
--
-- ── Pre-trip is always assumed in the estimate ──────────────────────────
-- driver_time_hours takes p_include_pretrip, but whether THIS bus already ran
-- a route today isn't known at quote time -- that's settled at assignment.
-- Passing true quotes slightly high, which Melody can reduce. The reverse would
-- mean revising a quote upward after the customer has seen it, which is worse.
--
-- ── Why assert-and-replace ──────────────────────────────────────────────
-- A plain CREATE OR REPLACE would overwrite whatever is live with whatever this
-- file says, silently reverting any drift. That has bitten this project three
-- times. Instead the migration reads the live definition, patches exact strings,
-- and ABORTS if any anchor is missing.
DO $mig$
DECLARE
  v_src text;
  v_new text;
  v_prev text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'calculate_estimate' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'calculate_estimate not found'; END IF;

  v_new := v_src;

  v_prev := v_new;
  v_new := replace(v_new,
    '  v_system_driver_hours   numeric;',
    '  v_system_driver_hours   numeric;' || E'\n  v_driver_travel_hours   numeric;');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 1 (declaration) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '  v_system_driver_hours := v_billable_trip_hours + COALESCE(v_buffer_hours, 1);',
    '  -- Driver time: measured travel when the lookup resolved, flat buffer when'
    || E'\n  -- it did not. NULL legs mean the Google lookup was unavailable, NOT that'
    || E'\n  -- travel was zero -- falling back to the buffer keeps a failed lookup from'
    || E'\n  -- quietly discounting a quote.'
    || E'\n  --'
    || E'\n  -- Pre-trip is always included in the ESTIMATE. Whether this bus already ran'
    || E'\n  -- a route today is not known at quote time -- that is decided at assignment.'
    || E'\n  -- Assuming it does apply quotes slightly high, which Melody can reduce; the'
    || E'\n  -- reverse would mean revising a quote upward after the customer saw it.'
    || E'\n  IF v_ver.leg_out_minutes IS NOT NULL OR v_ver.leg_back_minutes IS NOT NULL THEN'
    || E'\n    v_driver_travel_hours := public.driver_time_hours('
    || E'\n      v_ver.leg_out_minutes, v_ver.leg_back_minutes, true);'
    || E'\n  ELSE'
    || E'\n    v_driver_travel_hours := COALESCE(v_buffer_hours, 1);'
    || E'\n  END IF;'
    || E'\n  v_system_driver_hours := v_billable_trip_hours + v_driver_travel_hours;');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 2 (driver hours assignment) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '    ''system_driver_hours'', round(v_system_driver_hours, 2),',
    '    ''system_driver_hours'', round(v_system_driver_hours, 2),'
    || E'\n    ''driver_travel_hours'', round(v_driver_travel_hours, 2),'
    || E'\n    ''driver_time_source'', CASE WHEN v_ver.leg_out_minutes IS NOT NULL OR v_ver.leg_back_minutes IS NOT NULL'
    || E'\n                                THEN ''measured'' ELSE ''flat_buffer'' END,'
    || E'\n    ''leg_out_minutes'', v_ver.leg_out_minutes,'
    || E'\n    ''leg_back_minutes'', v_ver.leg_back_minutes,');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 3 (json output) not found'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'calculate_estimate patched: driver time now measured when available';
END
$mig$;

-- ── State at apply time ─────────────────────────────────────────────────
-- 7 quote versions, 0 with leg_out_minutes populated. So every existing quote
-- still takes the flat-buffer branch and NO price has moved. The change only
-- takes effect once the quote form starts calling the travel-time function and
-- storing the legs -- which is the remaining frontend work.
