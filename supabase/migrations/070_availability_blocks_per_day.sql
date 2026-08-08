-- Migration 070: let a driver record more than one block per day.
--
-- APPLIED 2026-08-05. Verified by inserting two blocks on one date for one
-- driver and confirming both persisted, then cleaning up.
--
-- Migration 067 gave driver_availability start_time/end_time, but the table
-- still carried UNIQUE (driver_id, date) from the day-level design. So a driver
-- could say "away 09:00-11:00" OR "away 14:00-16:00" but never both -- the
-- second insert would fail. The hourly feature was half-built and would have
-- looked broken the first time anyone used it properly.

ALTER TABLE public.driver_availability
  DROP CONSTRAINT IF EXISTS driver_availability_driver_id_date_key;

-- Exact duplicates are still pointless, so keep a uniqueness rule -- but on the
-- WINDOW, not the day. COALESCE rather than a plain multi-column unique because
-- Postgres treats NULLs as distinct, which would let a driver file the same
-- all-day block repeatedly.
CREATE UNIQUE INDEX IF NOT EXISTS driver_availability_unique_window
  ON public.driver_availability
     (driver_id, date, COALESCE(start_time, '00:00'::time), COALESCE(end_time, '23:59:59'::time));

-- Overlapping blocks are deliberately ALLOWED. "Away 09:00-11:00 (dentist)" and
-- "away 10:00-15:00 (sick)" can both be true, and _windows_overlap treats any
-- overlapping unavailable row as blocking, so the scheduling answer stays
-- correct. Rejecting overlaps would just make a driver fight the form.

-- Drivers could already read, insert and update their own rows, but only an
-- admin could DELETE. That's wrong for a calendar: cancelling an appointment is
-- the most ordinary thing a driver will do, and making them phone the office to
-- un-block a morning defeats the purpose.
DROP POLICY IF EXISTS "availability_own_delete" ON public.driver_availability;
CREATE POLICY "availability_own_delete" ON public.driver_availability FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.drivers d
            WHERE d.id = driver_availability.driver_id AND d.profile_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles
               WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

COMMENT ON TABLE public.driver_availability IS
  'Driver time off. One row per BLOCK, not per day — a driver can file several on the same date. NULL start_time and end_time together mean the whole day. Read by recommend_drivers via _windows_overlap.';
