# What's New — CCSTA Platform

A plain-English summary of everything added/changed in this round of work, grouped
by area. Migrations are the numbered files in `supabase/migrations/`.

---

## 1. Customers can now create their own accounts (signup)

**Before:** the login page only let you log in — there was no way for a new school
to make an account, so they couldn't actually submit a quote.

**Now:**
- A **"Create an account"** mode on the login page (`src/routes/login.tsx`) — email +
  password, that's it. New accounts are always **customers** (enforced in the database).
- New helper `signup()` in `src/lib/auth.ts`.
- If email confirmation is on, it shows "check your email"; if off, it logs them
  straight in. *(Action item: in Supabase → Authentication → Email, turning "Confirm
  email" OFF gives the smoothest signup→submit flow.)*

## 2. Quote form keeps your answers through signup (no lost work)

**Before:** an anonymous user filled the whole form, then got bounced to login and
**lost everything**.

**Now (`src/routes/quote.tsx`):**
- The form **autosaves a draft** to the browser as you type.
- Anonymous users still get the instant estimate, then click **"Create account & send"**,
  make an account, and come **right back to the form fully pre-filled** to submit.
- Homepage copy fixed to match reality ("free estimate, no account to start").

## 3. Seat-based bus capacity (pricing + assignment correctness)

**Before:** capacity was wrongly calculated as pax × 2 (a 47-pax bus was treated as
holding 94), which under-assigned buses and could mis-price.

**Now (migration `031`, plus the form):**
- Each bus has a fixed number of **bench seats**: 18-pax → 9, 47-pax → 23.67, 56-pax → 28.
- Each seat holds **2 older riders (Grade 5+ and adults)** or **3 younger riders (K–4)**.
- Seats needed = `(K–4 ÷ 3) + ((Gr 5+ + adults) ÷ 2)`; the bus must have enough seats,
  and we use multiple buses when needed.
- If no grades are entered, everyone is treated as adults (2 per seat).
- Applied in **three places so they always agree**: the customer's live estimate
  (`quote.tsx`), the server price (`calculate_estimate`), and the admin's bus
  suggestion engine (`suggest_assignment`).

## 4. Customer can request a preferred driver

**New (migration `031` + form + admin):**
- An optional **"Preferred driver"** field on the quote form.
- Saved to the quote (`quote_versions.driver_preference` via `set_quote_driver_preference`).
- Shows up on the **admin quote detail** so the office can honour it when assigning —
  and contact the customer if that driver isn't free on the date.

## 5. Secondary contact is now optional

Curtis's ask. The secondary contact on the quote form is no longer required (you can
move on without it). If you do enter one, it still must be a different person from the
primary. Day-of contact is still required.

## 6. Show/hide password (eye toggle)

A reusable `PasswordInput` (`src/components/PasswordInput.tsx`) with an eye icon is now
on every password field — login, signup, and reset-password.

## 7. Cancellation requests + customer-facing cancel flow

**New (migration `025`, `src/routes/portal.tsx` + `admin.tsx`):**
- Before the office prices a quote, the customer can **cancel it directly**.
- After it's been accepted/booked, they submit a **cancellation request** instead, which
  the office approves or declines from the dashboard (an amber banner).
- The cancel/confirm dialogs are proper **in-app modals** now (not the old browser pop-ups
  that could silently fail on phones).

## 8. Email notifications (Resend)

**New (migration `025`, `supabase/functions/notify-send/`, `src/lib/notify.ts`):**
- Automatic emails are **queued** at key moments: quote received (to customer + office),
  price ready, quote accepted, and cancellation updates.
- A Supabase **Edge Function (`notify-send`)** delivers them via Resend.
- *(Action item: set `RESEND_API_KEY` on the function and verify the `ccsta.net` domain in
  Resend to send from `@ccsta.net`. Until then, emails just queue — nothing breaks.)*

## 9. Driver dashboard — the day-of essentials

