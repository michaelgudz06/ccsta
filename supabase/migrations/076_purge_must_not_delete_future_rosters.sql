-- Migration 076: the roster purge must not delete NEXT year's list.
--
-- APPLIED 2026-08-12. Caught by the lifecycle test on 075, before any real
-- student data existed.
--
-- The purge said: delete anything NOT IN (current year, previous year). That
-- also matches FUTURE years -- so a roster rolled forward in June to prepare
-- for September would be deleted by the next monthly run. The one action the
-- feature exists to support would have silently destroyed its own output, and
-- the first sign would have been an empty list in September.
--
-- Now compares the start year numerically and deletes only what is genuinely
-- OLDER than the previous year. Current, previous and any future year survive.
--
-- Verified end to end afterwards: 2024-2025 purged, 2025-2026 kept, 2026-2027
-- kept (including a student flagged inactive), 2027-2028 rolled forward with
-- only the active student and NOT purged. A second roll-forward is refused
-- rather than duplicating everyone.
CREATE OR REPLACE FUNCTION public.purge_old_student_rosters()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_prev_start int := split_part(public.current_school_year(), '-', 1)::int - 1;
  v_count int;
BEGIN
  -- Strictly older than the previous school year. Anything at or after it --
  -- including a roster prepared for next September -- is kept.
  DELETE FROM student_roster
  WHERE split_part(school_year, '-', 1)::int < v_prev_start;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    -- Count only. Logging which children were deleted would defeat the point.
    RAISE LOG 'purge_old_student_rosters: deleted % rows older than school year starting %', v_count, v_prev_start;
  END IF;
  RETURN v_count;
END;
$fn$;
