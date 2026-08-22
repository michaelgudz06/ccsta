-- Migration 079: addresses -> coordinates, cached.
--
-- APPLIED 2026-08-22.
--
-- Samsara's route API rejected the first real push with:
--   "latitude" is missing from body; "longitude" is missing from body
--
-- singleUseLocation needs COORDINATES, not the free-text address we hold. So
-- every stop must be geocoded before a trip can reach a driver's app.
--
-- Cached for the same reason travel_time_cache exists: the same dozen schools
-- and destinations repeat constantly, and geocoding the same address on every
-- push would be slow and rude to a free provider.

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  address_key text PRIMARY KEY,          -- lower-cased, whitespace-collapsed
  address_raw text NOT NULL,
  lat         numeric(9,6),
  lng         numeric(9,6),
  -- NULL lat/lng with resolved=false is a REMEMBERED FAILURE: an address the
  -- provider couldn't place. Stored so we don't retry a hopeless lookup on
  -- every push, and so a human can see which addresses need fixing.
  resolved    boolean NOT NULL DEFAULT true,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

-- No policies: service-role only, written and read by edge functions. Derived
-- data with no user-facing purpose.
COMMENT ON TABLE public.geocode_cache IS
  'Address -> lat/lng, for Samsara route stops which require coordinates. Safe to TRUNCATE; refills on demand. resolved=false marks an address geocoding could not place.';