**Before:** the driver card was missing the things a driver actually needs.

**Now (migration `029` + `src/routes/driver.tsx`):**
- Trips now carry **pickup address, day-of contact, and special requests** (copied when a
  trip is confirmed), plus a **double-booking re-check** at confirm time.
- The driver card shows the **bus number**, **pickup** (tap to open maps), a big green
  **tap-to-call** button for the day-of contact, students, leave/back times, and school notes.
- Checklist and availability saves now **confirm "Saved ✓" / "Couldn't save"** and revert on
  failure (no more silently losing the safety checklist). Clearer Working/Away labels, and a
  message if a driver's profile isn't set up yet.

## 10. Admin polish

- **Fixed a stuck-trip bug:** the office can now assign a bus **after the customer accepts**
  the price (previously the button vanished at that step).
- Raw database errors are mapped to **plain-language messages**.
- "Confirmed" is relabelled **"Accepted by customer"** so the status is unambiguous.

## 11. Real operational data loaded (no more demo data)

**Migrations `026` + `030`:**
- **28 real buses** (with Samsara vehicle IDs, VINs, sizes, air-brake flags) replacing the
  demo fleet.
- **36 real drivers** (demo drivers deactivated).
- **4 yards** — Surrey, Langley, Abbotsford, Ladner — with real addresses; every bus and
  most drivers linked to their home yard.
- **Member schools** corrected to the 4 confirmed ones.
- Office email set to `admin@ccsta.ca`.
- **Driver clearances:** every active driver is cleared for all bus sizes (bench size isn't a
  constraint; air-brake certification is the only gate).

## 12. Security hardening (important)

**Migration `028`** — closed two live privilege-escalation holes found in review:
- Signup could previously make you an **admin** via metadata — now new users are always
  `customer`.
- A logged-in user could **PATCH their own role to admin** via the API — now blocked by a
  policy `WITH CHECK` plus a trigger that prevents non-admins changing roles.
- Pinned function search paths; removed a trigger function from the public API surface.

---

## Test accounts (all password `CCSTAtest2026!`)
- Customer: `customer@test.com`
- Driver: `driver@test.com`
- Admin: `admin@test.com`

## Outstanding config / action items (dashboard, not code)
- **Supabase Auth:** Site URL + Redirect URLs should be `https://ccsta.net` now that DNS is
  live; consider turning off "Confirm email" for smooth signup.
- **Resend:** set `RESEND_API_KEY` + verify `ccsta.net` to turn on real emails.
- **Google Maps key:** add `ccsta.net` to the allowed referrers.
- **Samsara token** is stored (`.env.local`); native live tracking is a later phase.

## Recently completed
- **Admin manual price override after Calculate** — done. Melody can override the
  system driver-time estimate and waive the $50 fuel fee, both editable any time
  and persisted separately from the system estimate for audit (migration 034).
- **Trip types** — built (migration `035`, `quote.tsx`, `admin.tsx`): a
  trip-type selector at the top of the quote form with two-way (unchanged
  behavior), one-way (drop-off time instead of a return leg), shuttle
  (customer-defined number of runs, each with its own pickup/drop-off time,
  billed continuously from first pickup to last drop-off), and multi-trip
  (admin-only — routes to a "contact Melody" dead end, no self-serve form).
  Pricing math is unchanged for every type. On the `trip-types` branch.
  **Not yet deployed** — see "Deploy planning" under Operational items below.
