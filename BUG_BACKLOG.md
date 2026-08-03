# Bug Backlog — Customer-Facing UI

Written 2026-07-20, from a deep pre-launch bug hunt of the customer-facing
UI on the `trip-types` branch (quote form, pricing math, edit flow, portal,
error handling). All 22 findings are listed below, grouped by the severity
assigned during the hunt. Severities are as judged then and have NOT been
re-rated since.

Each entry keeps its original writeup underneath the resolution note, so the
reasoning at the time stays readable.

**Status key:**
- ✅ **FIXED** — done, with a note saying how and when.
- ⏭ **FAST-FOLLOW (post-launch)** — tracked, not blocking launch.

**As of 2026-07-29: 17 of the 22 are fixed** — #1, #2, #3, #4, #5, #6, #7, #8,
#11, #13, #14, #15, #16, #17, #20, #21, #22. The four originally marked "FIXING PRE-LAUNCH" (#3, #4,
#6, #7) did all ship; three of them just kept the pre-launch label for over a
week, which made the list look worse than reality. Verify before trusting a
label here.

**Still open (5, all cosmetic or edge-case):** #9 (cross-tab draft
clobbering), #10 (no cap on shuttle run count), #12 (draft restore doesn't
validate shape), #18 (member-rate display flicker), #19 (cosmetic "0h" chip).
None are money-related and none are user-blocking.

Historical note: this file used to ask whether shipping the two CRITICAL
findings as fast-follow was a deliberate acceptance of risk. Answered
2026-07-27 — Mila had never been told about them, so they were fixed that day
rather than left standing.

---

## CRITICAL

### #1 — Editing an approved/confirmed quote silently orphans its invoice ✅ RESOLVED 2026-07-27
**Fixed by removing the cause, not the symptom (migration 057a).** The
premise turned out to be wrong: `approve_quote` was creating an invoice at
*approval*, long before the trip. Mila confirmed an invoice should be the
bill a school pays AFTER the trip — and nothing in the system ever advanced
an invoice past `draft` anyway, so the post-trip billing flow simply hadn't
been built. The row was a price snapshot wearing an invoice costume.
`approve_quote` no longer creates one; the approved price already lives on
the quote version. Also fixed a latent failure nobody had hit: because
`invoice_number` derives from the unchanging quote number, re-approving an
edited quote would have hit a unique-constraint violation.

Original writeup follows.
`edit_own_quote` (migration 042) allows editing while status is `approved`
or `confirmed`. `approve_quote` had already inserted a `draft` invoice row
snapshotting the price at that point. No function ever updates or deletes
that invoice row when the underlying quote is edited afterward, and
`admin.tsx` never queries `invoices` to flag staleness.
**Scenario:** Melody prices a quote at $850 (draft invoice created).
Customer then edits the trip via the portal — the new version has its
pricing fields nulled and status reset to `in_review`, but the $850 draft
invoice just sits there, unlinked to reality, with nothing telling Melody
it's stale.

### #2 — No optimistic lock; admin pricing writes can race a customer's edit ✅ FIXED 2026-07-27
**Fixed in migration 057c.** `set_quote_approved_driver_hours` and
`set_quote_price_override` now take the version id the admin was looking at
and refuse the write if it no longer matches, with a message telling her to
refresh. NULL skips the check so un-updated callers still work; the parameter
was added with a DEFAULT and the old signature dropped, so it's backward
compatible with no deploy ordering.

Deliberately unguarded: `calculate_estimate` recomputes from the current
version, so running it against a newer one is correct rather than a race.
`approve_quote` was already protected — an edit nulls the new version's
pricing and approval refuses a quote with no total.

Original writeup follows.
Neither `edit_own_quote` nor the admin pricing functions
(`calculate_estimate`, driver-hours/fuel-waiver overrides, `confirm_trip`)
check a version stamp before writing.
**Scenario:** Melody opens a quote to price it right as the customer
submits an edit. Her `UPDATE` can succeed against the now-superseded
version — invisible on the live quote, no error surfaced to either side.

### #3 — Edit-quote loader has no error handling; can strand a customer forever ✅ FIXED pre-launch
Label was stale — verified in code 2026-07-29. A `failLoad()` helper handles
every failure path: the quote fetch, the version fetch, the shuttle-runs and
multi-stops fetches each check `error` and bail through it, and the whole
block is wrapped in try/catch. No path leaves `editLoading` stuck true.

Original writeup follows.
`src/routes/quote.tsx:253-338` never checks `error` on any of its 5
Supabase calls and has no try/catch. If any query fails,
`setEditLoading(false)` never runs.
**Scenario:** A customer opens `/quote?edit=<id>` and one of the loading
queries fails (network blip, RLS hiccup). The customer is stuck on
"Loading your quote…" indefinitely — no timeout, no retry, no error
message.

