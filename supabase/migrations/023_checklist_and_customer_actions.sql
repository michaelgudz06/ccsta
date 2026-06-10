-- Migration 023: persistence for the driver pre-trip checklist, and customer
-- actions on their own quotes (cancel / accept) so portal rows are interactive.

-- Driver pre-trip checklist saved per trip ({ "item label": true, ... }).
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS pretrip_checklist jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Customer cancels their OWN quote (before it becomes a scheduled trip).
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
  IF v_quote.status IN ('completed', 'invoiced', 'cancelled', 'scheduled') THEN
    RAISE EXCEPTION 'This trip can no longer be cancelled online — please call us.';
  END IF;

  UPDATE quotes SET status = 'cancelled', updated_at = now() WHERE id = p_quote_id;
  RETURN jsonb_build_object('quote_id', p_quote_id, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_own_quote(uuid) TO authenticated;

-- Customer accepts an approved quote (approved → confirmed), signalling they
-- want to proceed so Melody/Alan can schedule a driver + bus.
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
  RETURN jsonb_build_object('quote_id', p_quote_id, 'status', 'confirmed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_own_quote(uuid) TO authenticated;
