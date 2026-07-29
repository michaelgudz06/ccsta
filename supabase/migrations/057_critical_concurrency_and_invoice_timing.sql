-- Migration 057: the three CRITICAL/HIGH concurrency bugs from BUG_BACKLOG.
--
-- APPLIED to the live DB 2026-07-27 via the Supabase connector, in three
-- parts: 057a_no_invoice_at_approval, 057b_lock_version_numbering,
-- 057c_optimistic_lock_on_pricing_writes. This file is the combined,
-- authoritative version.
--
-- ── #1 — "editing an approved quote orphans its invoice" ────────────────
-- Resolved by removing the cause rather than managing the symptom.
--
-- approve_quote used to INSERT an invoice the moment a price was approved,
-- long before the trip ran. That row was the thing being orphaned: the
-- customer edits, the new version's pricing is nulled for re-quoting, and the
-- invoice sits there still asserting the old amount with nothing flagging it.
--
-- Decided with Mila 2026-07-27: an invoice is the bill a school pays AFTER
-- the trip. Nothing in the system ever advanced an invoice from 'draft' to
-- 'sent' or 'paid' anyway -- the post-trip billing flow hasn't been built. So
-- the invoice-at-approval row was a price snapshot wearing an invoice
-- costume, and the approved price already lives on the quote version.
--
-- This also fixes a latent failure nobody had hit: invoice_number is derived
-- from the (unchanging) quote number, so re-approving an edited quote would
-- have raised a unique-constraint violation on the second INSERT.
--
-- Existing invoice rows are left alone (one draft, on a test quote).
--
-- ── #5 — duplicate/racing quote versions ────────────────────────────────
-- edit_own_quote computed the next version with an unlocked
-- "SELECT COALESCE(MAX(version_number), 0) + 1". Two near-simultaneous edits
-- could both read the same MAX and insert the same version_number. Fixed with
-- a unique constraint AND a row lock on the parent quote before the read.
--
-- ── #2 — admin pricing writes racing a customer edit ────────────────────
-- Melody opens a quote to price it; the customer submits an edit, which
-- creates a new version and repoints quotes.current_version_id. The setters
-- resolve current_version_id at call time, so her typed value landed on the
-- customer's brand-new version. No error either side.
--
-- Each setter now takes the version id the admin was looking at and refuses
-- if it no longer matches. NULL skips the check, so un-updated callers still
-- work. The parameter is added with a DEFAULT and the old signature dropped,
-- so existing calls resolve to the new function -- backward compatible, no
-- deploy ordering required.
--
-- Deliberately NOT guarded:
--   * calculate_estimate recomputes from whatever the current version is, so
--     running it against a newer version is correct, not a race.
--   * approve_quote is already protected: an edit nulls the new version's
--     pricing and approve_quote refuses a quote with no total.
--
-- Verified after applying: all three guard cases (match / NULL / stale)
-- behaved correctly, and a live Waive/Reset round trip through the new
-- signature left Q-2027-001 byte-identical to its starting values.

-- ── 057a ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_quote(p_quote_id uuid, p_invoice_number text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_quote        quotes%ROWTYPE;
  v_ver          quote_versions%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;
  IF v_quote.status NOT IN ('requested', 'in_review') THEN
    RAISE EXCEPTION 'quote cannot be approved from status %', v_quote.status;
  END IF;

  SELECT * INTO v_ver FROM quote_versions WHERE id = v_quote.current_version_id;

  -- Restored in migration 054 from migration 022, which a later migration had
  -- silently reverted. Also doubles as a race guard: a customer edit nulls the
  -- pricing on the new version, so approving a quote that was edited out from
  -- under you fails here rather than approving an unpriced trip.
  IF v_ver.total IS NULL THEN
    RAISE EXCEPTION 'Calculate an estimate before approving this quote.';
  END IF;

  UPDATE quotes SET status = 'approved', updated_at = now() WHERE id = p_quote_id;

  -- NO invoice is created here any more (migration 057a). p_invoice_number is
  -- kept in the signature so existing callers don't break, but it is ignored.

  PERFORM _queue_email(
    _customer_email(p_quote_id),
    'Your CCSTA quote ' || v_quote.quote_number || ' is ready',
    'Hi,' || E'\n\nGood news — your field trip quote has been reviewed and priced.'
      || E'\n\n  Quote:       ' || v_quote.quote_number
      || E'\n  Destination: ' || COALESCE(v_ver.destination_name, 'TBD')
      || E'\n  Trip date:   ' || COALESCE(v_ver.trip_date::text, 'TBD')
      || COALESCE(E'\n  Total:       $' || to_char(v_ver.total, 'FM999,990.00') || ' (incl. GST)', '')
      || E'\n\nSign in to accept the price and lock in your bus: ' || _site_url() || '/portal'
      || E'\n\n— CCSTA',
    p_quote_id
  );

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'status',   'approved',
    'total',    v_ver.total
  );
