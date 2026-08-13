-- Migration 077: link a trip to the Samsara route that carries its trip sheet.
--
-- APPLIED 2026-08-12.
--
-- Drivers already open Samsara every day. Pushing the trip sheet there means
-- they learn nothing new -- the whole point, given Mila's concern that older
-- drivers won't adopt a second app.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS samsara_route_id text,
  ADD COLUMN IF NOT EXISTS samsara_pushed_at timestamptz,
  -- Records the last failure so a trip that never reached the driver is
  -- visible, rather than looking identical to one that did.
  ADD COLUMN IF NOT EXISTS samsara_error text;

COMMENT ON COLUMN public.trips.samsara_route_id IS
  'Samsara route carrying this trip sheet. NULL means never pushed.';
COMMENT ON COLUMN public.trips.samsara_error IS
  'Last Samsara push failure. Non-null means the driver may NOT have the trip in their app -- treat as needing a phone call.';

CREATE INDEX IF NOT EXISTS trips_samsara_unpushed
  ON public.trips (trip_date)
  WHERE samsara_route_id IS NULL AND status <> 'cancelled';
