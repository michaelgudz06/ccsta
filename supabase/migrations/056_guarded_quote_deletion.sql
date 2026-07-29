-- Migration 056: admin-only quote deletion, with guards and an audit trail.
--
-- APPLIED to the live DB 2026-07-27 via the Supabase connector.
--
-- Why an RPC rather than letting the client DELETE directly: the foreign keys
-- make a plain delete either impossible or destructive. quote_versions,
-- quote_shuttle_runs and quote_multi_stops CASCADE, notification_log SET NULLs
-- (so email history survives, detached), but trips and invoices are NO ACTION
-- -- Postgres refuses the delete while either exists. Clearing them by hand
-- from the client would mean shipping the ability to erase bookings and
-- invoices with no checks at all.
--
-- The guards: a quote CANNOT be deleted if it has an invoice in any state
-- other than 'draft' (sent/paid/overdue/cancelled are business records an
-- accountant may need to account for), or a trip that has been completed
-- (a driver actually drove it). Everything else -- which is what test data
-- looks like -- deletes cleanly.
--
-- NOTE what this does NOT protect: a confirmed or scheduled booking whose
-- invoice is still a draft IS deletable. That's deliberate, since test
-- bookings need clearing, but it means a real customer's booking can be
-- deleted if someone confirms the dialog. The two-step confirm in the admin
-- UI is the only thing standing in the way. Tighten the guard here if that
-- ever stops being an acceptable trade.
--
-- Every deletion writes a full jsonb snapshot to deleted_quote_log first, so
-- a mistaken delete can be reconstructed even though the rows are gone.

CREATE TABLE IF NOT EXISTS public.deleted_quote_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number     text NOT NULL,
  school_name      text,
  quote_status     text,
  total            numeric(10,2),
  trips_deleted    int NOT NULL DEFAULT 0,
  invoices_deleted int NOT NULL DEFAULT 0,
  snapshot         jsonb NOT NULL,
  deleted_by       uuid,
  deleted_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deleted_quote_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deleted_quote_log_admin_read" ON public.deleted_quote_log;
CREATE POLICY "deleted_quote_log_admin_read"
  ON public.deleted_quote_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE OR REPLACE FUNCTION public.delete_quote(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote      quotes%ROWTYPE;
  v_ver        quote_versions%ROWTYPE;
  v_school     text;
  v_bad_inv    int;
  v_bad_trip   int;
  v_trips      int;
  v_invoices   int;
  v_snapshot   jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;

  SELECT * INTO v_ver FROM quote_versions WHERE id = v_quote.current_version_id;
  SELECT name INTO v_school FROM schools WHERE id = v_quote.school_id;

  -- Guard 1: a real invoice has left draft. Deleting it would punch a hole in
  -- a sequential business record.
  SELECT count(*) INTO v_bad_inv
  FROM invoices WHERE quote_id = p_quote_id AND status <> 'draft';
  IF v_bad_inv > 0 THEN
    RAISE EXCEPTION 'Can''t delete % — it has an invoice that is no longer a draft. Cancel the invoice first if this is really wrong.', v_quote.quote_number;
  END IF;

  -- Guard 2: a driver actually drove this.
  SELECT count(*) INTO v_bad_trip
  FROM trips WHERE quote_id = p_quote_id AND status = 'completed';
  IF v_bad_trip > 0 THEN
    RAISE EXCEPTION 'Can''t delete % — it has a completed trip. Completed trips are kept as a record of work done.', v_quote.quote_number;
  END IF;

  -- Snapshot everything before it goes, so this is recoverable by hand.
  v_snapshot := jsonb_build_object(
    'quote',    to_jsonb(v_quote),
    'version',  to_jsonb(v_ver),
    'trips',    COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM trips t WHERE t.quote_id = p_quote_id), '[]'::jsonb),
    'invoices', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM invoices i WHERE i.quote_id = p_quote_id), '[]'::jsonb),
    'versions', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM quote_versions v WHERE v.quote_id = p_quote_id), '[]'::jsonb)
  );

  SELECT count(*) INTO v_trips    FROM trips    WHERE quote_id = p_quote_id;
  SELECT count(*) INTO v_invoices FROM invoices WHERE quote_id = p_quote_id;

  INSERT INTO deleted_quote_log (
    quote_number, school_name, quote_status, total,
    trips_deleted, invoices_deleted, snapshot, deleted_by
  ) VALUES (
    v_quote.quote_number, v_school, v_quote.status::text, v_ver.total,
    v_trips, v_invoices, v_snapshot, auth.uid()
  );

  -- Order matters: the NO ACTION children must go before the parent.
  DELETE FROM trips    WHERE quote_id = p_quote_id;
  DELETE FROM invoices WHERE quote_id = p_quote_id;
  -- quote_versions / shuttle_runs / multi_stops cascade from here;
  -- notification_log rows survive with quote_id set to NULL.
  DELETE FROM quotes   WHERE id = p_quote_id;

  RETURN jsonb_build_object(
    'deleted',          true,
    'quote_number',     v_quote.quote_number,
    'trips_deleted',    v_trips,
    'invoices_deleted', v_invoices
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_quote(uuid) TO authenticated;

-- Data change applied alongside this migration (environment-specific, not
-- re-run automatically): milagudz07@gmail.com was promoted from customer to
-- admin so the owner stops borrowing the admin@test.com login.
--   UPDATE profiles SET role = 'admin' WHERE email = 'milagudz07@gmail.com';
