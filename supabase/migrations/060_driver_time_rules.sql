-- Migration 060: the driver-time arithmetic, and the per-quote yard choice.
--
-- APPLIED 2026-08-04, self-test passed. Changes no prices on its own: it adds
-- a column and two functions that nothing calls yet. calculate_estimate still
-- uses the flat driver_time_buffer_hours until migration 062 wires this in.
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
-- ── Correction, 2026-08-04 ──────────────────────────────────────────────
-- The first draft of this migration CREATED a yards table and seeded three
-- yards. That was wrong. public.yards has existed since migration 001, was
-- corrected in 027, and had Ladner and Abbotsford added in 030. There are
-- FOUR yards, not three, and every one of them was already in the database
-- with an address.
--
-- The draft would have aborted on apply rather than corrupting anything --
-- it seeded 'Surrey' as is_default while 'Surrey Yard' already holds that
-- flag, which violates the yards_single_default index from 001. But that was
-- luck. Had the seed omitted is_default, it would have quietly inserted four
-- duplicate yards under near-identical names, and driver time would then have
-- been measured from whichever duplicate a given query happened to pick.
--
-- Root cause: the schema was assumed from the task description instead of
-- being read. CLAUDE.md says to use the Supabase MCP for schema rather than
-- guessing. One list_tables call would have caught it.
--
-- This migration now touches yards not at all, and adds only what genuinely
-- doesn't exist: the per-quote yard choice, and the driver-time arithmetic.
--
-- ── Why the yard is a per-quote choice ──────────────────────────────────
-- buses.home_yard_id and drivers.home_yard_id already exist, so a bus does
-- have a base. But a home yard is where a bus lives, not necessarily where it
-- starts a given trip. Deriving trip origin from the assignment would bill
-- travel that didn't happen whenever a bus is repositioned.
--
-- Rejected alternative: "nearest yard to the pickup". Same objection, worse --
-- it's a guess that fails exactly when it matters, if the nearest yard has no
-- bus free and one comes from Abbotsford instead.

-- ── Which yard a given quote leaves from ────────────────────────────────
ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS yard_id uuid REFERENCES public.yards(id);

COMMENT ON COLUMN public.quote_versions.yard_id IS
  'Yard this trip departs from. NULL means the default yard (is_default = true, currently Surrey Yard). Set per trip by an admin: buses have a home yard, but a repositioned bus may start elsewhere, so trip origin cannot be inferred from the assignment.';

-- ── The rules, as pure functions ────────────────────────────────────────
-- Kept separate from the Google lookup on purpose: these are deterministic
-- and testable without a network call, so the arithmetic can be verified
-- independently of whether the travel API is reachable.

/**
 * One leg's billable minutes. Anything under the short-hop threshold counts
 * as zero — some schools are minutes from the yard and charging travel time
 * for those isn't honest. Verified against Google 2026-08-04: Surrey Yard ->
 * Frost Road Elementary (8606 162 St) is 1.0 km / 3.2 min, matching Mila's
 * stated "two to three minutes".
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

-- ── Verified end to end, 2026-08-04 ─────────────────────────────────────
-- Real Google Routes numbers through the travel-time edge function, against
-- what the flat one-hour buffer bills for the same trips today:
--
--   Frost Road, morning, first run of the day   15 min   (today: 60)
--   Frost Road, bus already ran a route          0 min   (today: 60)
--   Surrey -> Abbotsford, morning               120 min   (today: 60)
--
-- That spread is the whole point: one flat hour overcharges the school three
-- minutes away and undercharges the one forty-eight minutes away. Note the
-- last row goes UP -- this change is not uniformly cheaper for customers, and
-- long-haul quotes will rise when 062 lands.