---

## HIGH

### #4 — No past- or future-date validation on quote submission ✅ FIXED pre-launch
Label was stale — verified 2026-07-29 on both sides. Client: `validateAll`
rejects a past date and anything beyond two years. Server: `submit_quote`
raises on both bounds, confirmed live via `pg_get_functiondef` during the
migration-051 drift check. Migration 048 restored the same guard on
`edit_own_quote` after a later migration reverted it.

Original writeup follows.
`validateAll` (`src/routes/quote.tsx:478`) only checks that *a* date was
picked. No `min` on the date `<input>`, no server-side check either.
**Scenario:** A customer can submit a brand-new quote for yesterday, or
for the year 2099, with zero warning anywhere in the stack.

### #5 — No DB-level protection against duplicate/racing edit submissions ✅ FIXED 2026-07-27
**Fixed in migration 057b**, folded in with #2 since it's the same code.
Added a UNIQUE constraint on `(quote_id, version_number)` so the database
refuses duplicates outright, plus a `FOR UPDATE` row lock on the parent quote
before reading `MAX(version_number)` so the second writer waits rather than
racing and then failing.

Original writeup follows.
`quote_versions` has no unique constraint on `(quote_id, version_number)`;
the next version number is computed via an unlocked `MAX+1`. The UI's
`disabled={submitting}` only stops a literal double-click.
**Scenario:** Two open tabs, or a network retry, submit near-simultaneous
edits to the same quote — both could succeed, producing duplicate version
rows and a non-deterministic "last write wins" on `current_version_id`.

### #6 — Failed geocode tells the customer "your estimate is still accurate" while a real surcharge may be missing ✅ FIXED 2026-07-27
**Root cause was bigger than this writeup.** Investigated after Mila noticed
"distance unavailable" on a test quote; **all six quotes in the database had
`distance_km` null**, including ones whose addresses geocode perfectly.
Three stacked problems:

1. **The real one — effect restart cancelled every lookup.** `RouteMap`'s
   effect listed `onResult` in its dependency array, and the quote form
   passes it as an inline arrow, so its identity changed on every render.
   Every keystroke anywhere in the form restarted the effect, setting
   `cancelled = true` on the in-flight geocode before it could call back.
   Since the chain takes 1–2s, the distance only ever landed if the customer
   stopped typing entirely while the map was on screen. Fixed by holding the
   callback in a ref and dropping it from the deps. `MultiStopRouteMap` had
   the identical bug with `onResult` *and* `onGeocodeUpdate`.
   - Side effect of the bug: every keystroke fired two Nominatim lookups plus
     an OSRM route — abusive of free services and a rate-limit risk.
2. **Unit numbers break Nominatim.** `2755 Lougheed Hwy #9, Port Coquitlam,
   BC V3B 5Y9` returns an empty array (HTTP 200, zero results); the same
   address without `#9` resolves first try. Verified live. Added
   `addressVariants()`, which retries without unit/suite designators and then
   without the postal code, spaced to respect the ≤1 req/sec policy.
3. **The silent failure this bug was originally about.** Now surfaces an
   honest message saying the estimate may not include a long-distance charge,
   instead of nulling the error and claiming the estimate is still accurate.

Note the two geocodes were also fired back-to-back under a comment claiming
they were spaced for rate limiting — they weren't. Now actually spaced.

Original writeup follows.

`src/components/RouteMap.tsx:94-98` sets the error message to null on a
failed geocode, rendering "Route preview not available for this address —
your estimate is still accurate." But `distanceKm` stays null, so the
long-distance surcharge is silently omitted — and since the server sets
distance from the same client geocode result, the real invoice can miss
the surcharge too, not just the preview.
**Scenario:** A customer on a genuinely long trip types an address that
fails to geocode. They're told the estimate is accurate; it may not be,
and the shortfall could carry through to the actual invoice if Melody
doesn't notice the admin-side "distance unavailable" warning.

### #7 — Raw Postgres/network error text shown to customers verbatim ✅ FIXED pre-launch
Label was stale — verified 2026-07-29. Every customer-facing error goes
through `friendlyError()` in `quote.tsx` and `portal.tsx`; the only bare calls
are `setSubmitError(null)` / `setActionError(null)`, which clear rather than
display. Admin surfaces it too, where a raw Postgres string is more use.

Original writeup follows.
`quote.tsx:602,618` (`setSubmitError(error.message)`) and `portal.tsx:160`
(`setActionError(error.message)`) render `error.message` directly with no
translation layer. Confirmed concretely: supabase-js doesn't throw on
network failure, so a fully offline customer submitting the form or
clicking Cancel/Accept in the portal sees a literal
`"TypeError: Failed to fetch..."`-style string in the error banner.
**Scenario:** Customer loses connection mid-submit, sees a raw
stack-trace-flavored error string instead of a friendly message.

