-- Migration 073: show WHEN a driver is free, not how long they're booked.
--
-- APPLIED 2026-08-11. Verified against four cases:
--   route driver (AM 07:00-09:30, PM 13:00-17:00) -> "5am–7am, 9:30am–1pm, 5pm–9pm"
--   OVERLAPPING blocks (dentist 9-11 + sick 10-15) -> "5am–9am, 3pm–9pm"
--   whole day off -> "no free time"
--   nothing booked -> "free all day"
--
-- Mila: "instead of saying how long they are booked for, can you say what times
-- they are available, for example 9:30-1pm, 5-9".
--
-- "3.5h booked" made Melody do the subtraction herself, and it didn't even
-- contain the answer: 3.5h booked could be one long morning or two short runs
-- at opposite ends of the day, which fit completely different trips. The free
-- windows ARE the thing she's trying to work out.
--
-- The overlapping case is why intervals are merged before gaps are taken. A
-- driver can genuinely have "dentist 9-11" and "sick 10-3" both recorded --
-- migration 070 allows overlapping blocks on purpose, because arguing with the
-- form is worse. Taking gaps without merging would invent a free window
-- between 11 and 10.

-- Compact time labels: "9am", "9:30am", "1pm". Minutes only when non-zero,
-- because "9:00am-1:00pm" is a third longer to read and says no more.
CREATE OR REPLACE FUNCTION public._fmt_time(p_t time)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT to_char(p_t, 'FMHH12')
      || CASE WHEN EXTRACT(MINUTE FROM p_t) <> 0 THEN to_char(p_t, ':MI') ELSE '' END
      || CASE WHEN p_t < '12:00' THEN 'am' ELSE 'pm' END;
$fn$;

/**
 * The driver's free windows on a date, as display text.
 *
 * Busy = declared unavailable blocks + trips already assigned. Both are merged
 * before gaps are taken (see above).
 *
 * Bounded to the same 05:00-21:00 the driver's own availability grid uses.
 * Outside that nobody is being asked to drive, so reporting it as "free" would
 * be noise.
 *
 * Called once per candidate driver by recommend_drivers -- up to ~37 rows
 * against small tables, which is fine at this scale. Revisit if the roster
 * grows by an order of magnitude.
 */
CREATE OR REPLACE FUNCTION public.driver_free_windows(p_driver_id uuid, p_date date)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_day_start CONSTANT time := '05:00';
  v_day_end   CONSTANT time := '21:00';
  v_cursor    time := v_day_start;
  v_parts     text[] := '{}';
  r           record;
BEGIN
  FOR r IN
    WITH busy AS (
      SELECT COALESCE(da.start_time, v_day_start) AS s,
             COALESCE(da.end_time,   v_day_end)   AS e
      FROM driver_availability da
      WHERE da.driver_id = p_driver_id AND da.date = p_date
        AND da.status = 'unavailable'
      UNION ALL
      SELECT t.departure_time, t.return_time
      FROM trips t
      WHERE t.driver_id = p_driver_id AND t.trip_date = p_date
        AND t.status <> 'cancelled'
        AND t.departure_time IS NOT NULL AND t.return_time IS NOT NULL
    ),
    -- Standard interval merge: a new group starts wherever this interval
    -- begins after everything before it has ended.
    marked AS (
      SELECT s, e,
             CASE WHEN s > MAX(e) OVER (ORDER BY s, e
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
                  THEN 1 ELSE 0 END AS is_new
      FROM busy
    ),
    grouped AS (
      SELECT s, e, SUM(is_new) OVER (ORDER BY s, e) AS grp FROM marked
    )
    SELECT MIN(s) AS s, MAX(e) AS e FROM grouped GROUP BY grp ORDER BY 1
  LOOP
    IF r.s > v_cursor THEN
      v_parts := v_parts || (public._fmt_time(v_cursor) || '–' || public._fmt_time(r.s));
    END IF;
    IF r.e > v_cursor THEN v_cursor := r.e; END IF;
  END LOOP;

  IF v_cursor < v_day_end THEN
    v_parts := v_parts || (public._fmt_time(v_cursor) || '–' || public._fmt_time(v_day_end));
  END IF;

  IF array_length(v_parts, 1) IS NULL THEN RETURN 'no free time'; END IF;
  -- Untouched day: say so rather than printing the full 5am-9pm span, which
  -- looks like a constraint when it's the opposite.
  IF array_length(v_parts, 1) = 1
     AND v_parts[1] = public._fmt_time(v_day_start) || '–' || public._fmt_time(v_day_end)
  THEN RETURN 'free all day'; END IF;

  RETURN array_to_string(v_parts, ', ');
END;
$fn$;

-- Swap it into the suggestion label.
DO $mig$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname = 'recommend_drivers' AND pronamespace = 'public'::regnamespace;
  IF v_src IS NULL THEN RAISE EXCEPTION 'recommend_drivers not found'; END IF;

  v_new := replace(v_src,
    '      ''why'',         CASE WHEN COALESCE(hrs.h, 0) = 0 THEN ''free all day'''
    || E'\n' || '                          ELSE ROUND(COALESCE(hrs.h, 0), 1) || ''h booked'' END',
    '      -- When they''re FREE (073), not how long they''re booked. Hours booked'
    || E'\n' || '      -- made Melody do the subtraction, and didn''t distinguish one long'
    || E'\n' || '      -- morning from two short runs at opposite ends of the day.'
    || E'\n' || '      ''why'',         public.driver_free_windows(d.id, v_date)');
  IF v_new = v_src THEN RAISE EXCEPTION 'why-expression anchor not found'; END IF;
  EXECUTE v_new;
  RAISE NOTICE 'recommend_drivers: label now shows free windows';
END
$mig$;
