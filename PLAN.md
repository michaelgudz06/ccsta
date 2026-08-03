# Plan — everything after migration 051

_Written 2026-07-24. This is the **sequencing** document: what order to do
the remaining work in and why. It deliberately does not restate detail that
already lives elsewhere — `BUG_BACKLOG.md` has the full 22-item bug detail,
`WHATS_NEW.md` has feature history and the raw backlog, `NEXT_SESSION.md` is
the per-session handoff. Delete sections here as they land; don't let this
file grow into a third changelog._

**Ordering principle:** things that can quietly charge a customer the wrong
amount or lose a booking come first. Then things that cost Melody time every
day. Then polish. Anything blocked on a decision from Melody or Mila is
parked at the bottom rather than guessed at.

---

## Phase 0 — Ship 051 ✅ DONE 2026-07-24

Committed (`6ade961`), pushed, migration applied, `notify-send` deployed,
`RESEND_API_KEY` confirmed, and both emails verified in a real inbox. The
HTML email pipeline works end to end for the first time.

Two findings worth carrying forward, both recorded in `NEXT_SESSION.md`:
production had an **unversioned draft of 051** applied directly to the DB
that existed in no migration file, and **nothing drains the email queue on a
schedule** (see Phase 5).

Remaining crumb: check off the admin-confirmation-email item in
`WHATS_NEW.md`'s "Still on the backlog" section.

---

## Phase 1 — Close the open unknowns (all but one done)

None of this is building; it's replacing assumptions with facts. **Four of
the five are now closed** (items 1–4). Only item 5 remains — confirming the
CRITICAL-bugs risk acceptance — and that's a decision, not work.

1. ~~**Is ccsta.net actually serving the post-launch build?**~~ **Yes —
   confirmed 2026-07-25.** The live `/quote` page renders the trip-type
   selector with Round trip, Shuttle and Multi-destination all present. The
   07-21 publish did go through.
2. ~~**Does Lovable auto-publish on push to `main`?**~~ **RESOLVED
   2026-07-25 — no. Publishing is a required manual click.** GitHub sync
   and publishing are separate: Lovable auto-pulls pushed commits into the
   project editor within seconds, but the live site changes only on
   Publish. Written into the deploy checklist at `NEXT_SESSION.md` §3,
   including the trap that the auto-synced editor makes unpublished code
   look deployed.
3. ~~**Is `RESEND_API_KEY` set?**~~ **Yes — confirmed 2026-07-24**, and
   emails were verified arriving in a real inbox as part of Phase 0.
4. ~~**Is `VITE_GOOGLE_MAPS_API_KEY` set?**~~ **Done 2026-07-25** — it was
   NOT set (verified on the live site: no Google script tag injected,
   `window.google` undefined, both address fields showing the no-key
   fallback hint). A referrer-restricted key was created in Google Cloud
   with Maps JavaScript API + Places API enabled, added to the tracked
   `.env`, committed and published, and autocomplete confirmed working.
   - **Note for future config work: this project does NOT use Lovable's
     environment-variable UI.** Public `VITE_` config lives in the committed
     `.env` file — that's how the Supabase vars reach the build, and
     `src/lib/config.server.ts` documents the convention. Don't go looking
     for an env settings panel in Lovable; there isn't one in use here.
   - **Scope correction, because an earlier draft of this plan overstated
     it:** the key is used in exactly one place — `AddressAutocomplete`, for
     the address-suggestion dropdown. Distance (and therefore the
     long-distance surcharge) comes from **Nominatim** for geocoding and
     **OSRM** for routing, neither of which uses a key. A missing key cost
     address quality and typing convenience, **not** surcharge correctness.
     The earlier claim that it was a money-correctness issue was wrong.
   - The genuine money-correctness question in this area is bug #6 itself
     plus #14 (no timeout on those fetches). Nominatim asks for ≤1 request
     per second and the public OSRM demo server has no SLA — those are the
     dependencies that can silently drop a surcharge. Better autocomplete
     helps only indirectly, by producing cleaner addresses that Nominatim is
     more likely to resolve.
5. **Confirm the CRITICAL-bugs risk acceptance.** `BUG_BACKLOG.md` flags
   that #1 and #2 shipped as fast-follow rather than pre-launch fixes and
   asks for explicit confirmation that this was intentional. Answer it
   before Phase 2 so the priority is real rather than inherited.

---

## Phase 2 — The two CRITICAL data-integrity bugs ✅ DONE 2026-07-27

