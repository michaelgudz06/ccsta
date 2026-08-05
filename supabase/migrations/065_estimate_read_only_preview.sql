-- Migration 065: let the cost breakdown be READ without re-pricing the quote.
--
-- APPLIED 2026-08-04. Verified: exactly one calculate_estimate now exists,
-- calculate_estimate(uuid, boolean), and its write is inside IF p_persist.
--
-- Mila: "I don't like that you always have to press recalculate to see the cost
-- breakdown... Melody's always gonna want to see it."
--
-- ── Why this needed a migration and not just a UI change ────────────────
-- The obvious fix is to call calculate_estimate when the quote opens. That has
-- a trap: calculate_estimate WRITES. It updates subtotal, surcharge_total,
-- total and system_driver_hours on the version. Auto-running it on open would
-- silently re-price every quote an admin merely looked at.
--
-- Not hypothetical. The driver-time rules changed TODAY (063/064). Opening an
-- approved quote from last week would quietly move a number the customer had
-- already agreed to, with nobody having asked for it.
--
-- So: p_persist. Viewing computes and returns without writing; Recalculate
-- writes. Same code path either way, so the previewed breakdown cannot drift
-- from what Recalculate would produce -- which a separate read-only copy of the
-- function would have risked, and duplication-drift is this project's known
-- weak spot.
--
-- ── The one-arg function has to go ──────────────────────────────────────
-- Adding a defaulted parameter creates an OVERLOAD, not a replacement, and
-- calculate_estimate(x) would then be ambiguous between the two. The DROP
-- happens only after the replacement text is fully built and asserted, so a
-- failed patch leaves the original in place.
DO $mig$
DECLARE
  v_src text;
  v_new text;
  v_prev text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'calculate_estimate' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'calculate_estimate not found'; END IF;
  IF position('NOT COALESCE(v_ver.pretrip_waived, false)' in v_src) = 0 THEN
    RAISE EXCEPTION 'migration 064 does not appear to be applied; refusing to patch';
  END IF;

  v_new := v_src;

  v_prev := v_new;
  v_new := replace(v_new,
    'FUNCTION public.calculate_estimate(p_quote_id uuid)',
    'FUNCTION public.calculate_estimate(p_quote_id uuid, p_persist boolean DEFAULT true)');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 1 (signature) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '  UPDATE quote_versions' || E'\n' ||
    '  SET subtotal            = v_base_cost,',
    '  -- Skipped when previewing. Reading a quote must never change its price.' || E'\n' ||
    '  IF p_persist THEN' || E'\n' ||
    '  UPDATE quote_versions' || E'\n' ||
    '  SET subtotal            = v_base_cost,');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 2 (update head) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '  WHERE id = v_ver.id;' || E'\n' || E'\n' || '  RETURN jsonb_build_object(',
    '  WHERE id = v_ver.id;' || E'\n' || '  END IF;' || E'\n' || E'\n' || '  RETURN jsonb_build_object(');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 3 (update tail) not found'; END IF;

  -- Report the mode back, so a bug that previews when it meant to persist is
  -- visible rather than silent.
  v_prev := v_new;
  v_new := replace(v_new,
    '    ''quote_id'', p_quote_id,',
    '    ''quote_id'', p_quote_id,' || E'\n' || '    ''persisted'', p_persist,');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 4 (json) not found'; END IF;

  DROP FUNCTION public.calculate_estimate(uuid);
  EXECUTE v_new;

  RAISE NOTICE 'calculate_estimate: preview mode added (p_persist)';
END
$mig$;
