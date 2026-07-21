-- Migration 036: add the 'multi_destination' enum value, ON ITS OWN.
--
-- ⚠ MUST be applied manually as its own, separate step, committed BEFORE
-- migration 037 (the quote_multi_stops table + submit_quote update) is
-- run. Do NOT paste 036 and 037 together into the Supabase SQL Editor —
-- pasting a whole script executes it as one transaction, and Postgres
-- will not let you USE a freshly-added enum value in the same transaction
-- that added it (an "unsafe use of new value of enum type" error).
-- plpgsql's compiler resolves literal comparisons like
-- `v_trip_type = 'multi_destination'` against the enum type at
-- CREATE FUNCTION time, not deferred to first call, so bundling this
-- ALTER TYPE with 037's submit_quote update fails the whole paste
-- atomically — this was confirmed the hard way: a first attempt at
-- combining them into one script silently rolled back BOTH the enum add
-- and the table/function changes, with no obvious error surfaced.
--
-- Correct order: run this file alone → confirm it committed → THEN run
-- migration 037 as a separate execution.

ALTER TYPE public.quote_trip_type ADD VALUE 'multi_destination';