Both fixed, plus #5, in migration 057 (applied live). #1 was resolved by
removing its cause rather than patching it: `approve_quote` was creating an
invoice at approval, which is the wrong moment — an invoice is the post-trip
bill. That decision opened a new gap, now Phase 6 below.

Original plan follows.

Both are silent-wrong-money bugs on a live system taking real bookings, and
both get more expensive the more quotes exist. This is the first real build
phase.

**Bug #1 — editing an approved quote orphans its draft invoice.** A price
Melody set can persist on an invoice row after the trip it priced has
changed underneath it. Decide the intended behaviour first (void the draft
invoice on edit? regenerate it? flag it stale and make Melody re-approve?)
— it's a business rule, not a code detail, so it needs Melody's answer
before implementation. Then it's a change to `edit_own_quote` plus a
staleness indicator in `admin.tsx`.

**Bug #2 — no optimistic lock on pricing writes.** Melody pricing a quote
at the same moment a customer edits it can write to a superseded version
with no error on either side. Implementation is a version stamp checked by
`edit_own_quote`, `calculate_estimate`, and the override/confirm functions,
returning a clear conflict error the UI can show. This is the fix most
likely to touch `submit_quote`-family functions, so re-read the
`CREATE OR REPLACE` gotcha in `NEXT_SESSION.md` §6 before starting: pull the
live function bodies with `pg_get_functiondef`, don't work from repo files.

Pair bug **#5** (no unique constraint on `(quote_id, version_number)`, next
version computed with an unlocked `MAX+1`) into this phase — it's the same
concurrency surface and the same set of functions. Doing it separately means
touching those functions twice.

---

## Phase 3 — Admin UI redesign (its own multi-session project)

The largest item, and the one Melody feels daily. Do it as a design project
like the customer quote-form redesign was, not a series of tweaks.

**Step 1 is discovery, not code:** sit with Melody and get specifics on what
she needs to see, in what order. Scope gathered on 07-20 is already in
`WHATS_NEW.md` — use it as the starting agenda, not the final spec.

Build order within the phase, roughly:

1. **Quote detail view clarity** — explicitly her top priority.
2. **Simplify the calculations display** (admin and customer side).
3. **Inline editing of any price component**, replacing the "waive fuel"
   toggle — she should be able to zero the fuel fee or drop an overtime
   line directly. Note this interacts with Phase 2's optimistic locking:
   more editable fields means more write paths that need the version check.
   Doing Phase 2 first is deliberate.
4. **Stage-based sections** — reviewed / priced-but-not-customer-approved /
   scheduled / completed / invoiced.
5. **Sort/filter** by date, organization, destination.
6. **Invoiced records grouped by organization.**

Small items to fold in rather than schedule separately: the quote-number
edit not persisting (a real bug, not a design question — worth checking
whether it's a quick fix that shouldn't wait), "Enter to save" on admin
edits, showing quote `created_at` somewhere, and the multi-destination stops
display. Also re-check the live-reloading bug Melody reported — it may have
been a pre-deploy artifact, so confirm it still reproduces before debugging it.

---

## Phase 4 — Finish the email work

Once 051 has proven the HTML pipeline actually delivers, the rest is
mechanical and cheap by comparison.

1. Extend the branded HTML treatment to the **priced / rejected / cancelled**
   customer emails, reusing 051's template.
2. **New "Quote approved" email with an "Approve pricing" button** — the
   customer approves the price and the quote moves to scheduling. This one
   is a feature, not a template change: it needs a tokenized action link and
   a state transition, so it's the largest piece here.
3. Make **day-of contact optional** — estimate-only customers shouldn't have
   to fill it in. Small, but it's an email/form correctness item that keeps
   getting deferred.

---

## Phase 5 — Remaining fast-follow bugs ✅ DONE 2026-07-29

**All 22 findings from the 2026-07-20 hunt are now closed.** Order taken:
the money-correctness cluster first (#8, #11, #14 — all three ended with a
quote priced wrong and nobody told), then the failures that masqueraded as
empty states (#13, #15, #21, #22), then the cosmetic and edge-case remainder
(#9, #10, #12, #18, #19). #3, #4, #7, #16 and #20 turned out to be already
fixed and were verified rather than re-done.

`BUG_BACKLOG.md` is now history rather than a worklist.

Original batching follows.

~15 items left in `BUG_BACKLOG.md` once Phase 2 absorbs #1, #2, and #5.
Batch them by the file they touch rather than by severity — the severities
are all MEDIUM/LOW and the batching saves more time than the ordering does.

- **Error-surfacing batch:** #13 (portal query failures render as "no
  quotes"), #20 (404 vs. transient failure conflated), #21 (`handleSubmit`
  has no try/catch), #22 (empty catches). Same theme: failures currently
  look like empty states.
- **Draft/localStorage batch:** #9 (cross-tab clobbering), #12 (no shape
  validation on restore).