- **Multi-destination (5th trip type)** — built, full feature (migrations
  `036`/`037`/`038`, `quote.tsx`, `MultiStopRouteMap.tsx`): a real self-serve
  form for multiple different destinations in one day, added *alongside*
  multi-trip (not replacing it — multi-trip's copy was relabeled to mean
  booking across multiple days instead, since it now means something
  different). Customer adds a repeatable stop (address + arrival/departure
  time), plus a return-to-school leg auto-added by default (editable
  address, removable). Hours billed from earliest to latest stop time, same
  technique as shuttle — no pricing-engine change. Distance is the actual
  resolved question: total km summed across every leg (pickup → each stop →
  return), computed via a single OSRM multi-waypoint routing request,
  feeding the existing $1/km-over-200km charge unchanged. Unresolved
  addresses don't block submission — flagged (via null `lat`/`lng` on that
  stop) for Melody to confirm by hand, consistent with the existing
  distance-unavailable pattern. On the `trip-types` branch. **Not yet
  deployed.** *(Confirmed by 2026-07-19 pre-deploy audit — see PRE-DEPLOY
  PUNCH LIST below for one open gap: the portal's own quote-detail view
  doesn't yet show the stop list back to the customer.)*
- **Member 2hr/4hr minimum, client-side — done** (commit `5e9016d`,
  2026-07-16). The customer-facing quote-form estimate (`quote.tsx`) now
  looks up the logged-in customer's school membership live and correctly
  applies a 2-hour floor + the discounted member hourly rate in the preview,
  matching the server (`calculate_estimate`). Member rates already existed
  in `rate_config` (seeded in migration `014`); this was purely a client
  lookup gap, now closed. **Superseded claim:** earlier notes in this file
  said the client "hardcodes a 4-hour minimum regardless of membership" —
  that was accurate when written but is now stale; corrected here per the
  2026-07-19 audit. One cosmetic bug remains from the same code path: the
  "Suggested bus" line still hardcodes the label "(non-member rate)" even
  when the correct member rate is the one being shown — see PRE-DEPLOY
  PUNCH LIST.
- **Customer quote editing — done** (migrations `040`/`041`/`042`,
  `src/routes/quote.tsx`, `src/routes/portal.tsx`; commits through `fd9bbb9`,
  2026-07-18). Full-form editing — a customer reopens `/quote?edit=<id>`
  fully pre-filled, including changing trip type, and re-submits. Matches
  the original spec on the parts that matter: the 1-week-before-trip lock
  with the "pushing the date later is still OK" exception, and any edit
  unconditionally revoking approval and re-notifying admin for re-review.
  **Deliberate scope cut, not a bug:** already-`scheduled` quotes (bus/
  driver assigned) cannot be edited at all yet — migration `040`'s header
  comment says this is deferred until the bus/driver unassign flow is
  confirmed with Melody. Works across all 5 trip types, including editing
  shuttle runs and multi-destination stops (migration `041`).

## PRE-DEPLOY PUNCH LIST (from the 2026-07-19 customer-flow audit)

Full customer journey (landing → quote form → estimate → address autofill →
submission → confirmation email → portal) was code-audited on 2026-07-19
ahead of deploying the customer-facing experience to `main`. Static/code
review only — not a substitute for the manual end-to-end testing in
priority 1 below. Tracking items here so they don't get lost before launch;
check off and remove as they land.

**Must fix before launch (customer-visible, cheap):**
- [ ] `quote.tsx:1088` — "Suggested bus" line hardcodes the label "(non-member
  rate)" even when a member school's correct discounted rate is being shown.
  Confusing/wrong for exactly the customers this feature was built for.
- [ ] `quote.tsx:973-975` — static "*All trips are a minimum of 4 hours."
  caption is shown unconditionally, contradicting the correct dynamic
  "2 hr minimum" row directly above it for member schools.
- [ ] Multi-destination's estimate card shows a generic "Your destination"
  placeholder (`destination` is never populated for this trip type) instead
  of the actual stop list/count.