END;
$function$;

-- ── 057b ────────────────────────────────────────────────────────────────
ALTER TABLE public.quote_versions
  DROP CONSTRAINT IF EXISTS quote_versions_quote_id_version_number_key;
ALTER TABLE public.quote_versions
  ADD CONSTRAINT quote_versions_quote_id_version_number_key
  UNIQUE (quote_id, version_number);

-- The row lock is inserted by exact string replacement against the LIVE body,
-- asserted to match. Nothing else in edit_own_quote is retyped, so this can't
-- silently revert unrelated logic -- the failure mode that lost migration
-- 022's guard.
DO $mig$
DECLARE
  d  text;
  d0 text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'edit_own_quote';

  IF d IS NULL THEN RAISE EXCEPTION 'edit_own_quote not found'; END IF;

  d0 := d;
  d := replace(
    d,
    '  v_next_version := (',
    '  -- Serialise concurrent edits of the same quote (migration 057b). The'  || E'\n' ||
    '  -- second writer blocks here until the first commits, then reads a MAX' || E'\n' ||
    '  -- that already includes it. Without this, both could read the same'    || E'\n' ||
    '  -- value and insert the same version_number.'                           || E'\n' ||
    '  PERFORM 1 FROM quotes WHERE id = p_quote_id FOR UPDATE;'                || E'\n' ||
    '  v_next_version := ('
  );
  IF d = d0 THEN RAISE EXCEPTION 'version-number block not found -- live body has drifted'; END IF;

  EXECUTE d;
END
$mig$;

-- ── 057c ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_current_version(p_quote_id uuid, p_expected_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current uuid;
BEGIN
  IF p_expected_version_id IS NULL THEN RETURN; END IF;   -- caller opted out
  SELECT current_version_id INTO v_current FROM quotes WHERE id = p_quote_id;
  IF v_current IS DISTINCT FROM p_expected_version_id THEN
    RAISE EXCEPTION 'This quote was changed by the customer while you were working on it. Refresh to see the new details before pricing it.';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._assert_current_version(uuid, uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.set_quote_approved_driver_hours(uuid, numeric);

CREATE OR REPLACE FUNCTION public.set_quote_approved_driver_hours(
  p_quote_id uuid,
  p_hours    numeric,
  p_expected_version_id uuid DEFAULT NULL
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
  SET approved_driver_hours = p_hours
  FROM quotes q
  WHERE q.id = p_quote_id
    AND v.id = q.current_version_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_quote_approved_driver_hours(uuid, numeric, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.set_quote_price_override(uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.set_quote_price_override(
  p_quote_id uuid,
  p_field    text,
  p_value    numeric,
  p_expected_version_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ver_id uuid;
  v_col    text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM public._assert_current_version(p_quote_id, p_expected_version_id);

  -- Whitelist, not interpolation -- p_field reaches dynamic SQL below.
  v_col := CASE p_field
    WHEN 'base_cost'     THEN 'override_base_cost'
    WHEN 'fuel'          THEN 'override_fuel'
    WHEN 'overtime'      THEN 'override_overtime'
    WHEN 'long_distance' THEN 'override_long_distance'
    ELSE NULL
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'unknown price field %', p_field;
  END IF;

  IF p_value IS NOT NULL AND p_value < 0 THEN
    RAISE EXCEPTION 'price cannot be negative';
  END IF;

  SELECT current_version_id INTO v_ver_id FROM quotes WHERE id = p_quote_id;
  IF v_ver_id IS NULL THEN RAISE EXCEPTION 'quote not found'; END IF;

  EXECUTE format('UPDATE quote_versions SET %I = $1, updated_at = now() WHERE id = $2', v_col)
  USING p_value, v_ver_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_quote_price_override(uuid, text, numeric, uuid) TO authenticated;
