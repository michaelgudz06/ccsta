-- Migration 064: let Melody waive the 15-minute pre-trip per quote.
--
-- APPLIED 2026-08-04. Verified: Frost Road 0.25h -> 0h when waived, Abbotsford
-- 2.0h -> 1.75h. Exactly the pre-trip comes off and nothing else moves.
--
-- 063 always assumes pre-trip applies, because at quote time nobody knows
-- whether this bus already ran a route that morning. Once the schedule is set
-- that usually IS known -- this is the release valve.
--
-- ── Why a column and not a price override ───────────────────────────────
-- The fuel waiver is implemented as "set that dollar figure to zero", which is
-- right for fuel: it's a standalone line item. Pre-trip isn't. It's an INPUT to
-- driver hours, so waiving it has to change the hours and let the hourly rate
-- flow through. Zeroing a dollar figure instead would leave the displayed hours
-- contradicting the displayed cost.
--
-- ── Only meaningful for measured driver time ────────────────────────────
-- If the Google lookup didn't resolve, driver time is the old flat hour, which
-- has no separate pre-trip component to remove. The waiver is a no-op there,
-- so the admin UI hides the button in that case rather than offering a control
-- that does nothing.

ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS pretrip_waived boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quote_versions.pretrip_waived IS
  'Admin waived the 15-minute pre-trip: this bus already ran a route or another driver did the pre-trip. Only affects quotes whose driver time is MEASURED -- the flat buffer has no separate pre-trip component to remove.';

-- Modelled on set_quote_approved_driver_hours: admin-only, optimistic locking
-- via _assert_current_version so a write can't land on a version the admin
-- wasn't looking at.
CREATE OR REPLACE FUNCTION public.set_quote_pretrip_waived(
  p_quote_id uuid,
  p_waived boolean,
  p_expected_version_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public._assert_current_version(p_quote_id, p_expected_version_id);

  UPDATE quote_versions v
  SET pretrip_waived = COALESCE(p_waived, false)
  FROM quotes q
  WHERE q.id = p_quote_id
    AND v.id = q.current_version_id;
END;
$function$;

-- Assert-and-replace, not CREATE OR REPLACE: a full redefinition here would
-- revert 063 if this file were ever re-run out of order. The guard below makes
-- that failure loud instead of silent.
DO $mig$
DECLARE
  v_src text;
  v_new text;
  v_prev text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'calculate_estimate' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'calculate_estimate not found'; END IF;
  IF position('v_driver_travel_hours := public.driver_time_hours(' in v_src) = 0 THEN
    RAISE EXCEPTION 'migration 063 does not appear to be applied; refusing to patch';
  END IF;

  v_new := v_src;

  v_prev := v_new;
  v_new := replace(v_new,
    '    v_driver_travel_hours := public.driver_time_hours(' || E'\n' ||
    '      v_ver.leg_out_minutes, v_ver.leg_back_minutes, true);',
    '    v_driver_travel_hours := public.driver_time_hours(' || E'\n' ||
    '      v_ver.leg_out_minutes, v_ver.leg_back_minutes,' || E'\n' ||
    '      NOT COALESCE(v_ver.pretrip_waived, false));');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 1 (pretrip flag) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '    ''leg_back_minutes'', v_ver.leg_back_minutes,',
    '    ''leg_back_minutes'', v_ver.leg_back_minutes,' || E'\n' ||
    '    ''pretrip_waived'', COALESCE(v_ver.pretrip_waived, false),');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 2 (json output) not found'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'calculate_estimate patched: pre-trip is now waivable';
END
$mig$;