- [ ] Quote-form validation is a hand-rolled `validateAll()` (no zod /
  react-hook-form despite that being this project's stated convention) that
  only checks non-empty — no email/phone format validation. A bad email
  silently kills that customer's own confirmation email.
- [ ] Confirm (don't assume) the Google Maps API key is actually set in the
  production environment. None was found anywhere in this repo, including
  `.env.local` patterns — `AddressAutocomplete` is correctly wired on every
  address field across all 5 trip types and degrades gracefully with no key
  (plain text input, no errors, never blocks submission), but that also
  means it may not be suggesting anything anywhere right now.

**Should fix before launch (real gaps, lower-visibility risk):**
- [ ] Portal quote-detail view only ever reads `quote_versions` — never
  `quote_shuttle_runs` or `quote_multi_stops`. Shuttle quotes show one flat
  time range instead of per-run detail; multi-destination quotes render a
  bare "—" for destination since the real data lives in `quote_multi_stops`.
- [ ] Confirmation (and other customer-facing) emails are still genuinely
  plain-text end-to-end (see "Polish the customer confirmation email"
  below) — already flagged as high-priority/near-urgent, still open.
- [ ] Client-side estimate preview has no overtime line (server applies
  overtime beyond 8 driver-hours; client doesn't show it) — long/full-day
  trips will preview lower than the real invoiced price.
- [ ] Submission failure shows the raw Postgres error string to the customer
  instead of a friendly message (`quote.tsx:589-593`).

**Cosmetic / fix whenever:**
- [ ] Dead `StepWrap` component in `quote.tsx` (leftover from the pre-single-
  page wizard), unused icon imports and a stray empty `<li>` on the
  homepage, and a stale doc comment in `QuoteFields.tsx` referencing a
  portal edit modal that doesn't exist (editing actually happens by
  reopening `/quote?edit=<id>`).

**Not re-verified by this audit — carry forward from priority 1/2 below:**
finishing interactive end-to-end testing of all 5 trip types, and
investigating the live reloading bug Melody reported on the currently
deployed `main` site.

## Operational items raised by Melody
- **Email notification to Melody on new quotes.** Note: `submit_quote`
  already queues a "New quote request" email to the office inbox on every
  submission (`_admin_email()`, reading `app_config.notify_admin_email` —
  currently `info@ccsta.ca`) using the existing Resend + `notify-send` edge
  function infrastructure (migrations 025/035) — this predates this session
  and isn't new work. What's actually unresolved: (a) confirm that inbox is
  one Melody watches, or point it at her personally instead/as well, and
  (b) confirm it's actually delivering — depends on `RESEND_API_KEY` being
  set and the edge function being deployed, both already flagged as
  outstanding action items above and tied to the undeployed-work item below.
- **Live reloading bug (investigate).** Melody reports the *currently
  deployed* site has reloading problems affecting real customers. Diagnose
  against what's actually live — the deployed version may differ
  meaningfully from work-in-progress in this repo (see deploy planning
  below). Priority: affects real bookings in progress right now.
- **Polish the customer confirmation email — HIGH PRIORITY, near-urgent.**
  The "we received your quote request" email (queued in `submit_quote` via
  `_queue_email`, migrations 025/035/037) needs a real pass before more
  customers start booking — it's the first thing a customer sees after
  submitting, and reflects on CCSTA. Needs:
  1. **Improved wording/tone** — current copy is functional, not polished.
  2. **Visual design/branding** (logo, real formatting) — **note on actual
     scope here:** this is genuinely plain text end-to-end today, not just
     plain-*looking*. `notify-send/index.ts` sends only `text: row.body` to
     Resend — no `html` field at all — and `notification_log.body`
     (migration `018`) is a single `text` column with no separate HTML
     body. Adding real branding means extending the edge function to also
     send an `html` field (Resend accepts both `text` and `html` in the
     same request) and giving `notification_log` somewhere to store HTML
     content — not just rewriting the string inside `submit_quote`.
  3. **Confirm it includes what the customer actually needs**: quote
     number, a trip summary, what happens next, contact info. Check
     against current content before rewriting rather than assuming it's
     missing something.
  - **Worth doing while in there, secondary priority:** review the other
    customer-facing emails for the same plain-text/branding gap and tone
    consistency — priced (`approve_quote`), rejected (`reject_quote`), and
    cancelled/cancellation-declined (`resolve_cancellation_request`, both
    branches). Note: `confirm_own_quote`'s email is *not* customer-facing —
    it notifies the office when a customer accepts a price, so it's out of
    scope here. The submission confirmation is still the one that matters
    most right now.
  - **Footer content (from Melody, 2026-07-19)** — use this in the HTML
    version once built:
    ```
    Melody Vanderwal
    CCSTA Admin
    778-986-9011
    Admin@ccsta.net
    [CCSTA logo image below the footer]
    ```
  - **Logo-hosting question — must resolve before adding the image.** Email
    clients can't render a locally-embedded file; the logo needs a public
    URL. `CCSTA LOGO.jpg` exists untracked at the project root but isn't
    hosted anywhere. Options when this is picked up: (a) upload it
    somewhere public (Supabase Storage bucket, S3, etc.) and use that URL;
    (b) skip the image for now and ship text-only branding in the footer;
    (c) check whether the live site already hosts this same logo (it
    presumably does, for its own header/favicon) and just point the email
    at that existing asset instead of hosting a new copy.
- **Deploy planning.** A full session's worth of work — new pricing,
  form rebuild, trip types, several migrations — is built but undeployed.
  When ready: deploy deliberately during low-traffic time, have a rollback
  plan ready, and verify first if at all possible. Real customers are
  actively using the live site, so this isn't a routine push.
- **Quote number alignment with the existing Excel system** *(backlog —
  not urgent, but affects reconciliation with CCSTA's book of record)*.
  The app auto-generates quote numbers (`Q-YYYY-####`) from a Postgres
  sequence (`quote_number_seq`, consumed in `submit_quote` — see
  migrations 011/025/035/037). These numbers need to align with the
  numbering CCSTA already uses in their existing Excel system, which has
  real quotes predating the app.
  - **Note on current state:** `quote_number_seq` is only ever
    *referenced* (`nextval(...)`) in the migrations that use it — it isn't
    actually defined (`CREATE SEQUENCE`) anywhere in this repo's migration
    history, meaning it was created directly against the live database at
    some point outside version control. Bringing its starting value under
    proper migration control (rather than a one-off manual
    `ALTER SEQUENCE`) is part of this work, not just a config tweak.
  - **Two parts:**
    1. **Correct starting point** — set/restart the sequence so new
       quotes continue from wherever the Excel system currently is,
       instead of restarting at 0001. **Confirm the exact current number
       with Melody before setting this** — getting it wrong in the wrong
       direction (e.g. reusing a number already in Excel) is worse than
       leaving it misaligned a while longer.
    2. **Admin-only manual edit** of a quote's number, so Melody can
       hand-align any individual quote that drifts.
  - **Safeguard (must-have, not optional):** if quote numbers become
    editable, enforce uniqueness — a duplicate quote number is worse than
    a mismatched one. Needs a friendly "that number's already in use"
    error on the edit, not just relying on a raw unique-constraint
    violation bubbling up.
  - **Scope when picked up:** find/formalize the sequence definition,
    make its starting value migration-controlled, add the admin-only edit
    field with a uniqueness check (likely a `UNIQUE` constraint on
    `quotes.quote_number` already exists as the enforcement backstop —
    confirm — plus a pre-check for a clean error message).

## Still on the backlog (planned, not built)
- ~~Single-page quote-form redesign (fewer pages, "show more" buttons).~~
  **Done** — shipped via `e57417f` (collapsed the 4-step wizard into one
  scrolling page) and `55d40a0` (card-based redesign). This bullet was
  never removed when it landed.
- Address autofill reliability + a clear "driver time will be added on the invoice" notice.
- **Admin page redesign (to Melody's preferences)** *(its own focused
  session — not a quick tweak)*: the admin/dispatch view works and has
  the right info, but its layout/design should be reworked to match how
  Melody actually wants to review quotes and manage bookings. A design
  project like the customer quote-form redesign was (see the single-page
  redesign item above) — gather her specific preferences on what she
  needs to see, in what order, and how it should look, then redesign
  around that, rather than guessing.
  - **Not the same thing as:** the multi-destination stops display
    (showing every stop's destination + address + arrival/departure time)
    being built as a functional addition in the near term. That's a
    content addition to the existing layout; this item is the broader
    visual/layout redesign, deferred and separate.
- ~~Member 2-hour vs. others 4-hour minimum billing.~~ **Done** — see
  "Recently completed" above (commit `5e9016d`). Client-side preview now
  matches server-side pricing for member schools.
- **MEMBER SPECIAL PRICING TIERS** *(needs clarification before building)*: the
  2026-2027 rate sheet (`2026-2027 Multiple Trip Quote Template Draft 2.xlsx`,
  "2026-2027 Rates" tab) has two special tiers beyond the plain
  member/non-member/church-by-bus-size rates already wired into
  `calculate_estimate`:
  - **"Member w/i 1hr"** ($63 / $78.75): applies to a member trip "within 1
    hour" — UNCLEAR whether that's 1hr driving distance or 1hr total trip
    duration, and what the two numbers ($63/$78.75) each represent. Check the
    sheet + confirm with Melody.
  - **"Driver Only"** ($47.25): when only a driver is needed, no bus. No
    "driver only" option exists on the form — unclear if this comes through
    self-serve or is Melody-applied only.
  - **Desired behavior once clarified:** auto-apply the tier + flag it
    visibly for Melody to confirm (these are exceptions that shouldn't apply
    silently).
  - **Do NOT build until the rules are confirmed — mis-charging risk.**
- Hourly driver availability + bus availability windows.
- Parent bus-tracking portal.
- 5% first-online-quote discount.
- **Address autofill with saved favorites:** as customers type pickup/destination
  addresses, show selectable suggestions for accuracy and less manual entry. Seed
  it with our Excel list of known customer/school/destination addresses as saved
  favorites, layered on top of a general address-lookup service.
- **Calendar/availability system** *(build next, now that trip types is
  done — see Recently completed)*: customers pick a date/time and the
  system checks it against fleet (buses + drivers) availability, showing
  color-coded slots — green = available, grey = a trip's already submitted
  for that slot and under review, red = unavailable (must pick a different
  day/bus/driver). The trip-type time-slot data (including shuttle's
  per-run times in `quote_shuttle_runs`) was built calendar-readable from
  the start for exactly this.

- **Multi-destination schedule feasibility validation** *(future —
  deferred; simpler version — just collecting arrival + departure times
  per stop — was built first)*: validate that the times a customer enters
  for multi-destination stops are physically possible. For each
  consecutive pair of stops, calculate the actual travel time between them
  and warn the customer if an entered arrival time is impossible given the
  drive from the previous stop (e.g. leaves stop 1 at 10:00, stop 2 is a
  45-min drive away, but they entered a 10:15 arrival at stop 2).
  - **Useful head start:** the OSRM multi-waypoint request already built
    for distance (`MultiStopRouteMap.tsx`) returns a `legs` array with
    per-leg `duration`, not just the total — the travel-time data this
    needs is already coming back from the routing call, just unused today.
    Building this is mostly validation/UX (comparing entered times against
    those durations and surfacing a warning), not a new data source.
  - Complex enough to defer: real-world buffer time at each stop, what
    counts as "close enough" vs. an error, and whether an infeasible
    schedule should block submission or just warn (Melody flags it) all
    need deciding before building.

- ~~Customer quote editing.~~ **Done** — see "Recently completed" above
  (migrations `040`–`042`). Open item carried forward: already-`scheduled`
  quotes still can't be edited, pending Melody's decision on how bus/driver
  unassignment should work — pick this up as a small follow-on, not a full
  re-plan.
