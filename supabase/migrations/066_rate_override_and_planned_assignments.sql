-- Migration 066: edit the VARIABLES, not the total; and plan assignments early.
--
-- APPLIED 2026-08-05. Verified the three RPCs exist and that 063/064/065 all
-- survived the calculate_estimate patch.
--
-- Mila, 2026-08-05: "instead of just having her be able to edit the full number,
-- I want her to be able to edit the variables instead and then just have that
-- auto calculate."
--
-- Hours were already editable (approved_driver_hours). Rate was not -- the only
-- way to change what a trip cost per hour was to overwrite the base-cost dollar
-- figure, which then no longer agreed with the hours shown beside it. This adds
-- the missing variable. The dollar overrides stay as a fallback (Mila's call)
-- for cases that aren't expressible as hours x rate, like a goodwill discount.
--
-- The full SQL as applied is reproduced below. See the DO block at the end for
-- the calculate_estimate patch, which is assert-and-replace against the live
-- definition rather than CREATE OR REPLACE -- a full redefinition here would
-- silently revert 063 (measured driver time), 064 (pre-trip waiver) and 065
-- (preview mode).

ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS override_hourly_rate numeric;

COMMENT ON COLUMN public.quote_versions.override_hourly_rate IS
  'Admin-set hourly rate replacing the rate_config lookup. Base cost recalculates from it, so hours x rate always matches the displayed total.';

-- ── Planned assignments, one row per bus ────────────────────────────────
-- A table rather than planned_bus_id/planned_driver_id columns, because
-- multi-bus trips are regular (Mila, 2026-08-04) and columns would only ever
-- hold one.
--
-- Deliberately separate from `trips`. A trip is a commitment; this is a plan,
-- and a plan that changes three times before approval shouldn't leave three
-- trip records behind.
CREATE TABLE IF NOT EXISTS public.quote_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_version_id  uuid NOT NULL REFERENCES public.quote_versions(id) ON DELETE CASCADE,
  slot_number       int  NOT NULL CHECK (slot_number >= 1),
  bus_id            uuid REFERENCES public.buses(id),
  driver_id         uuid REFERENCES public.drivers(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_version_id, slot_number)
);

-- A bus or driver can't be in two slots of the SAME trip. Cross-trip conflicts
-- are the scheduler's job (not built yet); this only catches the obvious
-- double-booking within one quote.
CREATE UNIQUE INDEX IF NOT EXISTS quote_assignments_one_bus_per_quote
  ON public.quote_assignments (quote_version_id, bus_id) WHERE bus_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quote_assignments_one_driver_per_quote
  ON public.quote_assignments (quote_version_id, driver_id) WHERE driver_id IS NOT NULL;

ALTER TABLE public.quote_assignments ENABLE ROW LEVEL SECURITY;

-- Admin only, both directions. Unlike rates, who is driving is not something a
-- customer needs -- or should -- see.
DROP POLICY IF EXISTS "quote_assignments_admin" ON public.quote_assignments;
CREATE POLICY "quote_assignments_admin" ON public.quote_assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

COMMENT ON TABLE public.quote_assignments IS
  'Planned bus/driver per slot while a quote is being reviewed. One row per bus. Becomes real trips at confirm_trip; not a commitment on its own.';

-- ── Writers ─────────────────────────────────────────────────────────────
-- All follow set_quote_approved_driver_hours: admin-only, optimistic locking so
-- a write can't land on a version the admin wasn't looking at.

CREATE OR REPLACE FUNCTION public.set_quote_hourly_rate_override(
  p_quote_id uuid, p_rate numeric, p_expected_version_id uuid DEFAULT NULL::uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_rate IS NOT NULL AND p_rate < 0 THEN
    RAISE EXCEPTION 'hourly rate cannot be negative';
  END IF;
  PERFORM public._assert_current_version(p_quote_id, p_expected_version_id);
  UPDATE quote_versions v SET override_hourly_rate = p_rate
  FROM quotes q WHERE q.id = p_quote_id AND v.id = q.current_version_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_quote_yard(
  p_quote_id uuid, p_yard_id uuid, p_expected_version_id uuid DEFAULT NULL::uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  PERFORM public._assert_current_version(p_quote_id, p_expected_version_id);
  UPDATE quote_versions v SET yard_id = p_yard_id
  FROM quotes q WHERE q.id = p_quote_id AND v.id = q.current_version_id;
END;
$fn$;

-- Upsert one slot. NULL bus or driver clears just that side, so Melody can pick
-- a bus before she knows who's driving it -- which is how it actually happens.
CREATE OR REPLACE FUNCTION public.set_quote_assignment(
  p_quote_id uuid, p_slot int, p_bus_id uuid, p_driver_id uuid,
  p_expected_version_id uuid DEFAULT NULL::uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_ver uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  PERFORM public._assert_current_version(p_quote_id, p_expected_version_id);
  SELECT current_version_id INTO v_ver FROM quotes WHERE id = p_quote_id;
  IF v_ver IS NULL THEN RAISE EXCEPTION 'quote not found'; END IF;

  INSERT INTO quote_assignments (quote_version_id, slot_number, bus_id, driver_id)
  VALUES (v_ver, p_slot, p_bus_id, p_driver_id)
  ON CONFLICT (quote_version_id, slot_number)
  DO UPDATE SET bus_id = EXCLUDED.bus_id, driver_id = EXCLUDED.driver_id, updated_at = now();
END;
$fn$;

-- ── Wire the rate override into pricing ─────────────────────────────────
DO $mig$
DECLARE v_src text; v_new text; v_prev text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'calculate_estimate' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'calculate_estimate not found'; END IF;
  IF position('IF p_persist THEN' in v_src) = 0 THEN
    RAISE EXCEPTION 'migration 065 not applied; refusing to patch';
  END IF;

  v_new := v_src;

  v_prev := v_new;
  v_new := replace(v_new,
    '  IF v_rate IS NULL THEN' || E'\n' ||
    '    RAISE EXCEPTION ''no rate found for bench_count=%, customer_type=%'', v_bench_count, v_customer;' || E'\n' ||
    '  END IF;',
    '  IF v_rate IS NULL THEN' || E'\n' ||
    '    RAISE EXCEPTION ''no rate found for bench_count=%, customer_type=%'', v_bench_count, v_customer;' || E'\n' ||
    '  END IF;' || E'\n' || E'\n' ||
    '  -- Admin rate override (066). Applied here so EVERYTHING downstream --' || E'\n' ||
    '  -- base cost, overtime, the displayed hourly figure -- derives from the' || E'\n' ||
    '  -- same number. Editing the variable is the point; the total follows.' || E'\n' ||
    '  v_sys_hourly_rate := v_rate;' || E'\n' ||
    '  v_rate := COALESCE(v_ver.override_hourly_rate, v_rate);');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 1 (rate lookup) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '  v_rate         numeric;',
    '  v_rate         numeric;' || E'\n  v_sys_hourly_rate numeric;');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 2 (declaration) not found'; END IF;

  v_prev := v_new;
  v_new := replace(v_new,
    '    ''hourly_rate'', v_rate,',
    '    ''hourly_rate'', v_rate,' || E'\n' ||
    '    ''system_hourly_rate'', v_sys_hourly_rate,' || E'\n' ||
    '    ''override_hourly_rate'', v_ver.override_hourly_rate,');
  IF v_new = v_prev THEN RAISE EXCEPTION 'anchor 3 (json) not found'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'calculate_estimate patched: hourly rate is now overridable';
END
$mig$;
