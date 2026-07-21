# Next Session — Pick Up Here

_Written 2026-07-19, updated 2026-07-20. Replaces the 2026-07-14 version,
which was stale — customer quote editing and the multi-destination trip
type had both since shipped without this file being updated. Delete or
replace once this goes stale too._

## Current state

- **All pre-launch work is DONE.** Minibus pricing (18-bench now $10/hr
  cheaper than the 47, migration `049`), the full School→Organization text
  sweep (quote form, admin, portal, driver dashboard), the Start Fresh
  cache bug (was silently repopulating org name/pickup/contacts from an
  older quote — root cause and fix in the migration/commit history), the
  PRE-DEPLOY PUNCH LIST's "must fix" tier (mislabeled text, multi-
  destination placeholder, contact-field validation), server-side trip-date
  bounds (`046`/`048`), and the confirmation-email polish (HTML version,
  copy fixes, the stale `site_url` fix) are all complete.
- **Applied to the live Supabase DB through migration `049`.**
- **`main` is still UNTOUCHED, and none of this is committed or pushed
  yet either** — still sitting locally on `trip-types`. Deploying means
  committing, pushing, *then* merging (see the plan below) — don't skip
  straight to a merge assuming the work is already on GitHub.
- **A full customer-flow code audit ran 2026-07-19**, covering landing →
  quote form (all 5 trip types) → estimate/pricing → address autofill →
  submission → confirmation email → customer portal. Results are logged in
  `WHATS_NEW.md`'s PRE-DEPLOY PUNCH LIST — see above, that tier is done.

## ⚠ UNRESOLVED DISCREPANCY — Vercel vs. Lovable (flag for Mila, not auto-corrected)

