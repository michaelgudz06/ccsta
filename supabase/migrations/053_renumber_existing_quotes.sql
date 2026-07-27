-- Migration 053: renumber the existing quotes into the new fiscal-year scheme.
--
-- DATA MIGRATION — this rewrites real rows, unlike 052 which only changed
-- behaviour going forward. Apply 052 FIRST (it creates _fiscal_year and
-- quote_number_counters, both used below).
--
-- Context, decided 2026-07-27: only 6 quotes existed at the time (the old
-- sequence had reached 126 because test quotes were deleted along the way).
-- Two belong to real schools:
--   * marianne@the-grove.net   — 2 quotes, one already past 'requested'
--   * info@dasmeshacademy.ca   — 1 quote
-- The other three are test accounts (Curtis, Mila, michaeltest). Mila chose
-- to renumber all six for a clean queue, accepting that the two real
-- customers' confirmation emails will quote a number that no longer exists.
--
-- Mitigations:
--   * The customer portal reads the live quote number, so it stays correct
--     there. Only the already-sent email is stale.
--   * quote_number_renumber_log below preserves the old -> new mapping, so
--     if someone phones quoting an old number Melody can still find them.
--     Worth keeping permanently rather than dropping after the fact.
--
-- NOT changed: invoices.invoice_number. Existing invoices keep their
-- INV-2026-xxxx numbers and no longer mirror their quote's number. That was
-- an explicit "don't care for now" — revisit if invoice numbering starts
-- mattering.

-- ── Audit trail for the renumber ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quote_number_renumber_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id      uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  old_number    text NOT NULL,
  new_number    text NOT NULL,
  renumbered_at timestamptz NOT NULL DEFAULT now()
);

-- Admin-read only; customers have no reason to see it.
ALTER TABLE public.quote_number_renumber_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "renumber_log_admin_read" ON public.quote_number_renumber_log;
CREATE POLICY "renumber_log_admin_read"
  ON public.quote_number_renumber_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- ── The renumber itself ─────────────────────────────────────────────────
-- Ordered by created_at so the oldest quote becomes 001. Runs as a single
-- statement pair inside the migration's implicit transaction: either every
-- quote is renumbered or none is.
--
-- No unique-constraint collision is possible here because every new number
-- carries the current fiscal year (Q-2027-xxx) while every existing number
-- carries a calendar year (Q-2026-xxxx). If this is ever re-run in a year
-- where those overlap, it would need a two-phase update via temporary
-- numbers -- worth remembering before reusing this file as a template.
WITH numbered AS (
  SELECT
    id,
    quote_number AS old_number,
    'Q-' || public._fiscal_year()::text || '-'
      || lpad(row_number() OVER (ORDER BY created_at)::text, 3, '0') AS new_number
  FROM public.quotes
),
logged AS (
  INSERT INTO public.quote_number_renumber_log (quote_id, old_number, new_number)
  SELECT id, old_number, new_number FROM numbered
  WHERE old_number IS DISTINCT FROM new_number
  RETURNING quote_id, new_number
)
UPDATE public.quotes q
SET quote_number = l.new_number,
    updated_at   = now()
FROM logged l
WHERE q.id = l.quote_id;

-- ── Point the counter at the highest number just assigned ───────────────
-- Without this the next real submission would grab 001 and collide with the
-- quote that now holds it.
INSERT INTO public.quote_number_counters (fiscal_year, last_no)
SELECT public._fiscal_year(), count(*)::int FROM public.quotes
ON CONFLICT (fiscal_year)
DO UPDATE SET last_no = GREATEST(
  public.quote_number_counters.last_no,
  EXCLUDED.last_no
);
