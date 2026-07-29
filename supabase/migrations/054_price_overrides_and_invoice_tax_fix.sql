-- Migration 054: per-component price overrides + correct invoice tax split.
--
-- APPLIED to the live DB 2026-07-27 via the Supabase connector, split into
-- three parts so a failure couldn't leave a half-written function:
--   054a_price_override_columns_and_setter
--   054b_calculate_estimate_with_overrides
--   054c_approve_quote_invoice_tax_split
-- This file is the combined, authoritative version. Re-running it is safe
-- (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE throughout).
--
-- Verified after applying: all six existing quotes' prices were byte-identical
-- to the pre-migration snapshot, and an end-to-end Waive/Reset round trip on a
-- test quote moved fuel 50.00 -> 0.00, subtotal 710 -> 660, GST 35.50 -> 33.00,
-- total 745.50 -> 693.00, then restored exactly.
--
-- Both function bodies below were pulled from the LIVE database with
-- pg_get_functiondef immediately before writing this (2026-07-27), per the
-- CREATE OR REPLACE rule in NEXT_SESSION.md section 6 — not copied from an
-- earlier migration file.
--
-- ── 1. Per-component overrides ──────────────────────────────────────────
-- Melody can now type over base cost, fuel, overtime and long-distance
-- directly instead of going through the separate "Adjust" panel. NULL means
-- "use the system value", so an override is opt-in per field and per quote.
--
-- Subtotal, GST and total are deliberately NOT overridable. They stay
-- derived from the four components, so an invoice can never disagree with
-- its own line items and GST is always a real calculation on a real
-- subtotal.
--
-- Overrides SURVIVE recalculation: calculate_estimate fills in only the
-- fields Melody hasn't touched. This was the explicit decision — a typed
-- number must never silently vanish because someone hit Recalculate or
-- Approve (which recalculates first). Clearing a field back to NULL is how
-- you return it to the system value.
--
-- ── 2. Invoice tax split (bug fix) ──────────────────────────────────────
-- approve_quote was writing:
--     invoice.subtotal   := quote_versions.subtotal        (base cost only)
--     invoice.tax_amount := quote_versions.surcharge_total (fuel/overtime!)
-- Neither column means what the invoice field expects. quote_versions
-- .subtotal holds BASE COST, and surcharge_total holds FEES — the portal
-- labels them honestly ("Bus & driver time" / "Fuel & other surcharges"),
-- but the invoice copied them into "subtotal" and "tax", so every invoice
-- called the fuel fee tax and omitted GST entirely.
--
-- Observed on the one existing invoice: subtotal 555.00 + tax 50.00 = 605.00
-- against a total of 635.25. The missing 30.25 was the GST.
--
-- Now: subtotal = base + surcharges, tax = total - subtotal (the real GST),
-- total unchanged. Parts always add up.
--
-- Existing invoice rows are deliberately left alone — the only one is a
-- draft on a test quote and will be regenerated. Do NOT retro-fix rows
-- without checking whether any have been sent.
--
-- ── 3. Restores a guard that was silently lost ──────────────────────────
-- Migration 022 added "never approve a quote with no price". The live body
-- does not have it — a later migration was based on a pre-022 body and
-- reverted it without anyone noticing. Restored here. Without it, approving
-- an unpriced quote creates a $0 invoice.

-- ── Override columns ────────────────────────────────────────────────────
ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS override_base_cost     numeric(10,2),
  ADD COLUMN IF NOT EXISTS override_fuel          numeric(10,2),
  ADD COLUMN IF NOT EXISTS override_overtime      numeric(10,2),
  ADD COLUMN IF NOT EXISTS override_long_distance numeric(10,2);

COMMENT ON COLUMN public.quote_versions.override_base_cost IS
  'Admin-typed base cost. NULL = use the system calculation. Survives recalculation.';
COMMENT ON COLUMN public.quote_versions.override_fuel IS
  'Admin-typed fuel fee. NULL = system value. Set to 0 by the Waive button.';
COMMENT ON COLUMN public.quote_versions.override_overtime IS
  'Admin-typed overtime charge. NULL = system value.';
COMMENT ON COLUMN public.quote_versions.override_long_distance IS
  'Admin-typed long-distance charge. NULL = system value.';

