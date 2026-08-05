-- Migration 062: an application-level daily ceiling on Google Routes calls.
--
-- APPLIED 2026-08-04. Verified by setting the cap to 0 and confirming an
-- uncached route returned source 'daily-cap' with null minutes, while a cached
-- route on the same request still answered from cache. Cap restored to 500.
--
-- ── Why this exists in our code rather than in Google's console ─────────
-- Google's own per-day quota cap is the right place for this. It is DISABLED
-- on free trial accounts — "Edit quota" is greyed out in the Maps Platform
-- quota page (confirmed in the console 2026-08-04). So it cannot be set until
-- the billing account is activated.
--
-- Note the ordering risk: the day the trial is activated is exactly the day a
-- runaway loop stops burning trial credit and starts costing money. Setting
-- Google's own cap should happen at the same time as activation, not after.
-- This function is the stand-in until then, and remains useful afterwards as a
-- second line of defence that doesn't depend on Google's UI.
--
-- The risk being guarded is not normal usage — a few quotes a day is about two
-- calls each, against a 10,000/month free allowance. It's a loop. The Nominatim
-- geocode used to fire on every keystroke; the same shape of bug against a
-- metered API is an invoice.

/**
 * Live Google lookups made since midnight.
 *
 * Counting method: travel_time_cache rows written today. Every successful live
 * lookup upserts exactly one row and sets fetched_at, so this is an exact count
 * of billable calls that succeeded, with no extra table to keep in sync.
 *
 * Failed calls aren't counted, which is the safe direction: Google does not
 * bill errors, and undercounting can only make the cap trigger later, never
 * spuriously.
 */
CREATE OR REPLACE FUNCTION public.travel_time_calls_today()
RETURNS integer
LANGUAGE sql
STABLE
AS $fn$
  SELECT count(*)::int
  FROM public.travel_time_cache
  WHERE fetched_at >= date_trunc('day', now());
$fn$;

INSERT INTO public.app_config (key, value, description) VALUES
  ('travel_time_daily_cap', '500',
   'Max live Google Routes lookups per day. Past this the travel-time function stops calling out and returns null, so quotes fall back to the flat driver_time_buffer_hours. Set to 0 to disable lookups entirely.')
ON CONFLICT (key) DO NOTHING;

-- ── Behaviour at the cap ────────────────────────────────────────────────
-- Reaching the cap degrades accuracy, it does not break quoting:
--   * cached routes keep answering normally (cache reads cost nothing)
--   * uncached routes return null, and the caller falls back to the flat
--     driver_time_buffer_hours — the behaviour we have today
--   * a warning goes to the function logs
--
-- The budget check itself fails OPEN. If app_config is unreadable the function
-- proceeds uncapped, because a config hiccup silently degrading every estimate
-- to the flat buffer is harder to notice than a bill.
