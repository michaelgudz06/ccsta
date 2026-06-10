-- Migration 018: notification log table + stub RPCs for email and SMS.
-- Email (SMTP) and SMS credentials are not yet available; functions are wired
-- and will send once keys are added to env. All attempts are logged here for
-- audit and retry.

CREATE TABLE IF NOT EXISTS public.notification_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL CHECK (type IN ('email', 'sms')),
  recipient    text NOT NULL,           -- email address or phone number
  subject      text,                    -- email only
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'sent', 'failed')),
  error        text,                    -- last error message if failed
  quote_id     uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  trip_id      uuid REFERENCES public.trips(id)  ON DELETE SET NULL,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all; customers cannot read notification logs.
CREATE POLICY "notif_admin_all"
  ON public.notification_log FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));

-- notify_customer: queue a notification to a school contact.
-- Called after approve_quote, reject_quote, confirm_trip.
-- The Edge Function (notify-send) polls pending rows and actually sends.
CREATE OR REPLACE FUNCTION public.notify_customer(
  p_type      text,            -- 'email' | 'sms'
  p_recipient text,
  p_subject   text DEFAULT NULL,
  p_body      text DEFAULT '',
  p_quote_id  uuid DEFAULT NULL,
  p_trip_id   uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO notification_log (type, recipient, subject, body, quote_id, trip_id)
  VALUES (p_type, p_recipient, p_subject, p_body, p_quote_id, p_trip_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_customer(text, text, text, text, uuid, uuid) TO authenticated;

-- notify_driver: queue an SMS to a driver when a trip is assigned.
CREATE OR REPLACE FUNCTION public.notify_driver(
  p_driver_id uuid,
  p_trip_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver  drivers%ROWTYPE;
  v_trip    trips%ROWTYPE;
  v_body    text;
  v_id      uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_driver FROM drivers WHERE id = p_driver_id;
  SELECT * INTO v_trip   FROM trips   WHERE id = p_trip_id;

  IF v_driver.phone IS NULL THEN
    RAISE EXCEPTION 'driver has no phone number';
  END IF;

  v_body := format(
    'CCSTA Trip Alert — %s: pick up from %s, depart %s. Trip #%s. Reply STOP to opt out.',
    v_trip.trip_date::text,
    COALESCE(v_trip.destination_name, 'TBD'),
    to_char(v_trip.departure_time, 'HH:MI AM'),
    v_trip.trip_number
  );

  INSERT INTO notification_log (type, recipient, body, trip_id)
  VALUES ('sms', v_driver.phone, v_body, p_trip_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_driver(uuid, uuid) TO authenticated;