- **Input-bounds batch:** #10 (no cap on shuttle run count), #11
  (midnight-wraparound masking data-entry errors), #15 (portal `canEdit`
  doesn't check the 7-day rule).
- **Network resilience:** #14 (no timeout on geocoding/routing fetches).
- **Email queue has no scheduled drain** (found 2026-07-24, not in
  `BUG_BACKLOG.md`): `notify-send` runs only when the frontend invokes it
  after a user action, and `src/lib/notify.ts` swallows failures. A failed
  dispatch leaves the row `pending` indefinitely until an unrelated action
  flushes it. Fix is a pg_cron job (or Supabase scheduled function) calling
  `notify-send` every few minutes as a safety net. Small, and it removes a
  class of "the customer never got the email" mystery.
- **Cosmetic:** #17 (dead-code-wrong billable-hours label), #18 (member-rate
  display jump), #19 ("0h" chip).

**First, re-check #16** (hardcoded client-side rate constants). Commit
`5dce11d` plus migration 050 made the customer estimate preview read
`rate_config`/`surcharge_config` live, which was the whole point of #16 — it
is probably already fixed and just not marked. Verify the remaining
hardcoded constants in `quote.tsx` are gone, then check it off rather than
scheduling work for it.

---

## Phase 6 — Post-trip invoicing (NEW, and now the real gap)

Created by Phase 2's decision. `approve_quote` no longer creates an invoice,
which is correct — but nothing creates one after a trip either, so there is
currently no billing flow at all. In practice this changes nothing today
(no invoice was ever sent), but it's now an explicit hole rather than a
half-built one.

Everything needed already exists and is unused: the `invoices` table,
`invoice_status` (draft/sent/paid/overdue/cancelled), and the `invoiced`
quote status.

Needs decisions before building: invoice numbering (still derived from the
quote number?), payment terms, what Melody actually sends a school, and
whether "completed trip" or an explicit admin action triggers generation.

## Phase 7 — Email queue safety net ✅ DONE 2026-07-29

Migration 059 (applied live). A pg_cron job calls notify-send every five
minutes, so a queued email always goes out instead of waiting for an
unrelated user action. Authenticated with the PUBLISHABLE key — already
public in the site bundle — so no secret sits in `cron.job`. Verified by
running the job's exact body by hand: HTTP 200, `{"sent":0,"queued":0}`.
Added a `stuck_notifications` view for anything pending over 30 minutes.

Also found while doing it: 13 'failed' rows in notification_log, all from
11–23 June, all the same pre-domain-verification Resend error. Mail to real
customers has sent fine since. History, not a live fault.

Original writeup follows.

Nothing drains the queue on a schedule. `notify-send` runs only when the
frontend invokes it after a user action, and `src/lib/notify.ts` deliberately
swallows failures — so a failed dispatch sits `pending` until an unrelated
action flushes it. A pg_cron job calling it every few minutes closes a whole
class of "the customer never got the email" mystery. Small.

## Blocked on a decision — do not build

- **Member special pricing tiers** ("Member w/i 1hr" $63/$78.75, "Driver
  Only" $47.25). Genuinely ambiguous — nobody currently knows whether "within
  1 hour" means driving distance or trip duration, or what the two numbers
  represent. Mis-charging risk on a real business; needs Melody's answer
  first. Highest-value item in this section once unblocked, because it
  affects what customers are charged.
- **Editing `scheduled` quotes** — pending Melody's decision on how bus and
  driver unassignment should work.
- **Multi-destination schedule feasibility validation** — needs decisions on
  buffer time, tolerance, and warn-vs-block. Useful head start: the OSRM
  call in `MultiStopRouteMap.tsx` already returns per-leg durations, unused.

## Not blocked, but genuinely later

Calendar//availability system (the trip-type time data was built
calendar-readable for it), address autofill with seeded favorites, parent
bus-tracking portal, 5% first-online-quote discount, hourly driver and bus
availability windows.

---

## Repo hygiene, whenever convenient

- `.claude/` is untracked in the repo root — decide whether it belongs in
  `.gitignore`.
- `CODEBASE_GUIDE.html` was flagged as mystery/untracked in an earlier
  handoff. It's accounted for: committed as `b5a28b5`, "plain-English
  codebase guide for non-coders." No action needed beyond removing the
  stale warning.
