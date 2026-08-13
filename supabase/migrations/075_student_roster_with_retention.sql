-- Migration 075: student rosters, with retention built in from the start.
--
-- APPLIED 2026-08-12. See 076 for a bug this migration shipped with.
--
-- Mila: "keep the student lists for a year and then delete... so that year to
-- year instead of having to completely remake the lists, we could just go in
-- and edit which students are still on our bus and which ones are no longer
-- using our services... and then delete once we created our new list so that
-- we're not keeping sensitive information."
--
-- Two things in that pull against each other:
--   * EDIT rather than rebuild -- start from last year's list.
--   * DELETE the old one -- but if you edit in place there IS no old list left
--     to delete, you've mutated it.
--
-- Resolved with a school_year stamp plus a roll-forward: copy last year's
-- ACTIVE students into the new year, edit the COPY, then let the previous year
-- age out. At most two years exist at once, editing stays cheap, and deletion
-- has a clean boundary.
--
-- Retention is enforced by a scheduled job, not by remembering. A policy that
-- depends on someone deleting children's records by hand every September is one
-- that lapses in year three -- and Mila's stated reason for the whole
-- arrangement is not keeping sensitive information around.

-- School year runs July-June, matching the fiscal year the quote numbering
-- already uses (migration 052). One convention for "what year is it" beats two.
CREATE OR REPLACE FUNCTION public.current_school_year(p_on date DEFAULT CURRENT_DATE)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN EXTRACT(MONTH FROM p_on) >= 7
              THEN EXTRACT(YEAR FROM p_on)::int || '-' || (EXTRACT(YEAR FROM p_on)::int + 1)
              ELSE (EXTRACT(YEAR FROM p_on)::int - 1) || '-' || EXTRACT(YEAR FROM p_on)::int
         END;
$fn$;
-- Verified: 2026-06-30 -> 2025-2026, 2026-07-01 -> 2026-2027.

CREATE TABLE IF NOT EXISTS public.student_roster (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  -- Nullable: a student may be listed before anyone decides which run they're on.
  school_route_id uuid REFERENCES public.school_routes(id) ON DELETE SET NULL,
  school_year     text NOT NULL DEFAULT public.current_school_year(),
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  grade           text,
  -- "no longer using our services" -- a flag for the current year so the
  -- roll-forward can skip them, rather than deleted mid-year and lost.
  active          boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_roster_school_year
  ON public.student_roster (school_id, school_year);
CREATE INDEX IF NOT EXISTS student_roster_route
  ON public.student_roster (school_route_id) WHERE active;

ALTER TABLE public.student_roster ENABLE ROW LEVEL SECURITY;

-- Admin only, both directions, and NOT readable by parents. A parent seeing the
-- roster would learn every child's name on their child's bus, which the portal
-- doesn't need and schools didn't hand this over for.
--
-- Known weakness: there is currently ONE admin role, so whoever does invoicing
-- can also read this. Splitting the role is recorded in ONBOARDING_PLAN.md;
-- this table is the strongest reason for it.
DROP POLICY IF EXISTS "student_roster_admin" ON public.student_roster;
CREATE POLICY "student_roster_admin" ON public.student_roster FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

COMMENT ON TABLE public.student_roster IS
  'Students per school route, stamped with a school year. Data about identifiable minors: purpose-limited to running transport, admin-read only, purged automatically once older than the previous school year (see purge_old_student_rosters).';

-- ── Roll forward ────────────────────────────────────────────────────────
-- Copies the ACTIVE students of one year into the next, so September is an edit
-- rather than a retype. Inactive students are dropped by the copy -- that's what
-- "no longer using our services" is for.
CREATE OR REPLACE FUNCTION public.roll_forward_roster(
  p_school_id uuid,
  p_from_year text DEFAULT NULL,
  p_to_year   text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_from text := COALESCE(p_from_year, public.current_school_year());
  v_to   text := COALESCE(p_to_year,
                   (split_part(COALESCE(p_from_year, public.current_school_year()), '-', 1)::int + 1)
                   || '-' ||
                   (split_part(COALESCE(p_from_year, public.current_school_year()), '-', 2)::int + 1));
  v_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Refuse rather than duplicate. Running this twice would create two of every
  -- student and nobody would notice until the list looked wrong.
  IF EXISTS (SELECT 1 FROM student_roster
             WHERE school_id = p_school_id AND school_year = v_to) THEN
    RAISE EXCEPTION 'a % roster already exists for this school; delete it first if you want to start over', v_to;
  END IF;

  INSERT INTO student_roster (school_id, school_route_id, school_year, first_name, last_name, grade, notes)
  SELECT school_id, school_route_id, v_to, first_name, last_name, grade, notes
  FROM student_roster
  WHERE school_id = p_school_id AND school_year = v_from AND active;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

-- ── Retention ───────────────────────────────────────────────────────────
-- NOTE: the version below shipped with a bug and is corrected in 076. It
-- deleted FUTURE years too, which would have destroyed a roster rolled forward
-- in June to prepare for September. Left here as applied; 076 replaces it.
CREATE OR REPLACE FUNCTION public.purge_old_student_rosters()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_current text := public.current_school_year();
  v_prev    text := (split_part(public.current_school_year(), '-', 1)::int - 1)
                    || '-' ||
                    (split_part(public.current_school_year(), '-', 2)::int - 1);
  v_count int;
BEGIN
  DELETE FROM student_roster WHERE school_year NOT IN (v_current, v_prev);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RAISE LOG 'purge_old_student_rosters: deleted % rows older than %', v_count, v_prev;
  END IF;
  RETURN v_count;
END;
$fn$;

-- Monthly is enough for a yearly boundary, and keeps the job cheap.
SELECT cron.schedule(
  'purge-old-student-rosters',
  '0 3 1 * *',
  $job$ SELECT public.purge_old_student_rosters(); $job$
);
