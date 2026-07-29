-- Migration 055: remove personal names from the customer confirmation email.
--
-- APPLIED to the live DB 2026-07-27 via the Supabase connector.
--
-- Rather than pasting a fresh copy of submit_quote (which is how migration
-- 022's guard got silently reverted once already), this reads the CURRENT
-- live definition, applies three exact string replacements, and re-executes
-- it. Every replacement asserts it matched -- if the live body has drifted
-- and any target string is missing, the migration raises and changes nothing
-- rather than writing a stale function.
--
-- This pattern is worth reusing for any future copy-only change to a big
-- CREATE OR REPLACE'd function: it is impossible to accidentally revert
-- unrelated logic, because the unrelated logic is never retyped.
--
-- Wording note: "Our staff will review" rather than "We'll review" is
-- deliberate. The replacement text is injected INTO a SQL string literal in
-- the function source, so an apostrophe would need doubling there. A first
-- attempt using "We'll" produced an unescaped quote and failed with a syntax
-- error -- caught safely, since the whole DO block rolls back. Avoiding the
-- apostrophe removes that class of mistake, and matches the wording already
-- used on the quote form.
--
-- Result, verified after applying:
--   text + HTML: "What happens next: Our staff will review your request and
--                 follow up with your official price, usually within one
--                 business day."
--   signature:   CCSTA Admin / 778-986-9011 / Admin@ccsta.net  (no personal name)

DO $mig$
DECLARE
  d  text;
  d0 text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'submit_quote';

  IF d IS NULL THEN RAISE EXCEPTION 'submit_quote not found'; END IF;

  -- 1. "What happens next" line -- appears twice (plain text + HTML).
  d0 := d;
  d := replace(
    d,
    'Melody will review your request and follow up with your official price',
    'Our staff will review your request and follow up with your official price'
  );
  IF d = d0 THEN RAISE EXCEPTION 'copy line not found -- live body has drifted'; END IF;

  -- 2. Plain-text signature: drop the personal name, keep the role line.
  d0 := d;
  d := replace(
    d,
    '''Melody Vanderwal'' || E''\nCCSTA Admin''',
    '''CCSTA Admin'''
  );
  IF d = d0 THEN RAISE EXCEPTION 'text signature not found -- live body has drifted'; END IF;

  -- 3. HTML signature: remove the name paragraph entirely; the "CCSTA Admin"
  --    paragraph directly beneath it becomes the first line of the block.
  d0 := d;
  d := replace(
    d,
    '|| ''<p style="margin:0 0 2px; font-size:13px; font-weight:600; color:#1f2b4d;">Melody Vanderwal</p>''',
    ''
  );
  IF d = d0 THEN RAISE EXCEPTION 'html signature not found -- live body has drifted'; END IF;

  EXECUTE d;
END
$mig$;