### #8 — Best-effort follow-up RPCs after a successful submit discard their errors ✅ FIXED 2026-07-27
`set_quote_distance_km` and `set_quote_driver_preference` fire after the quote
is already saved and only `console.error`'d on failure — so a transient blip
produced a quote with no distance, and therefore no long-distance charge,
with nobody the wiser. Now routed through `saveWithRetry()`: one retry after
600ms, and a persistent failure is recorded against the quote via
`log_client_issue` (migration 058) so it lands somewhere a human looks rather
than in a console the customer will never open. Deliberately still not shown
to the customer — their quote *did* submit, and alarming them would be wrong.
The admin "distance unavailable" flag remains the visible backstop.

Original writeup follows.
`quote.tsx:606-608, 621-623, 625-627` (`set_quote_distance_km`,
`set_quote_driver_preference`) are bare `await supabase.rpc(...)` calls
with no `error` read at all. The success screen shows regardless.
**Scenario:** A quote saves successfully but silently missing its distance
(and thus the surcharge that would actually be billed) or driver
preference, with zero indication to anyone that data was dropped.

---

## MEDIUM

### #9 — Cross-tab draft clobbering, last-write-wins ⏭ FAST-FOLLOW (post-launch)
No `storage`/`BroadcastChannel` sync on the draft-autosave key. Two open
tabs silently overwrite each other's in-progress draft, no warning.

### #10 — No upper bound on shuttle run count ⏭ FAST-FOLLOW (post-launch)
`QuoteFields.tsx:231-240`'s run-count stepper floors at 1 but never caps.
Typing "999" instantly renders 999 pickup/dropoff pairs and would submit a
999-element array.

### #11 — Midnight-wraparound math silently masks data-entry errors ✅ FIXED 2026-07-27
Submission is now blocked when the return time is at or before the departure
time, with a message pointing at the likely AM/PM slip. Previously the
duration helper added 24 hours and carried on, so 9:00 AM → 4:00 AM became a
19-hour billable trip instead of an obvious typo. The wraparound arithmetic is
kept so the live preview never flashes a negative duration mid-edit, but it's
no longer reachable at submit. Checked the live database first: no existing
quote crosses midnight, so there was no bad data to correct.

Original writeup follows.
`quote.tsx:403-410`'s `if (diff < 0) diff += 24*60` applies uncritically.
A customer who swaps depart/return by mistake gets a silent 17-hour
"overnight" interpretation feeding straight into the live price estimate,
with no sanity check or "did you mean the next day?" prompt.

### #12 — Draft restore has no schema/shape validation ⏭ FAST-FOLLOW (post-launch)
`applyDraft` (`quote.tsx:134-157`) blind-casts stored JSON into state. A
future field rename could cause an old localStorage draft to silently
apply malformed rows instead of being detected and discarded.

### #13 — Portal query failures silently render as "no quotes" ✅ FIXED 2026-07-29
The quotes query now checks `error` and sets a `loadError`, which renders an
amber "we couldn't load your trips" panel with a Try again button instead of
the reassuring empty state. Telling a customer they have no bookings when the
request merely failed is the kind of wrong that gets acted on.

Original writeup follows.
Every `.from(...)` call in `portal.tsx:load()` (lines 93-142) ignores
`error`. A failed query looks identical to a customer who genuinely has
zero quotes.

### #14 — No timeout on geocoding/routing fetches ✅ FIXED 2026-07-27
Added `fetchWithTimeout` (8s, AbortController) and routed every Nominatim and
OSRM call in both `RouteMap` and `MultiStopRouteMap` through it. Nominatim and
the public OSRM demo server are free services with no SLA; a hung request left
the chain waiting forever, so `distance_km` stayed null and the long-distance
charge silently vanished — same outcome as a failed geocode but with no error
to react to. Verified in-browser that the abort fires rather than hanging.

Original writeup follows.
`RouteMap.tsx`/`MultiStopRouteMap.tsx` never use `AbortController`. A hung
Nominatim/OSRM request looks identical to "still working," indefinitely.

### #15 — Portal's `canEdit` doesn't check the 7-day rule ✅ FIXED 2026-07-29
`canEdit` now mirrors migration 042's lock: no online edit within 7 days of
the trip. The Edit button is hidden and replaced with an explanation and the
dispatch number, rather than letting someone fill in the whole form and then
be rejected by the RPC. Verified in the portal against a trip dated inside the
window — button gone, notice shown.

