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

## Still on the backlog (planned, not built)
- Single-page quote-form redesign (fewer pages, "show more" buttons).
- Address autofill reliability + a clear "driver time will be added on the invoice" notice.
- Member 2-hour vs. others 4-hour minimum billing — **partially done**: server-side
  pricing (`calculate_estimate`) already applies the correct 2hr/4hr floor by
  membership. Still open: the customer-facing quote-form estimate (`quote.tsx`'s
  client-side preview) hardcodes a 4-hour minimum regardless of membership, since
  it has no way to know the school's member status before submission.
- Hourly driver availability + bus availability windows.
- Parent bus-tracking portal.
- 5% first-online-quote discount.
- **Address autofill with saved favorites:** as customers type pickup/destination
  addresses, show selectable suggestions for accuracy and less manual entry. Seed
  it with our Excel list of known customer/school/destination addresses as saved
  favorites, layered on top of a general address-lookup service.
- **Calendar/availability system:** customers pick a date/time and the system
  checks it against fleet (buses + drivers) availability, showing color-coded
  slots — green = available, grey = a trip's already submitted for that slot and
  under review, red = unavailable (must pick a different day/bus/driver).
