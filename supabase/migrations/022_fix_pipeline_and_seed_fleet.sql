-- Migration 022: unblock the quote → approve → assign pipeline.
--
-- Three fixes surfaced by end-to-end testing:
--   1. quote_versions had no updated_at column, so calculate_estimate() crashed
--      ("column updated_at does not exist") — blocking pricing on every quote.
--   2. approve_quote let quotes be approved with no calculated total.
--   3. There were 0 buses and 0 driver_bus_clearances seeded, so
--      suggest_assignment() could never return a driver+bus pair.
--      Seed a small DEMO fleet (Curtis's real fleet replaces this later).

-- 1. ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS quote_versions_updated_at ON public.quote_versions;
CREATE TRIGGER quote_versions_updated_at
  BEFORE UPDATE ON public.quote_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. ─────────────────────────────────────────────────────────────────────────
-- Require a calculated estimate before a quote can be approved.
CREATE OR REPLACE FUNCTION approve_quote(
  p_quote_id       uuid,
  p_invoice_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote      quotes%ROWTYPE;
  v_ver        quote_versions%ROWTYPE;
  v_inv_number text;
  v_invoice_id uuid;
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

  -- New guard: never approve a quote with no price.
  IF v_ver.total IS NULL THEN
    RAISE EXCEPTION 'Calculate an estimate before approving this quote.';
  END IF;

  v_inv_number := COALESCE(
    NULLIF(trim(p_invoice_number), ''),
    'INV-' || regexp_replace(v_quote.quote_number, '^Q-', '')
  );

  UPDATE quotes SET status = 'approved', updated_at = now() WHERE id = p_quote_id;

  INSERT INTO invoices (
    quote_id, school_id, invoice_number, status,
    subtotal, tax_amount, total, issued_date, due_date
  ) VALUES (
    p_quote_id,
    v_quote.school_id,
    v_inv_number,
    'draft',
    COALESCE(v_ver.subtotal, v_ver.total, 0),
    COALESCE(v_ver.surcharge_total, 0),
    COALESCE(v_ver.total, 0),
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '30 days'
  )
  RETURNING id INTO v_invoice_id;

  RETURN jsonb_build_object(
    'quote_id',       p_quote_id,
    'status',         'approved',
    'invoice_number', v_inv_number,
    'invoice_id',     v_invoice_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION approve_quote(uuid, text) TO authenticated;

-- 3. ─────────────────────────────────────────────────────────────────────────
-- DEMO fleet so the assignment flow works end-to-end. Replace with Curtis's
-- real fleet data later (these all share the single seeded yard).
INSERT INTO public.buses (fleet_number, bench_count, air_brake_req, home_yard_id, active, notes)
SELECT v.fleet_number, v.bench_count, v.air_brake_req, (SELECT id FROM public.yards ORDER BY created_at LIMIT 1), true, 'DEMO seed — replace with Curtis fleet data'
FROM (VALUES
  ('Bus 01', 18::smallint, false),
  ('Bus 02', 18::smallint, false),
  ('Bus 10', 47::smallint, false),
  ('Bus 11', 47::smallint, true),
  ('Bus 12', 47::smallint, true),
  ('Bus 20', 56::smallint, true),
  ('Bus 21', 56::smallint, true)
) AS v(fleet_number, bench_count, air_brake_req)
ON CONFLICT (fleet_number) DO NOTHING;

-- Clear every existing driver to operate all three bench sizes, and give them
-- the air-brake cert so they can take the larger coaches (DEMO — Curtis's
-- real clearances replace this).
UPDATE public.drivers SET air_brake_cert = true WHERE air_brake_cert = false;

INSERT INTO public.driver_bus_clearances (driver_id, bench_count)
SELECT d.id, bc.bench_count
FROM public.drivers d
CROSS JOIN (VALUES (18::smallint), (47::smallint), (56::smallint)) AS bc(bench_count)
ON CONFLICT (driver_id, bench_count) DO NOTHING;
