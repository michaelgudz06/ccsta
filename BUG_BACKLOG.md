# Bug Backlog — Customer-Facing UI

Written 2026-07-20, from a deep pre-launch bug hunt of the customer-facing
UI on the `trip-types` branch (quote form, pricing math, edit flow, portal,
error handling). All 22 findings are listed below, grouped by the severity
assigned during the hunt. Four fixes are going in **before** launch; the
rest are tracked here as fast-follow so they don't get lost once the site
is live. Nothing in this file has been fixed yet except where explicitly
marked.

**Status key:**
- 🔧 **FIXING PRE-LAUNCH** — going in before deploy.
- ⏭ **FAST-FOLLOW (post-launch)** — tracked, not blocking launch.

Note: the two CRITICAL findings (#1, #2) are currently FAST-FOLLOW, not
part of the four pre-launch fixes — flagging that explicitly since they're
the most severe items on this list; confirm that's an intentional
acceptance of risk for launch, not an oversight.

---

## CRITICAL

### #1 — Editing an approved/confirmed quote silently orphans its invoice ⏭ FAST-FOLLOW (post-launch)
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

### #2 — No optimistic lock; admin pricing writes can race a customer's edit ⏭ FAST-FOLLOW (post-launch)
Neither `edit_own_quote` nor the admin pricing functions
(`calculate_estimate`, driver-hours/fuel-waiver overrides, `confirm_trip`)
check a version stamp before writing.
**Scenario:** Melody opens a quote to price it right as the customer
submits an edit. Her `UPDATE` can succeed against the now-superseded
version — invisible on the live quote, no error surfaced to either side.

### #3 — Edit-quote loader has no error handling; can strand a customer forever 🔧 FIXING PRE-LAUNCH
`src/routes/quote.tsx:253-338` never checks `error` on any of its 5
Supabase calls and has no try/catch. If any query fails,
`setEditLoading(false)` never runs.
**Scenario:** A customer opens `/quote?edit=<id>` and one of the loading
queries fails (network blip, RLS hiccup). The customer is stuck on
"Loading your quote…" indefinitely — no timeout, no retry, no error
message.

---

## HIGH

### #4 — No past- or future-date validation on quote submission 🔧 FIXING PRE-LAUNCH
`validateAll` (`src/routes/quote.tsx:478`) only checks that *a* date was
picked. No `min` on the date `<input>`, no server-side check either.
**Scenario:** A customer can submit a brand-new quote for yesterday, or
for the year 2099, with zero warning anywhere in the stack.

### #5 — No DB-level protection against duplicate/racing edit submissions ⏭ FAST-FOLLOW (post-launch)
`quote_versions` has no unique constraint on `(quote_id, version_number)`;
the next version number is computed via an unlocked `MAX+1`. The UI's
`disabled={submitting}` only stops a literal double-click.
**Scenario:** Two open tabs, or a network retry, submit near-simultaneous
edits to the same quote — both could succeed, producing duplicate version
rows and a non-deterministic "last write wins" on `current_version_id`.

### #6 — Failed geocode tells the customer "your estimate is still accurate" while a real surcharge may be missing 🔧 FIXING PRE-LAUNCH (paired with #8)
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

### #7 — Raw Postgres/network error text shown to customers verbatim 🔧 FIXING PRE-LAUNCH
`quote.tsx:602,618` (`setSubmitError(error.message)`) and `portal.tsx:160`
(`setActionError(error.message)`) render `error.message` directly with no
translation layer. Confirmed concretely: supabase-js doesn't throw on
network failure, so a fully offline customer submitting the form or
clicking Cancel/Accept in the portal sees a literal
`"TypeError: Failed to fetch..."`-style string in the error banner.
**Scenario:** Customer loses connection mid-submit, sees a raw
stack-trace-flavored error string instead of a friendly message.

### #8 — Best-effort follow-up RPCs after a successful submit discard their errors 🔧 FIXING PRE-LAUNCH (paired with #6)
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

### #11 — Midnight-wraparound math silently masks data-entry errors ⏭ FAST-FOLLOW (post-launch)
`quote.tsx:403-410`'s `if (diff < 0) diff += 24*60` applies uncritically.
A customer who swaps depart/return by mistake gets a silent 17-hour
"overnight" interpretation feeding straight into the live price estimate,
with no sanity check or "did you mean the next day?" prompt.

### #12 — Draft restore has no schema/shape validation ⏭ FAST-FOLLOW (post-launch)
`applyDraft` (`quote.tsx:134-157`) blind-casts stored JSON into state. A
future field rename could cause an old localStorage draft to silently
apply malformed rows instead of being detected and discarded.

### #13 — Portal query failures silently render as "no quotes" ⏭ FAST-FOLLOW (post-launch)
Every `.from(...)` call in `portal.tsx:load()` (lines 93-142) ignores
`error`. A failed query looks identical to a customer who genuinely has
zero quotes.

### #14 — No timeout on geocoding/routing fetches ⏭ FAST-FOLLOW (post-launch)
`RouteMap.tsx`/`MultiStopRouteMap.tsx` never use `AbortController`. A hung
Nominatim/OSRM request looks identical to "still working," indefinitely.

### #15 — Portal's `canEdit` doesn't check the 7-day rule ⏭ FAST-FOLLOW (post-launch)
`portal.tsx:231-232` matches the server's status check but has no
trip-date check mirroring migration 042's 1-week lock.
**Scenario:** A customer on a near-term trip fills out the whole edit
form and only then hits a generic RPC rejection.

### #16 — Hardcoded client-side rate/threshold constants ⏭ FAST-FOLLOW (post-launch)
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

### #20 — "This quote couldn't be found" conflates a 404 with a transient failure ⏭ FAST-FOLLOW (post-launch)
Same root cause as #3/#13 — a failed initial load and a genuinely missing
quote render the same message.

### #21 — `handleSubmit` has no try/catch ⏭ FAST-FOLLOW (post-launch)
Currently unreachable given supabase-js's no-throw behavior, but a latent
trap for a future synchronous throw between `setSubmitting(true)` and the
RPC call, which would leave the button stuck on "Submitting…" forever.

### #22 — Empty catch in `AddressAutocomplete` + swallowed localStorage draft errors ⏭ FAST-FOLLOW (post-launch)
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
