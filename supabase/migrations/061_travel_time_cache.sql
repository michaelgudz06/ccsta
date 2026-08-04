-- Migration 061: the cache that sits under the Google travel-time lookup.
--
-- Additive only: one new table plus two nullable columns. Nothing reads them
-- yet, so this is safe to apply ahead of the pricing switch-over (062).
--
-- ── Why a cache at all ──────────────────────────────────────────────────
-- Two reasons, and the second is the important one.
--
-- 1. Money. Routes API is $5 per 1,000 requests past a 10,000/month free
--    allowance. CCSTA's real volume is a few quotes a day, which is nowhere
--    near the ceiling — but only if a "quote" means a couple of requests and
--    not a couple of hundred.
--
-- 2. We have already been bitten by exactly that. The Nominatim geocode used
--    to fire on every keystroke of the address field, which is why distance
--    silently never saved: each request cancelled the one before it. That bug
--    was free because Nominatim is free. The same bug against a metered API
--    is an invoice. The cache plus a debounce on the client is the guard.
--
-- The yard->school pairs repeat constantly — the same dozen schools, from the
-- same three yards — so the hit rate should be very high after the first week.

CREATE TABLE IF NOT EXISTS public.travel_time_cache (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Normalised endpoints. Lower-cased, whitespace-collapsed address text, or
  -- 'yard:<uuid>' for a yard. Normalisation happens in the edge function so
  -- that "16099 Fraser Hwy" and "16099 fraser hwy " share a row.
  origin_key    text NOT NULL,
  dest_key      text NOT NULL,

  -- Traffic depends on WHEN, so the cache key has to include it. Bucketed by
  -- day-of-week and hour rather than exact timestamp: a 7:00 and a 7:20
  -- departure on the same Tuesday have materially the same traffic, and
  -- caching them separately would mean almost never hitting the cache.
  dow           smallint NOT NULL CHECK (dow BETWEEN 0 AND 6),
  hour          smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),

  minutes       numeric NOT NULL,
  distance_km   numeric,

  -- Traffic patterns shift slowly (construction, new schools, route changes),
  -- so rows go stale rather than wrong. The function refreshes anything older
  -- than 90 days on next use.
  fetched_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (origin_key, dest_key, dow, hour)
);

ALTER TABLE public.travel_time_cache ENABLE ROW LEVEL SECURITY;

-- Read is public for the same reason yards are (migration 060): the customer's
-- own estimate depends on these numbers, and "how long does it take to drive
-- from A to B" is not sensitive. Writes are service-role only — the edge
-- function is the sole writer, so a client cannot poison the cache and talk
-- itself into a cheaper quote.
DROP POLICY IF EXISTS "travel_time_cache_public_read" ON public.travel_time_cache;
CREATE POLICY "travel_time_cache_public_read" ON public.travel_time_cache
  FOR SELECT USING (true);

COMMENT ON TABLE public.travel_time_cache IS
  'Google Routes API results, keyed by endpoint pair and departure bucket. Written only by the travel-time edge function. Safe to TRUNCATE — it refills on demand, at the cost of some API calls.';

-- ── Resolved driver-time inputs, stored per quote version ───────────────
-- Deliberately stored rather than looked up at estimate time.
--
-- calculate_estimate is a SQL function and cannot call an HTTP API
-- synchronously. It could go through pg_net, but that's asynchronous, which
-- means the estimate would sometimes price before the answer arrived.
--
-- Storing the resolved minutes on the version is also just more correct: a
-- quote is a promise. If Google's traffic model shifts next month, the number
-- the customer was quoted should not move underneath them. These columns
-- freeze the inputs at quote time, which is the behaviour we actually want.
ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS leg_out_minutes  numeric,
  ADD COLUMN IF NOT EXISTS leg_back_minutes numeric;

COMMENT ON COLUMN public.quote_versions.leg_out_minutes IS
  'Yard -> pickup travel minutes, resolved at quote time. NULL means the lookup was unavailable; calculate_estimate falls back to the flat driver_time_buffer_hours.';
COMMENT ON COLUMN public.quote_versions.leg_back_minutes IS
  'Drop-off -> yard travel minutes, resolved at quote time. NULL behaves as above.';