This file has a `BLOCKED ON VERCEL ACCESS` section below (brother's Vercel
account, texted him for access, needed for Melody's preview env vars) that
was written 2026-07-20. Separately, this session confirmed via GitHub that
**ccsta.net is actually served by Lovable**, synced from this repo's `main`
branch — not Vercel. The only Vercel trace found in the repo is a local,
gitignored `.vercel/output` folder, which looks like a one-off local
`vercel build`, not a real deployment.

Both could still be true at once (e.g. a separate Vercel-based preview flow
for Melody distinct from Lovable's production hosting) — **not deleting
the Vercel-access section on that guess.** Whoever picks this up: confirm
with Mila whether the Vercel angle is still real/relevant before acting on
it, especially before the deploy step below.

## BLOCKED ON VERCEL ACCESS (2026-07-20)

The Vercel project is under my brother's account — I'm not a member of it
yet. Text sent asking him to add me. Until that lands, I **cannot**:
- (a) check/set Preview-environment env vars ahead of Melody's test
  preview (see the Vercel preview-deployment walkthrough discussed
  earlier this session — env vars are scoped per-environment, and Preview
  needs its own check separate from Production's).
- (b) do the actual production deploy, **if** it turns out to actually go
  through Vercel rather than (or in addition to) Lovable — see the
  discrepancy flagged above.

## ADDRESS AUTOFILL — GOOGLE MAPS KEY — CORRECTED (2026-07-20)

Was flagged as a launch blocker; it isn't one, but an earlier note here
(2026-07-19) claimed it was resolved because the key is set in **Vercel's**
environment variables. That's the same Vercel/Lovable mix-up flagged above
— corrected now that it's confirmed ccsta.net runs through **Lovable**, not
Vercel. Mirrors the same correction already made in `WHATS_NEW.md`'s punch
list — keep both in sync if this moves further.

- **Still needs verification** — check Lovable's project settings
  specifically for `VITE_GOOGLE_MAPS_API_KEY`, and confirm live that
  address fields are suggesting real addresses, not silently falling back
  to plain text (the component degrades gracefully either way, so this
  wouldn't be visibly broken, just quietly not helping).
- **Billing context (from research, still valid):** Google retired the old
  universal $200/month free credit in March 2025. It's now per-SKU free
  tiers — roughly 10,000 free Essentials calls/month, and Autocomplete
  sessions linked to Place Details are currently free outright. For
  CCSTA's volume, usage will very likely stay entirely free. **Do not sign
  up for a paid plan** (Starter $100 / Essentials $275 / Pro $1,200) —
  those are sized for high-volume use, not this.
- **Two recommended follow-ups (not urgent, cheap protection):**
  1. Find out whose credit card is on the Google Cloud billing account.
  2. Set a budget cap/alert in Google Cloud — there's **no automatic hard
     cap** on API billing.

## RESOLVED: date-bounds "regression" scare on submit_quote/edit_own_quote (2026-07-20)

Migrations 043–047 (HTML confirmation email, copy fixes, `site_url` fix,
trip-date bounds, "Organization" label) all built on `submit_quote` in
sequence. After 047 (Organization label) landed, a verification query
checking for the word `'interval'` in `submit_quote` returned `false`,
which looked like 047 had reverted 046's date-bounds check — a real scare,
since several migrations stack on `submit_quote` and getting the base
wrong once already happened earlier in this same chain.

**Turned out to be two separate, smaller things, found by pulling the
actual live function text (`pg_get_functiondef`) instead of trusting
migration history or a keyword grep:**

1. **`submit_quote` was never broken.** The verification query's `false`
   was a false alarm — the live body genuinely has the date-bounds check
   (`INTERVAL '2 years'`, uppercase). The check likely grepped
   case-sensitively for lowercase `'interval'` and never matched. Migration
   047 was confirmed to contain exactly one statement
   (`CREATE OR REPLACE FUNCTION submit_quote`) — it doesn't touch
   `edit_own_quote` at all, so it couldn't have been the cause of anything
   on that function either.
2. **`edit_own_quote` *was* actually missing its date-bounds check** —
   but not because of 047. Most likely migration 046's `edit_own_quote`
   half never actually got applied in the first place (046 updates both
   functions in one file; the `submit_quote` half clearly landed, given
   044/047's later changes stack cleanly on top of it, but `edit_own_quote`
   came back with no trace of 046's addition at all). Fixed by migration
   048, built directly on the live `pg_get_functiondef` output (not a
   reconstruction from migration history), verified by diffing
   comment-stripped code before *and* after applying — confirmed clean.

**Lesson for future verification, and for future migrations that stack on
the same function:** don't grep for a generic keyword that appears for
unrelated reasons elsewhere in the function (`interval`/`INTERVAL` shows up
in the unrelated 7-day-lock rule too) or that's case-sensitive-fragile.
Match the actual exception text instead, case-insensitively:
```sql
SELECT prosrc ILIKE '%Trip date can''t be in the past%' AS has_date_bounds
FROM pg_proc WHERE oid = 'public.submit_quote'::regproc;
-- same query, swap in 'public.edit_own_quote'::regproc, to check that one too
```
And when in doubt about what's actually live vs. what a migration file
*should* have produced, pull `pg_get_functiondef()` directly rather than
assuming migration history reflects reality — that's what actually
resolved this, twice.

## The plan, in order

### 1. FIRST — clean up test quotes

All my own test quotes were created under `milagudz07@gmail.com` and
`milagudz06@gmail.com`. Clean these up **before** deploying, so the admin
dashboard isn't showing test clutter alongside real bookings from day one.

**Don't delete blind.** Run the `SELECT` below first, review the list
(quote number, org, destination, date), confirm every row is actually test
data, then delete only those specific IDs.

Email is stored two independent ways on a quote — this checks both so
nothing slips through:
1. `quotes.customer_id → profiles.id → profiles.email` (the logged-in
   submitter).
2. `quote_versions.contact_primary`/`contact_secondary ->> 'email'`
   (free-text form entry, checked across *every* version of a quote, not
   just the current one — an edited quote can carry a different email on
   an older version).

```sql
SELECT
  q.quote_number,
  s.name                  AS organization,
  cv.destination_name     AS destination,   -- blank for multi-destination; see note below
  cv.trip_date,
  q.created_at,
  q.status,
  p.email                 AS login_email,
  q.id                    AS quote_id
FROM public.quotes q
JOIN public.profiles p       ON p.id = q.customer_id
LEFT JOIN public.schools s   ON s.id = q.school_id
LEFT JOIN public.quote_versions cv ON cv.id = q.current_version_id
WHERE
  lower(p.email) IN ('milagudz07@gmail.com', 'milagudz06@gmail.com')
  OR EXISTS (
    SELECT 1 FROM public.quote_versions v
    WHERE v.quote_id = q.id
      AND (
        lower(v.contact_primary->>'email')   IN ('milagudz07@gmail.com', 'milagudz06@gmail.com')
        OR lower(v.contact_secondary->>'email') IN ('milagudz07@gmail.com', 'milagudz06@gmail.com')
      )
  )
ORDER BY q.created_at DESC;
```

Multi-destination quotes' `destination_name` will show blank (real stops
live in `quote_multi_stops` instead) — extend the query if that matters
for review. Delete by `quote_id` only, after eyeballing the full list.

### 2. THEN — deploy

`main` is still untouched and nothing from this session is committed yet.
Full sequence:
1. **Commit and push** everything currently sitting locally on
   `trip-types` — none of it is on GitHub yet, including migration `049`.
2. **Open a PR, `trip-types` → `main`.** As of last check it was a clean
   fast-forward (39 commits ahead, 0 behind, no divergence) — re-verify,
   since more commits have landed locally since then.
3. **Before merging, snapshot current `main`** — create a backup branch
   pointing at whatever `main`'s tip is *at merge time* (not a hardcoded
   hash from earlier — confirm it's still untouched first). This is the
   rollback anchor.
4. **Merge using "Create a merge commit"** (not squash, not rebase) — one
   commit gives one clean `git revert -m 1 <sha>` undo point if the deploy
   goes wrong, no force-push needed.
5. **Confirm Lovable syncs** the new `main`, then hit **Publish** (check
   whether Lovable auto-publishes on push or needs the manual click) — but
   see the Vercel/Lovable discrepancy flagged above first, in case Vercel
   is also genuinely part of this.
6. **Smoke test live** on ccsta.net immediately after publish: submit a
   real-looking quote across at least two trip types, check the admin
   dashboard loads, check the confirmation email arrives and renders.
7. **Rollback ready, not just planned:** know the revert command before
   you need it (`git revert -m 1 <merge-sha>` + push, or hard-reset to the
   backup branch as a last resort) so there's no scrambling if something
   breaks. Real customers are actively using the live site — treat this
   deploy accordingly.

### 3. POST-LAUNCH — work the feedback backlog

Once live and smoke-tested, move to `WHATS_NEW.md`'s **"Still on the
backlog"** section: the ADMIN UI REDESIGN batch (quote detail view
clarity is top priority within it), and the other post-launch items
(full-detail admin confirmation email — mockup approved by Mila, day-of
contact optional, the customer "approve pricing" email feature). Also
`WHATS_NEW.md`'s **"Operational items raised by Melody"** — in particular
the still-unresolved **live reloading bug** Melody reported on the
*currently deployed* (pre-merge) site, which may or may not still
reproduce once the new version is live; worth a direct check post-deploy
rather than assuming the merge fixed it as a side effect.

See `WHATS_NEW.md` for full feature detail, the PRE-DEPLOY PUNCH LIST
history, and the complete backlog.
