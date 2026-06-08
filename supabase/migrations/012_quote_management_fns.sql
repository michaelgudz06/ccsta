-- approve_quote: admin approves a quote, creates a draft invoice
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

  RETURN jsonb_build_object(
    'quote_id',       p_quote_id,
    'status',         'approved',
    'invoice_number', v_inv_number,
    'invoice_id',     v_invoice_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION approve_quote(uuid, text) TO authenticated;

-- reject_quote: admin cancels/rejects a quote, optionally storing a reason
CREATE OR REPLACE FUNCTION reject_quote(
  p_quote_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

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

  RETURN jsonb_build_object('quote_id', p_quote_id, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION reject_quote(uuid, text) TO authenticated;
