-- Migration 060: yards, and the pure rules half of the driver-time rebuild.
--
-- ⚠ NOT APPLIED YET. Deliberately. This migration changes nothing on its own
-- (it only adds a table, a column and two functions nothing calls), but it is
-- the foundation of a change to what customers are charged, and at the time
-- of writing ccsta.net is down due to a Lovable hosting outage, so none of it
-- can be verified end to end. Apply it when the site is back and the Google
-- lookup (migration 061) is ready to go in behind it.
--
-- ── What driver time is becoming ────────────────────────────────────────
-- Today it's a flat `driver_time_buffer_hours` (1 hr) for every trip, so a
-- school 3 minutes from the yard and one 50 minutes away bill identically.
--
-- The agreed replacement (Mila, 2026-08-04):
--
--     leg_out  = travel(yard -> pickup)      traffic-aware; 0 if under 5 min
--   + leg_back = travel(drop-off -> yard)    traffic-aware; 0 if under 5 min
--   + 15 min pre-trip                        once per BUS per day
--   = round the TOTAL up to the next quarter hour
--
-- This migration provides everything EXCEPT the travel lookup itself, which
-- needs the Google Routes API and a server-side key (see migration 061).
--
-- ── Why a separate yards table ──────────────────────────────────────────
-- Three yards: Surrey (default), Langley, Abbotsford. Buses move between
-- them, so the yard CANNOT be derived from the assigned bus. Every quote
-- defaults to Surrey and Melody picks a different one per trip when needed.
--
-- Rejected alternative: "nearest yard to the pickup". It's a guess that goes
-- wrong exactly when it matters — if the nearest yard has no bus free and one
-- comes from Abbotsford instead, the customer is billed for travel that never
-- happened, or CCSTA absorbs travel it did.

CREATE TABLE IF NOT EXISTS public.yards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  address    text NOT NULL,
  -- Cached geocode, so the travel lookup doesn't re-geocode the yard every
  -- time. Populated by migration 061 or by hand.
  lat        numeric(9,6),
  lng        numeric(9,6),
  is_default boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Exactly one default, enforced by the database rather than by convention.
CREATE UNIQUE INDEX IF NOT EXISTS yards_single_default
  ON public.yards ((is_default)) WHERE is_default;

ALTER TABLE public.yards ENABLE ROW LEVEL SECURITY;

