-- Migration 025: customer cancellation requests + email notifications.
--
-- Workflow change:
--   • requested / in_review            → customer cancels directly (cancel_own_quote)
--   • approved / confirmed / scheduled → quote was already accepted/priced by the
--     office, so the customer submits a cancellation REQUEST instead
--     (request_quote_cancellation); Melody approves or declines it from the
--     admin dashboard (resolve_cancellation_request).
--
-- Email notifications are queued into notification_log (migration 018) by the
-- workflow functions below and delivered by the notify-send Edge Function
-- (Resend). Until RESEND_API_KEY is set as a function secret, rows simply stay
-- 'pending' — nothing breaks.

-- ── 1. Text app settings (surcharge_config is numeric-only) ──────────────────
CREATE TABLE IF NOT EXISTS public.app_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config_admin_all" ON public.app_config;
CREATE POLICY "app_config_admin_all"
  ON public.app_config FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));

INSERT INTO public.app_config (key, value, description) VALUES
  ('notify_admin_email', 'info@ccsta.ca', 'Inbox for new-quote / acceptance / cancellation alerts'),
  ('site_url', 'https://ccsta-test.lovable.app', 'Base URL used for links inside notification emails')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Cancellation request columns on quotes ─────────────────────────────────
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason       text;

-- ── 3. Internal helpers (not callable from the client) ────────────────────────
CREATE OR REPLACE FUNCTION public._queue_email(
  p_recipient text,
  p_subject   text,
  p_body      text,
  p_quote_id  uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_recipient IS NULL OR btrim(p_recipient) = '' THEN RETURN; END IF;
  INSERT INTO notification_log (type, recipient, subject, body, quote_id)
  VALUES ('email', btrim(p_recipient), p_subject, p_body, p_quote_id);
EXCEPTION WHEN OTHERS THEN
  NULL; -- a notification problem must never block the booking action itself
END;
$$;

REVOKE EXECUTE ON FUNCTION public._queue_email(text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._admin_email()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM app_config WHERE key = 'notify_admin_email'),
    'info@ccsta.ca'
  );
$$;

REVOKE EXECUTE ON FUNCTION public._admin_email() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._site_url()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM app_config WHERE key = 'site_url'),
    'https://ccsta-test.lovable.app'
  );
$$;

REVOKE EXECUTE ON FUNCTION public._site_url() FROM PUBLIC, anon, authenticated;

-- Best email address for the customer on a quote: the primary contact from the
-- current version, falling back to their login email.
CREATE OR REPLACE FUNCTION public._customer_email(p_quote_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(btrim(v.contact_primary->>'email'), ''),
    u.email
  )
  FROM quotes q
  LEFT JOIN quote_versions v ON v.id = q.current_version_id
  LEFT JOIN auth.users u ON u.id = q.customer_id
  WHERE q.id = p_quote_id;
$$;