Original writeup follows.
`portal.tsx:231-232` matches the server's status check but has no
trip-date check mirroring migration 042's 1-week lock.
**Scenario:** A customer on a near-term trip fills out the whole edit
form and only then hits a generic RPC rejection.

### #16 — Hardcoded client-side rate/threshold constants ✅ RESOLVED 2026-07-29
Fixed by commit `5dce11d` + migration 050 (which opened `rate_config` and
`surcharge_config` to public read) — the preview now reads rates, GST, fuel,
overtime and long-distance thresholds live from config rather than mirroring
them in JS. Verified: seven live `surcharges.*` reads plus a `rate_config`
lookup for the hourly rate.

`RATE_FALLBACK` remains, deliberately: it applies only if the config read
itself fails, so the form still produces a number rather than breaking. That's
a safety net, not the drift risk this bug was about.

Original writeup follows.
`quote.tsx:428-430,447,450-451,455-456` hardcode rates/thresholds instead
of reading `rate_config`/`surcharge_config`. Currently correct (verified
against migrations 014/034), but nothing would catch future drift if
rates are updated in the DB (this app's normal workflow) without a
matching frontend deploy.

### #17 — "Billable hours (...actual)" label is dead-code-wrong ✅ FIXED 2026-07-27
`quote.tsx:1119`'s `billHours > minHours` check can never be false given
the actual math, so the "(X hr minimum)" wording can never display even
when the floor is exactly what's happening. Cosmetic — doesn't affect any
charged number.

**Fixed** as part of simplifying the customer estimate breakdown. The
dead condition is gone; a new `minimumApplied` flag (`tripHoursCalc === null
|| tripHoursCalc < minHours`) drives an honest "N hr minimum applied" note.
Note the original writeup put the test on the wrong variable — the minimum
floors *trip* hours (`billableTripHours`), and the driver-time buffer is
then added on top, so `billHours` can never equal `minHours`. That's why
the condition was unreachable.

---

## LOW

### #18 — Member-rate lookup can visibly jump ~400ms after typing ⏭ FAST-FOLLOW (post-launch)
Rate flips from non-member to member display shortly after the debounced
school lookup resolves. Jarring, not incorrect — final math is unaffected.

### #19 — Cosmetic "0h" trip-length chip on identical depart/return times ⏭ FAST-FOLLOW (post-launch)
The summary chip shows "0h" even though billed hours correctly floor to
the minimum underneath it in the actual price table.

### #20 — "This quote couldn't be found" conflates a 404 with a transient failure ✅ RESOLVED 2026-07-29
Already fixed by the #3 work, verified 2026-07-29: a query error routes to
`failLoad()` ("We couldn't load this quote right now") while a genuinely
missing row says "This quote couldn't be found". The two are distinct.

Original writeup follows.
Same root cause as #3/#13 — a failed initial load and a genuinely missing
quote render the same message.

### #21 — `handleSubmit` has no try/catch ✅ FIXED 2026-07-29
Wrapped in try/catch/finally, with `setSubmitting(false)` in the finally so
the button is always released. Still a latent trap rather than a live bug --
supabase-js returns errors instead of throwing -- but it's the kind that only
surfaces on the day something else breaks.

Original writeup follows.
Currently unreachable given supabase-js's no-throw behavior, but a latent
trap for a future synchronous throw between `setSubmitting(true)` and the
RPC call, which would leave the button stuck on "Submitting…" forever.

### #22 — Empty catch in `AddressAutocomplete` + swallowed localStorage draft errors ✅ FIXED 2026-07-29
Both still degrade gracefully -- that part was right -- but they now
`console.warn` instead of vanishing. Silently swallowing them made "autocomplete
stopped working" and "it lost what I typed" undiagnosable.

Original writeup follows.
Both silently degrade (plain input; draft just doesn't save/restore).
Likely intentional, but worth confirming rather than assuming.

---

## Explicitly checked and confirmed fine (no bug found)

For completeness — these were specifically investigated during the hunt
and are working as intended, not gaps:

- Zero-passenger validation fires for every trip type, no skip path.
- Trip-type switching doesn't leak stale fields into the wrong payload shape.
- NaN can't reach the screen — steppers/time fields are hard-guarded.
- Minimum-hours, overtime, and long-distance boundaries use consistent
  strict comparisons on client and server (hand-verified numerically).
- A full member-school pricing scenario was traced end-to-end on both
  client and server and produced an identical total to the cent.
- The 7-day edit-lock boundary is correct and trusts only server time, not
  anything client-submitted.
- Editing a quote's runs/stops to empty, or converting it to `multi_trip`,
  is genuinely blocked server-side, not just hidden in the UI.
- A mid-`edit_own_quote` exception rolls back cleanly with no orphaned
  partial rows (plain plpgsql function, atomic by default).