-- ── Setter RPC (mirrors set_quote_approved_driver_hours) ────────────────
CREATE OR REPLACE FUNCTION public.set_quote_price_override(
  p_quote_id uuid,
  p_field    text,
  p_value    numeric   -- NULL clears the override, returning to system value
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

  -- Whitelist, not interpolation — p_field reaches dynamic SQL below.
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

GRANT EXECUTE ON FUNCTION public.set_quote_price_override(uuid, text, numeric) TO authenticated;

-- ── calculate_estimate, with overrides applied ──────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_estimate(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_quote        quotes%ROWTYPE;
  v_ver          quote_versions%ROWTYPE;
  v_school       schools%ROWTYPE;
  v_students     int;
  v_young        numeric := 0;
  v_older        numeric := 0;
  v_seats        numeric;
  v_bench_seats  numeric;
  v_bench_count  int;
  v_bus_count    int;
  v_customer     text;
  v_trip_hours   numeric;
  v_pre_hours    numeric := 0;
  v_post_hours   numeric := 0;
  v_reference_driver_hours numeric;
  v_buffer_hours numeric;
  v_billable_trip_hours  numeric;
  v_system_driver_hours   numeric;
  v_driver_hours numeric;
  v_min_hours    numeric;
  v_bill_hours   numeric;
  v_rate         numeric;
  v_base_cost    numeric;
  v_fuel         numeric;
  v_overtime     numeric := 0;
  v_overtime_rate numeric;
  v_ot_threshold  numeric;
  v_fuel_per_trip numeric;
  v_distance_km   numeric;
  v_ld_threshold  numeric;
  v_ld_rate       numeric;
  v_long_distance numeric := 0;
  v_subtotal     numeric;
  v_gst_rate     numeric;
  v_gst          numeric;
  v_total        numeric;
  v_dest_match   destinations%ROWTYPE;
  -- Migration 054: system-calculated values, kept separately so the admin UI
  -- can show what the system would have charged next to Melody's override.
  v_sys_base_cost     numeric;
  v_sys_fuel          numeric;
  v_sys_overtime      numeric := 0;
  v_sys_long_distance numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;

  IF v_quote.customer_id != auth.uid() THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;

  SELECT * INTO v_ver    FROM quote_versions WHERE id = v_quote.current_version_id;
  SELECT * INTO v_school FROM schools        WHERE id = v_quote.school_id;

  -- Seat-based bus size + count.
  v_students := COALESCE(v_ver.student_count, 0);
  IF v_ver.grade_breakdown IS NOT NULL AND jsonb_typeof(v_ver.grade_breakdown) = 'array' THEN
    SELECT COALESCE(SUM(NULLIF(elem->>'count', '')::numeric), 0)
    INTO v_young
    FROM jsonb_array_elements(v_ver.grade_breakdown) AS elem
    WHERE lower(trim(elem->>'grade')) IN ('k', '1', '2', '3', '4');
  END IF;
  v_young := LEAST(v_young, v_students);                          -- can't exceed students
  v_older := GREATEST(v_students - v_young, 0) + COALESCE(v_ver.adults_count, 0);
  v_seats := v_young / 3.0 + v_older / 2.0;                       -- 3 young or 2 older per seat
  IF v_seats <= 0 THEN v_seats := 1; END IF;

  IF    v_seats <= 9     THEN v_bench_count := 18; v_bench_seats := 9;
  ELSIF v_seats <= 23.67 THEN v_bench_count := 47; v_bench_seats := 23.67;
  ELSE                        v_bench_count := 56; v_bench_seats := 28;
  END IF;
  v_bus_count := GREATEST(1, CEIL(v_seats / v_bench_seats));

  v_customer := CASE WHEN v_school.is_member THEN 'member' ELSE 'non_member' END;

  SELECT hourly_rate, min_hours INTO v_rate, v_min_hours
  FROM rate_config WHERE bench_count = v_bench_count AND customer_type = v_customer LIMIT 1;

  IF v_rate IS NULL THEN
    SELECT hourly_rate, min_hours INTO v_rate, v_min_hours
    FROM rate_config WHERE bench_count = v_bench_count AND customer_type = 'non_member' LIMIT 1;
  END IF;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'no rate found for bench_count=%, customer_type=%', v_bench_count, v_customer;
  END IF;

  SELECT value INTO v_fuel_per_trip FROM surcharge_config WHERE key = 'fuel_surcharge_per_trip';
  SELECT value INTO v_gst_rate      FROM surcharge_config WHERE key = 'gst_rate_pct';
  SELECT value INTO v_overtime_rate FROM surcharge_config WHERE key = 'overtime_rate_per_hour';
  SELECT value INTO v_ot_threshold  FROM surcharge_config WHERE key = 'overtime_threshold_hours';
  SELECT value INTO v_ld_threshold  FROM surcharge_config WHERE key = 'long_distance_threshold_km';
  SELECT value INTO v_ld_rate       FROM surcharge_config WHERE key = 'long_distance_rate_per_km';
  SELECT value INTO v_buffer_hours  FROM surcharge_config WHERE key = 'driver_time_buffer_hours';

  IF v_ver.departure_time IS NOT NULL AND v_ver.return_time IS NOT NULL THEN
    v_trip_hours := EXTRACT(EPOCH FROM (v_ver.return_time - v_ver.departure_time)) / 3600.0;
    IF v_trip_hours < 0 THEN v_trip_hours := v_trip_hours + 24; END IF;
  ELSE
    v_trip_hours := COALESCE(v_min_hours, 4);
  END IF;

  -- Per-location reference (informational, for admin only — no longer drives
  -- billing by default). Still computed live every call; not persisted.
  -- Deliberately uses the RAW trip_hours span (not the floored billable
  -- version below) — this stays honest to the true trip length for
  -- comparison, independent of the minimum-billing rule.
  SELECT * INTO v_dest_match FROM destinations
  WHERE lower(trim(name)) = lower(trim(v_school.name)) LIMIT 1;

  IF v_dest_match.id IS NULL AND v_ver.pickup_address IS NOT NULL THEN
    SELECT * INTO v_dest_match FROM destinations
    WHERE lower(trim(address)) ILIKE lower(trim(split_part(v_ver.pickup_address, ',', 1))) || '%' LIMIT 1;
  END IF;

  IF v_dest_match.id IS NOT NULL THEN
    v_pre_hours  := COALESCE(v_dest_match.pre_hours,  0);
    v_post_hours := COALESCE(v_dest_match.post_hours, 0);
  END IF;

  v_reference_driver_hours := v_trip_hours + v_pre_hours + v_post_hours;

  -- Minimum applies to TRIP TIME ONLY (the fix). The driver-time buffer is
  -- always added on top of the (possibly floored) trip time, never
  -- absorbed into the minimum.
  v_billable_trip_hours := GREATEST(v_trip_hours, COALESCE(v_min_hours, 4));

  -- System/public estimate: floored trip time + flat buffer — this is the
  -- audited "system-suggested" number, persisted every call.
  v_system_driver_hours := v_billable_trip_hours + COALESCE(v_buffer_hours, 1);

  -- Actual billing input: Melody's accurate override if she's set one,
  -- otherwise the system estimate above.
  v_driver_hours := COALESCE(v_ver.approved_driver_hours, v_system_driver_hours);

  -- No outer floor here (the fix, part 2): the system path already has the
  -- minimum baked in via v_billable_trip_hours above, so it's always
  -- >= min_hours + buffer regardless. Melody's override, if set, is now
  -- fully authoritative with no floor re-applied to it.
  v_bill_hours := v_driver_hours;

  IF v_ot_threshold IS NOT NULL AND v_driver_hours > v_ot_threshold THEN
    v_sys_overtime := (v_driver_hours - v_ot_threshold) * COALESCE(v_overtime_rate, 17) * v_bus_count;
  END IF;

  -- Long-distance surcharge: $1/km for each one-way km beyond 200km, per bus.
  v_distance_km := COALESCE(v_ver.distance_km, 0);
  IF v_ld_threshold IS NOT NULL AND v_distance_km > v_ld_threshold THEN
    v_sys_long_distance := (v_distance_km - v_ld_threshold) * COALESCE(v_ld_rate, 1) * v_bus_count;
  END IF;

  v_sys_base_cost := v_bill_hours * v_rate * v_bus_count;
  v_sys_fuel      := CASE WHEN v_ver.fuel_waived THEN 0
                          ELSE COALESCE(v_fuel_per_trip, 50) * v_bus_count END;

  -- Migration 054: admin overrides win per field; NULL falls through to the
  -- system value computed above.
  v_base_cost     := COALESCE(v_ver.override_base_cost,     v_sys_base_cost);
  v_fuel          := COALESCE(v_ver.override_fuel,          v_sys_fuel);
  v_overtime      := COALESCE(v_ver.override_overtime,      v_sys_overtime);
  v_long_distance := COALESCE(v_ver.override_long_distance, v_sys_long_distance);

  -- Always derived, never overridable — keeps the invoice internally
  -- consistent and GST an honest calculation.
  v_subtotal  := v_base_cost + v_fuel + v_overtime + v_long_distance;
  v_gst       := v_subtotal * COALESCE(v_gst_rate, 5) / 100.0;
  v_total     := v_subtotal + v_gst;

  UPDATE quote_versions
  SET subtotal            = v_base_cost,
      surcharge_total     = v_fuel + v_overtime + v_long_distance,
      total               = v_total,
      system_driver_hours = v_system_driver_hours,
      updated_at          = now()
  WHERE id = v_ver.id;

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'bench_count', v_bench_count,
    'bus_count', v_bus_count,
    'seats_needed', round(v_seats, 2),
    'customer_type', v_customer,
    'hourly_rate', v_rate,
    'trip_hours', round(v_trip_hours, 2),
    'billable_trip_hours', round(v_billable_trip_hours, 2),
    'driver_pre_hours', round(v_pre_hours, 3),
    'driver_post_hours', round(v_post_hours, 3),
    'reference_driver_hours', round(v_reference_driver_hours, 2),
    'system_driver_hours', round(v_system_driver_hours, 2),
    'approved_driver_hours', v_ver.approved_driver_hours,
    'driver_hours_used', round(v_driver_hours, 2),
    'billable_hours', round(v_bill_hours, 2),
    'min_hours', v_min_hours,
    'base_cost', round(v_base_cost, 2),
    'fuel_surcharge', round(v_fuel, 2),
    'fuel_waived', v_ver.fuel_waived,
    'overtime_charge', round(v_overtime, 2),
    'distance_km', v_distance_km,
    'long_distance_charge', round(v_long_distance, 2),
    'subtotal', round(v_subtotal, 2),
    'gst_pct', COALESCE(v_gst_rate, 5),
    'gst', round(v_gst, 2),
    'total', round(v_total, 2),
    'destination_matched', v_dest_match.name,
    -- Migration 054: what the system would charge, so the admin UI can show
    -- "system: $X" next to an overridden field and offer a one-click reset.
    'system_base_cost',           round(v_sys_base_cost, 2),
    'system_fuel_surcharge',      round(v_sys_fuel, 2),
    'system_overtime_charge',     round(v_sys_overtime, 2),
    'system_long_distance_charge', round(v_sys_long_distance, 2),
    'overrides', jsonb_build_object(
      'base_cost',     v_ver.override_base_cost,
      'fuel',          v_ver.override_fuel,
      'overtime',      v_ver.override_overtime,
      'long_distance', v_ver.override_long_distance
    )
  );
END;
$function$;

-- ── approve_quote: correct invoice split + restored no-price guard ──────
CREATE OR REPLACE FUNCTION public.approve_quote(p_quote_id uuid, p_invoice_number text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_quote        quotes%ROWTYPE;
  v_ver          quote_versions%ROWTYPE;
  v_inv_number   text;
  v_invoice_id   uuid;
  v_inv_subtotal numeric;
  v_inv_tax      numeric;
  v_inv_total    numeric;
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

  -- Restored from migration 022 (a later migration reverted it by being
  -- based on a pre-022 body). Without this, approving an unpriced quote
  -- silently creates a $0 invoice.
  IF v_ver.total IS NULL THEN
    RAISE EXCEPTION 'Calculate an estimate before approving this quote.';
  END IF;

  -- Default invoice number mirrors quote number
  v_inv_number := COALESCE(
    NULLIF(trim(p_invoice_number), ''),
    'INV-' || regexp_replace(v_quote.quote_number, '^Q-', '')
  );

  -- Invoice money split (migration 054 fix). quote_versions.subtotal holds
  -- BASE COST and surcharge_total holds FEES, so the invoice subtotal is the
  -- two together, and tax is whatever the total adds on top of that — i.e.
  -- the real GST. Previously the fee total was written into tax_amount and
  -- GST vanished, so subtotal + tax never equalled total.
  v_inv_subtotal := COALESCE(v_ver.subtotal, 0) + COALESCE(v_ver.surcharge_total, 0);
  v_inv_total    := COALESCE(v_ver.total, 0);
  v_inv_tax      := v_inv_total - v_inv_subtotal;

  UPDATE quotes SET status = 'approved', updated_at = now() WHERE id = p_quote_id;

  INSERT INTO invoices (
    quote_id, school_id, invoice_number, status,
    subtotal, tax_amount, total, issued_date, due_date
  ) VALUES (
    p_quote_id,
    v_quote.school_id,
    v_inv_number,
    'draft',
    v_inv_subtotal,
    v_inv_tax,
    v_inv_total,
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '30 days'
  )
  RETURNING id INTO v_invoice_id;

  -- Tell the customer their price is ready.
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
    'quote_id',       p_quote_id,
    'status',         'approved',
    'invoice_number', v_inv_number,
    'invoice_id',     v_invoice_id
  );
END;
$function$;