-- Public read: the customer's estimate needs the yard to compute driver time,
-- and a depot address is not sensitive (it's on the side of the buses). Same
-- reasoning as rate_config/surcharge_config in migration 050. Writes stay
-- admin-only.
DROP POLICY IF EXISTS "yards_public_read" ON public.yards;
CREATE POLICY "yards_public_read" ON public.yards FOR SELECT USING (true);

DROP POLICY IF EXISTS "yards_admin_write" ON public.yards;
CREATE POLICY "yards_admin_write" ON public.yards FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- Surrey verified 2026-08-04 by geocoding: yard -> Frost Road Elementary is
-- 1.0 km / 2.7 min, matching Mila's stated "two to three minutes". The lat/lng
-- below come from that same lookup.
INSERT INTO public.yards (name, address, lat, lng, is_default)
VALUES ('Surrey', '16099 Fraser Hwy, Surrey, BC', 49.156510, -122.775621, true)
ON CONFLICT (name) DO NOTHING;

-- Langley, supplied 2026-08-04 and verified by geocoding: resolves precisely
-- to a commercial building at 4053 208 St, Brookswood.
INSERT INTO public.yards (name, address, lat, lng, is_default)
VALUES ('Langley', '4053 208 Street, Township of Langley, BC V3A 2H3', 49.076035, -122.647987, false)
ON CONFLICT (name) DO NOTHING;

-- Abbotsford. NOTE THE PROVENANCE — this one is an APPROXIMATION, unlike the
-- other two.
--
-- The address given was "Fraser Highway, Abbotsford, BC V4X 1G8" with no
-- street number, which geocodes to three stretches of Fraser Highway ~1.5 km
-- apart. Mila supplied a map screenshot instead and said the exact address
-- doesn't matter: the yard is the block on the north side of Fraser Hwy just
-- west of Ross Rd, by Cummings Trailer Sales and Fraser Seeds.
--
-- The coordinates below are the Fraser Hwy / Ross Rd intersection, derived by
-- geocoding both roads separately and taking where they meet. That should be
-- within roughly 200 m of the actual gate — immaterial at a 15-minute
-- rounding step, where 200 m is a few seconds. Sanity check: this point is
-- 41.5 km / 39 min from the Surrey yard, which is a plausible
-- Abbotsford-to-Fleetwood run.
--
-- Refine it if driver time for Abbotsford trips ever looks off, and prefer a
-- dropped pin over a street address if one is ever needed.
INSERT INTO public.yards (name, address, lat, lng, is_default)
VALUES ('Abbotsford', 'Fraser Hwy near Ross Rd, Abbotsford, BC V4X 1G8', 49.057584, -122.403942, false)
ON CONFLICT (name) DO NOTHING;

-- ── Which yard a given quote leaves from ────────────────────────────────
ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS yard_id uuid REFERENCES public.yards(id);

COMMENT ON COLUMN public.quote_versions.yard_id IS
  'Yard this trip departs from. NULL means the default (Surrey). Melody can change it per trip; buses have no fixed home yard so it cannot be inferred from the assignment.';

-- ── The rules, as pure functions ────────────────────────────────────────
-- Kept separate from the Google lookup on purpose: these are deterministic
-- and testable without a network call, so the arithmetic can be verified
-- independently of whether the travel API is reachable.

/**
 * One leg's billable minutes. Anything under the short-hop threshold counts
 * as zero — some schools are minutes from the yard (Frost Road is 2.7) and
 * charging travel time for those isn't honest.
 */
CREATE OR REPLACE FUNCTION public._driver_leg_minutes(p_minutes numeric)
RETURNS numeric
LANGUAGE sql
-- STABLE, not IMMUTABLE: this reads surcharge_config. Marking a
-- table-reading function IMMUTABLE lets Postgres constant-fold it, so a
-- changed threshold might silently not take effect.
STABLE
AS $$
  SELECT CASE
    WHEN p_minutes IS NULL THEN 0
    WHEN p_minutes < (SELECT COALESCE(value, 5) FROM public.surcharge_config WHERE key = 'driver_time_short_hop_minutes')
      THEN 0
    ELSE p_minutes
  END;
$$;

/**
 * Total billable driver time, in HOURS, ready to drop into the existing
 * v_driver_hours slot in calculate_estimate.
 *
 * Rounding is applied to the TOTAL, not per leg — confirmed with Mila. Per-leg
 * rounding would turn 22 + 19 + 15 (56 min) into 1h15 instead of 1h00, which
 * is a materially different bill.
 */
CREATE OR REPLACE FUNCTION public.driver_time_hours(
  p_leg_out_minutes  numeric,   -- yard -> pickup
  p_leg_back_minutes numeric,   -- drop-off -> yard
  p_include_pretrip  boolean    -- first outing for this bus today?
)
RETURNS numeric
LANGUAGE sql
STABLE          -- reads surcharge_config; see note on _driver_leg_minutes
AS $$
  WITH parts AS (
    SELECT
      public._driver_leg_minutes(p_leg_out_minutes)
      + public._driver_leg_minutes(p_leg_back_minutes)
      -- Reuses the EXISTING driver_pretip_min key (15, "Minimum pre-trip
      -- time added to driver hours") rather than inventing a second one.
      -- It was configured long ago and never used by calculate_estimate.
      -- Note the typo in the key name is pre-existing; not renaming it here
      -- because that's a separate change with its own blast radius.
      + CASE WHEN p_include_pretrip
             THEN (SELECT COALESCE(value, 15) FROM public.surcharge_config WHERE key = 'driver_pretip_min')
             ELSE 0 END AS total_minutes,
      (SELECT COALESCE(value, 15) FROM public.surcharge_config WHERE key = 'driver_time_rounding_minutes') AS step
  )
  -- Round UP to the next step. A total of exactly zero stays zero: a 3-minute
  -- hop with no pre-trip should cost nothing, not a quarter hour.
  SELECT CASE
    WHEN total_minutes <= 0 THEN 0
    ELSE (ceil(total_minutes / step) * step) / 60.0
  END
  FROM parts;
$$;

-- Thresholds live in surcharge_config alongside every other pricing number,
-- so they can be changed without a migration — the same reasoning that made
-- rates configurable in migration 050. `unit` is NOT NULL on that table.
--
-- Only TWO new keys: the pre-trip duration already exists as
-- `driver_pretip_min`.
INSERT INTO public.surcharge_config (key, value, unit, description) VALUES
  ('driver_time_short_hop_minutes', 5,  'minutes',
   'A yard-to-location leg shorter than this bills as zero driver time (some schools are minutes from the yard)'),
  ('driver_time_rounding_minutes',  15, 'minutes',
   'Total driver time is rounded UP to a multiple of this')
ON CONFLICT (key) DO NOTHING;

-- ── Configured-but-unused pricing keys, noted 2026-08-04 ────────────────
-- Several rows in surcharge_config look live and are referenced by NOTHING:
--   * out_of_radius_km / out_of_radius_rate  ("Distance from Surrey yard
--     before per-km surcharge applies") — calculate_estimate uses
--     long_distance_threshold_km / long_distance_rate_per_km instead.
--   * fuel_surcharge_pct — the flat fuel_surcharge_per_trip is what's used.
--   * driver_pretip_min — unused until this migration.
-- Changing any of those expecting a price to move would do nothing. Worth
-- resolving separately: either wire them up or delete them, but don't leave
-- dead knobs that look adjustable.

-- ── Self-test: Mila's worked examples ───────────────────────────────────
-- Runs at apply time and ABORTS the migration if the arithmetic is wrong,
-- so a bad rounding rule can never reach production quietly.
DO $test$
DECLARE
  v_got numeric;
BEGIN
  -- 3 + 3 min, pre-trip  -> both legs zeroed, 15 min pre-trip = 0.25 h
  v_got := public.driver_time_hours(3, 3, true);
  IF v_got <> 0.25 THEN RAISE EXCEPTION 'short hop + pretrip: expected 0.25, got %', v_got; END IF;

  -- 3 + 3 min, no pre-trip -> nothing billable at all
  v_got := public.driver_time_hours(3, 3, false);
  IF v_got <> 0 THEN RAISE EXCEPTION 'short hop, no pretrip: expected 0, got %', v_got; END IF;

  -- 22 + 19 + 15 = 56 min -> 1h00 (NOT 1h15, which per-leg rounding gives)
  v_got := public.driver_time_hours(22, 19, true);
  IF v_got <> 1.0 THEN RAISE EXCEPTION 'typical trip: expected 1.0, got %', v_got; END IF;

  -- 22 + 19 = 41 min, no pre-trip -> 45 min
  v_got := public.driver_time_hours(22, 19, false);
  IF v_got <> 0.75 THEN RAISE EXCEPTION 'typical, no pretrip: expected 0.75, got %', v_got; END IF;

  -- 4 + 40 + 15: the short leg zeroes, 55 min -> 1h00
  v_got := public.driver_time_hours(4, 40, true);
  IF v_got <> 1.0 THEN RAISE EXCEPTION 'asymmetric: expected 1.0, got %', v_got; END IF;

  -- Exactly on a boundary must not round up a step: 45 + 15 = 60 -> 1h00
  v_got := public.driver_time_hours(45, 0, true);
  IF v_got <> 1.0 THEN RAISE EXCEPTION 'exact boundary: expected 1.0, got %', v_got; END IF;

  -- A missing travel time must not silently bill as zero-with-pretrip only;
  -- NULL legs are treated as 0 here, so the caller MUST refuse to price a
  -- quote whose lookup failed rather than relying on this.
  v_got := public.driver_time_hours(NULL, NULL, true);
  IF v_got <> 0.25 THEN RAISE EXCEPTION 'null legs: expected 0.25, got %', v_got; END IF;

  RAISE NOTICE 'driver_time_hours: all 7 worked examples passed';
END
$test$;
