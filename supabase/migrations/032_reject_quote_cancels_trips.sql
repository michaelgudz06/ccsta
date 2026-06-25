-- Migration 032: when an admin rejects/cancels a quote, also cancel any trip
-- already booked from it (otherwise the bus/driver stays "booked" on a dead
-- trip). Also make the customer email match the situation.

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

  -- Release any booked trip(s) so the bus/driver free up.
  UPDATE trips SET status = 'cancelled', updated_at = now()
  WHERE quote_id = p_quote_id AND status NOT IN ('completed', 'cancelled');

  IF p_reason IS NOT NULL THEN
    UPDATE quote_versions v
    SET internal_notes = COALESCE(internal_notes || E'\n', '') || 'Rejected: ' || p_reason
    FROM quotes q
    WHERE q.id = p_quote_id AND v.id = q.current_version_id;
  END IF;

  -- Status-aware customer email (was it just a quote, or an active booking?).
  IF v_quote.status IN ('confirmed', 'scheduled') THEN
    PERFORM _queue_email(
      _customer_email(p_quote_id),
      'Your CCSTA booking ' || v_quote.quote_number || ' has been cancelled',
      'Hi,' || E'\n\nYour booking ' || v_quote.quote_number || ' has been cancelled by our office.'
        || E'\nIf this is unexpected, please give us a call and we''ll help sort it out.'
        || E'\n\n— CCSTA',
      p_quote_id
    );
  ELSE
    PERFORM _queue_email(
      _customer_email(p_quote_id),
      'Update on your quote request ' || v_quote.quote_number,
      'Hi,' || E'\n\nUnfortunately we weren''t able to fulfil quote request ' || v_quote.quote_number || '.'
        || E'\nPlease give us a call if you''d like to discuss alternatives — we''re happy to help.'
        || E'\n\n— CCSTA',
      p_quote_id
    );
  END IF;

  RETURN jsonb_build_object('quote_id', p_quote_id, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION reject_quote(uuid, text) TO authenticated;
