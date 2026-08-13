-- Migration 078: buses.samsara_vehicle_id held GATEWAY SERIALS, not vehicle IDs.
--
-- APPLIED 2026-08-12. Found by probing the live Samsara API BEFORE the first
-- route push, which is the only reason it wasn't discovered as a mystery
-- failure later.
--
-- Measured against 34 real Samsara vehicles:
--
--   our values matching Samsara vehicle IDs .......  0 of 28
--   our values matching gateway serials ........... 27
--   matching on vehicle name ...................... 25
--
-- Samsara's vehicleId is numeric (281474988980545); a gateway serial looks like
-- GV6C-E9T-U3W. The route API assigns by vehicleId, so EVERY push would have
-- failed, and the natural conclusion would have been "the Samsara integration
-- doesn't work" rather than "the column holds the wrong identifier".
--
-- The serial is still useful -- it's what's printed on the device -- so it moves
-- to its own column rather than being discarded.

ALTER TABLE public.buses
  ADD COLUMN IF NOT EXISTS samsara_gateway_serial text;

UPDATE public.buses
SET samsara_gateway_serial = samsara_vehicle_id
WHERE samsara_gateway_serial IS NULL AND samsara_vehicle_id IS NOT NULL;

COMMENT ON COLUMN public.buses.samsara_vehicle_id IS
  'Samsara VEHICLE id — numeric, e.g. 281474988980545. Used to assign routes. NOT the gateway serial; see samsara_gateway_serial.';
COMMENT ON COLUMN public.buses.samsara_gateway_serial IS
  'Serial printed on the Samsara gateway device, e.g. GV6C-E9T-U3W. Was previously stored in samsara_vehicle_id by mistake.';

-- The backfill itself was run as a one-off against a live Samsara vehicle list
-- (via the samsara-vehicle-map function), matching on gateway serial first and
-- falling back to vehicle name. Result: 28 of 28 active buses now hold numeric
-- vehicle IDs, 0 wrong, 0 unmapped. Names agree throughout, with "Bus 50" ↔
-- "Bus 50 (New)" matched on serial -- clearly the same vehicle.
--
-- Not reproduced as SQL here because it depends on live API output. Re-run
-- samsara-vehicle-map if the fleet changes and buses need re-mapping.