REVOKE EXECUTE ON FUNCTION public._customer_email(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. cancel_own_quote: direct cancel only BEFORE the office accepts it ──────
CREATE OR REPLACE FUNCTION public.cancel_own_quote(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote quotes%ROWTYPE;
BEGIN
  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;
  IF v_quote.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only cancel your own quotes.';
  END IF;
  IF v_quote.status IN ('approved', 'confirmed', 'scheduled') THEN
    RAISE EXCEPTION 'This quote has already been accepted by our office — please submit a cancellation request instead.';
  END IF;
  IF v_quote.status NOT IN ('requested', 'in_review') THEN
    RAISE EXCEPTION 'This quote can no longer be cancelled online — please call us.';
  END IF;

  UPDATE quotes SET status = 'cancelled', updated_at = now() WHERE id = p_quote_id;

  PERFORM _queue_email(
    _admin_email(),
    'Quote ' || v_quote.quote_number || ' cancelled by customer',
    'The customer cancelled quote ' || v_quote.quote_number || ' before review was finished.'
      || E'\n\nView it in the dispatch dashboard: ' || _site_url() || '/admin',
    p_quote_id
  );

  RETURN jsonb_build_object('quote_id', p_quote_id, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_own_quote(uuid) TO authenticated;

-- ── 5. request_quote_cancellation: for quotes already accepted by the office ──
CREATE OR REPLACE FUNCTION public.request_quote_cancellation(
  p_quote_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote quotes%ROWTYPE;
BEGIN
  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;
  IF v_quote.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only request cancellation of your own quotes.';
  END IF;
  IF v_quote.status IN ('requested', 'in_review') THEN
    RAISE EXCEPTION 'This quote has not been accepted yet — you can cancel it directly.';
  END IF;
  IF v_quote.status NOT IN ('approved', 'confirmed', 'scheduled') THEN
    RAISE EXCEPTION 'This quote can no longer be cancelled online — please call us.';
  END IF;
  IF v_quote.cancellation_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'A cancellation request is already pending for this quote.';
  END IF;

  UPDATE quotes
  SET cancellation_requested_at = now(),
      cancellation_reason       = NULLIF(btrim(p_reason), ''),
      updated_at                = now()
  WHERE id = p_quote_id;

  PERFORM _queue_email(
    _admin_email(),
    'Cancellation request — quote ' || v_quote.quote_number,
    'The customer asked to cancel quote ' || v_quote.quote_number
      || ' (current status: ' || v_quote.status || ').'
      || COALESCE(E'\n\nTheir reason: ' || NULLIF(btrim(p_reason), ''), '')
      || E'\n\nApprove or decline it in the dispatch dashboard: ' || _site_url() || '/admin',
    p_quote_id
  );

  RETURN jsonb_build_object('quote_id', p_quote_id, 'cancellation_requested', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_quote_cancellation(uuid, text) TO authenticated;

-- ── 6. resolve_cancellation_request: admin approves or declines ───────────────
CREATE OR REPLACE FUNCTION public.resolve_cancellation_request(
  p_quote_id uuid,
  p_approve  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote quotes%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;
  IF v_quote.cancellation_requested_at IS NULL THEN
    RAISE EXCEPTION 'No pending cancellation request on this quote.';
  END IF;

  IF p_approve THEN
    UPDATE quotes SET status = 'cancelled', updated_at = now() WHERE id = p_quote_id;
    -- Cancel any booked trips that came from this quote.
    UPDATE trips SET status = 'cancelled', updated_at = now()
    WHERE quote_id = p_quote_id AND status NOT IN ('completed', 'cancelled');

    PERFORM _queue_email(
      _customer_email(p_quote_id),
      'Your CCSTA trip ' || v_quote.quote_number || ' has been cancelled',
      'Hi,' || E'\n\nAs requested, we''ve cancelled your booking ' || v_quote.quote_number || '.'
        || E'\nIf this was a mistake or you''d like to rebook, just submit a new quote request or give us a call.'
        || E'\n\n— CCSTA',
      p_quote_id
    );
  ELSE
    UPDATE quotes
    SET cancellation_requested_at = NULL,
        updated_at                = now()
    WHERE id = p_quote_id;

    -- Keep the request on record in the version's internal notes.
    UPDATE quote_versions v
    SET internal_notes = COALESCE(internal_notes || E'\n', '')
        || 'Cancellation request declined ' || to_char(now(), 'YYYY-MM-DD')
        || COALESCE(' (customer reason: ' || v_quote.cancellation_reason || ')', '')
    FROM quotes q
    WHERE q.id = p_quote_id AND v.id = q.current_version_id;

    PERFORM _queue_email(
      _customer_email(p_quote_id),
      'About your cancellation request — ' || v_quote.quote_number,
      'Hi,' || E'\n\nWe weren''t able to cancel booking ' || v_quote.quote_number || ' online.'
        || E'\nPlease call the office and we''ll sort it out together.'
        || E'\n\n— CCSTA',
      p_quote_id
    );
  END IF;

  RETURN jsonb_build_object(
    'quote_id', p_quote_id,
    'approved', p_approve,
    'status',   CASE WHEN p_approve THEN 'cancelled' ELSE v_quote.status END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_cancellation_request(uuid, boolean) TO authenticated;

-- ── 7. submit_quote: queue "received" emails to customer + office ─────────────
CREATE OR REPLACE FUNCTION submit_quote(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_quote_no  text;
  v_quote_id  uuid;
  v_ver_id    uuid;
  v_school_id uuid;
  v_cust_email text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Find existing school by name (case-insensitive) or create a new one
  SELECT id INTO v_school_id
  FROM public.schools
  WHERE lower(trim(name)) = lower(trim(p_data->>'school_name'))
  LIMIT 1;

  IF v_school_id IS NULL THEN
    INSERT INTO public.schools (name, address)
    VALUES (trim(p_data->>'school_name'), p_data->>'pickup_address')
    RETURNING id INTO v_school_id;
  END IF;

  -- Generate sequential quote number: Q-YYYY-NNNN
  v_quote_no := 'Q-' || extract(year FROM now())::text || '-' ||
                lpad(nextval('public.quote_number_seq')::text, 4, '0');

  -- Insert quote (without current_version_id first to avoid circular FK issue)
  INSERT INTO public.quotes (quote_number, school_id, customer_id, status)
  VALUES (v_quote_no, v_school_id, v_user_id, 'requested')
  RETURNING id INTO v_quote_id;

  -- Insert first version with all form data
  INSERT INTO public.quote_versions (
    quote_id, version_number,
    destination_name, destination_address,
    trip_date, departure_time, return_time,
    student_count, adults_count, grade_breakdown,
    cargo_needed, pickup_address,
    contact_primary, contact_secondary, contact_day_of,
    special_requests, created_by
  ) VALUES (
    v_quote_id, 1,
    p_data->>'destination_name',
    p_data->>'destination_address',
    NULLIF(p_data->>'trip_date', '')::date,
    NULLIF(p_data->>'departure_time', '')::time,
    NULLIF(p_data->>'return_time', '')::time,
    NULLIF(p_data->>'student_count', '')::smallint,
    NULLIF(p_data->>'adults_count', '')::smallint,
    p_data->'grade_breakdown',
    COALESCE((p_data->>'cargo_needed')::boolean, false),
    p_data->>'pickup_address',
    p_data->'contact_primary',
    p_data->'contact_secondary',
    p_data->'contact_day_of',
    p_data->>'special_requests',
    v_user_id
  )
  RETURNING id INTO v_ver_id;

  -- Link version back to quote
  UPDATE public.quotes
  SET current_version_id = v_ver_id
  WHERE id = v_quote_id;

  -- Queue notification emails (delivered by the notify-send Edge Function).
  v_cust_email := COALESCE(
    NULLIF(btrim(p_data->'contact_primary'->>'email'), ''),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  );

  PERFORM _queue_email(
    v_cust_email,
    'We received your quote request ' || v_quote_no,
    'Hi,' || E'\n\nThanks for your field trip request!'
      || E'\n\n  Quote number: ' || v_quote_no
      || E'\n  Destination:  ' || COALESCE(p_data->>'destination_name', 'TBD')
      || E'\n  Trip date:    ' || COALESCE(p_data->>'trip_date', 'TBD')
      || E'\n\nMelody will review it and you''ll get another email as soon as your price is ready.'
      || E'\nYou can check the status any time: ' || _site_url() || '/portal'
      || E'\n\n— CCSTA',
    v_quote_id
  );

  PERFORM _queue_email(
    _admin_email(),
    'New quote request ' || v_quote_no || ' — ' || COALESCE(trim(p_data->>'school_name'), 'Unknown school'),
    'A new field trip quote was just submitted.'
      || E'\n\n  Quote:       ' || v_quote_no
      || E'\n  School:      ' || COALESCE(trim(p_data->>'school_name'), '—')
      || E'\n  Destination: ' || COALESCE(p_data->>'destination_name', '—')
      || E'\n  Trip date:   ' || COALESCE(p_data->>'trip_date', '—')
      || E'\n  Riders:      ' || COALESCE(p_data->>'student_count', '0') || ' students + '
      || COALESCE(p_data->>'adults_count', '0') || ' adults'
      || E'\n\nReview it in the dispatch dashboard: ' || _site_url() || '/admin',
    v_quote_id
  );

  RETURN jsonb_build_object(
    'quote_number', v_quote_no,
    'quote_id',     v_quote_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_quote(jsonb) TO authenticated;

-- ── 8. approve_quote: email the customer their price ──────────────────────────
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

  -- Default invoice number mirrors quote number
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
$$;

GRANT EXECUTE ON FUNCTION approve_quote(uuid, text) TO authenticated;

-- ── 9. reject_quote: tell the customer ────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_quote(
  p_quote_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote quotes%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;

  UPDATE quotes
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_quote_id
    AND status NOT IN ('completed', 'invoiced', 'cancelled');

  IF p_reason IS NOT NULL THEN
    UPDATE quote_versions v
    SET internal_notes = COALESCE(internal_notes || E'\n', '') || 'Rejected: ' || p_reason
    FROM quotes q
    WHERE q.id = p_quote_id AND v.id = q.current_version_id;
  END IF;

  PERFORM _queue_email(
    _customer_email(p_quote_id),
    'Update on your quote request ' || v_quote.quote_number,
    'Hi,' || E'\n\nUnfortunately we weren''t able to fulfil quote request ' || v_quote.quote_number || '.'
      || E'\nPlease give us a call if you''d like to discuss alternatives — we''re happy to help.'
      || E'\n\n— CCSTA',
    p_quote_id
  );

  RETURN jsonb_build_object('quote_id', p_quote_id, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION reject_quote(uuid, text) TO authenticated;

-- ── 10. confirm_own_quote: tell the office the customer accepted ──────────────
CREATE OR REPLACE FUNCTION public.confirm_own_quote(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote quotes%ROWTYPE;
BEGIN
  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote not found'; END IF;
  IF v_quote.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only accept your own quotes.';
  END IF;
  IF v_quote.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved quote can be accepted (current: %).', v_quote.status;
  END IF;

  UPDATE quotes SET status = 'confirmed', updated_at = now() WHERE id = p_quote_id;

  PERFORM _queue_email(
    _admin_email(),
    'Quote ' || v_quote.quote_number || ' accepted by customer',
    'The customer accepted the price on quote ' || v_quote.quote_number || '.'
      || E'\nIt''s ready for a bus + driver assignment.'
      || E'\n\nSchedule it in the dispatch dashboard: ' || _site_url() || '/admin',
    p_quote_id
  );

  RETURN jsonb_build_object('quote_id', p_quote_id, 'status', 'confirmed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_own_quote(uuid) TO authenticated;
