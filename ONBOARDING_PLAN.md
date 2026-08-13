# Onboarding plans — admins, drivers, parents

Written 2026-08-11 with Mila. Three separate audiences with almost nothing in
common except that they all start with "someone gets an account".

---

## 1. Admins — Curtis and Melody

**Status: the mechanism is built.** `invite-admin` is deployed, and the admin
dashboard has a collapsed "Invite an admin" control.

Two invites to send: `accounting@ccsta.net` (Curtis) and `admin@ccsta.net`
(Melody).

### The known compromise

`admin@ccsta.net` is the shared alert inbox — it already receives every
new-quote notification. Mila chose it deliberately over a personal address. The
consequences, recorded so nobody rediscovers them:

- anyone who can read that mailbox can claim the invite and become an admin
- every action Melody takes is attributed to a generic address, so the audit
  trail can't distinguish her from anyone else using it
- it's the mailbox most likely to be open on a shared office screen

Worth revisiting if the team grows past three people.

### What each of them actually needs to learn

They have different jobs, so a single walkthrough would waste both their time.

**Melody — pricing and dispatch.** The trip sheet is her whole world:
- editing the VARIABLES (hours, rate, bus size and count) rather than typing
  over totals — this is the thing most likely to be misunderstood, because the
  old habit was overwriting the dollar figure
- the pre-trip waiver, and when it applies (bus already ran a route that morning)
- picking the yard, and that it changes the price because driver time is
  measured from there
- ★ suggestions for driver and bus are RANKED, not rules — she can override
- Recalculate vs just viewing: opening a quote previews, only Recalculate saves

**Curtis — money and reconciliation.** Different surface entirely:
- the invoicing pipeline (once built — see PIPELINE_PLAN.md)
- the `.IMP` Simply Accounting import, which he still hasn't tested
- absorbed cost: which trips ran over and weren't billed for it

### Not yet built

Nothing gates a new admin from the parts they shouldn't touch. There's one
`admin` role and it sees everything. Fine at three people; revisit before it's
five.

---

## 2. Drivers

### The problem, restated by Mila (2026-08-12)

> "a lot of them are old and I fear they won't use the scheduling / trip info"

That's the correct fear, and it's the thing to design around rather than train
against. A second app that only matters occasionally is the app that doesn't get
opened.

### The answer: don't add an app, use the one they already open

Drivers already sign into **Samsara** every day to log on and track hours. The
Samsara Driver App shows them the route dispatch has assigned. So the trip sheet
should go THERE, not into a CCSTA app they'd have to remember exists.

Confirmed against Samsara's API docs, 2026-08-12:

- the Routing API creates a route with stops and assigns it to a **driver or a
  vehicle**
- assigned routes appear in the Samsara Driver App for whoever is signed into
  that vehicle
- route-level and stop-level `notes` fields carry free text — the trip sheet
  content (times, contact, special requests) fits here
- documents can be attached to a stop as a driver task, if a signature or form
  is ever needed

### The detail that makes this cheap

**Assign to the BUS, not the driver.**

Checked against our own data: all **28 active buses have `samsara_vehicle_id`**
populated. **Zero of 37 drivers have `samsara_driver_id`** — the column exists
and was never filled in.

Since Samsara shows a vehicle's route to whoever is signed into it, and signing
in is something drivers already do, assigning by vehicle works with data we
already hold. Assigning by driver would mean mapping 37 people to Samsara IDs
first, for no benefit.

### What this does to the CCSTA driver app

Worth facing directly: if Samsara carries the trip sheet, most of the driver app
has no reason to exist. What's left is

- **availability** — and the premise is that drivers may not maintain it. Melody
  can now edit anyone's (built 2026-08-11), and route hours could be imported
  once the route data arrives.
- **pre-trip checklist** — Samsara already does driver vehicle inspection
  reports. Worth checking whether ours duplicates something they already do
  daily, because two checklists means one gets ignored.

The honest conclusion is that driver onboarding may need almost no CCSTA
software at all. Melody assigns in the CCSTA admin; the driver sees it in the
app they already use. That is a much better outcome than a well-designed driver
app nobody opens.

### Sequence to build it

1. **Samsara API token** into Supabase edge function secrets. The
   `SAMSARA_API_TOKEN` slot exists in `config.server.ts` and is unset. Same rule
   as the Google key: a secret, not `.env`.
2. **`push-trip-to-samsara` edge function.** On confirm_trip, create a Samsara
   route: start at the yard, stop at pickup, stop at destination, assigned to
   the bus's `samsara_vehicle_id`, with the trip sheet in the notes.
3. **Store the returned Samsara route id** on `trips`, so a changed trip updates
   the same route instead of creating a second one.
4. **Handle cancellation** — a cancelled trip must delete its Samsara route, or
   a driver turns up for a trip that isn't happening. This is the failure mode
   worth testing hardest.

### Still true regardless

Office-side setup before a driver can be used at all: clearances, home yard,
air-brake, field-trip vs route. Built 2026-08-12 in the admin roster, with a
"Setup incomplete" badge because a driver with no clearances is silently
invisible to dispatch.

---

## 3. Parent portal

### What it actually is

Not a tracking system. Samsara already does the tracking, and CCSTA already
sends parents share links. Today those links go out by email and parents dig
through their inbox every morning to find them.

The portal replaces "find the email" with "log in to ccsta.net". That's the
whole problem being solved, and it's worth being precise about that because it
sets the size of the build.

### The thing to be honest about

**The Samsara links stay public.** Anyone holding the URL can watch the bus,
logged in or not. A login makes the links FINDABLE, not private. If a parent
forwards one, nothing stops the recipient.

So the login is a convenience feature wearing the costume of a security feature.
That's fine — convenience was the actual complaint — but nobody should believe
the portal protects student location data, because it doesn't. The only real fix
is rotating the Samsara links, which is a Samsara question, not a code one.

### Decisions taken (Mila, 2026-08-11/12)

- **Links are per school**, not CCSTA-wide.
- **Parents are INVITED, not allowlisted.** CCSTA emails each parent a signup
  link; only someone holding a link can register. This works because CCSTA
  already emails parents the Samsara links today, so the parent addresses
  already exist — no new thing to ask schools for.
- **Student rosters WILL be stored.** Schools give CCSTA a list of students per
  route, updated every September. Mila wants this in the system because knowing
  who should be on each bus is useful beyond the portal.

### Built (074)

`school_routes` — school, label, Samsara URL, sort order, active.

Deliberately NOT public-read, unlike `yards` and `rate_config`. A Samsara share
link is a live position feed for a bus carrying children, and the link itself is
the only thing protecting it. Verified that an anonymous caller reads zero rows
before any real link goes in. Parent read access comes with the parent role,
scoped to their own school.

This is useful before any parent logs in: the links stop existing only inside
sent emails, and a changed link changes in one place.

### Still to build

1. `parent` role + invite flow (mirrors invite-admin: token by email, land on
   set-password, bind to one school)
2. `/parent` page — that school's active routes, nothing else
3. Parent read policy on `school_routes`, scoped to their school
4. Student roster — see the obligations below

### Student rosters: what storing them commits CCSTA to

Worth being explicit, because this is the first genuinely sensitive data in the
system. Quotes and invoices are business records. A list of children's names,
tied to a school and to which bus they ride each day, is data about identifiable
minors and their daily movements.

Under BC privacy law that carries obligations the rest of this app doesn't have:

- **Purpose limitation.** Collected to run transport. Not for anything else, and
  the table shouldn't quietly become a mailing list.
- **Retention.** Rosters are replaced every September. Old ones should be
  deleted or archived on a defined schedule, not left to accumulate — "we still
  have the 2024 roster" is a liability with no upside.
- **Access.** Today there is ONE admin role that sees everything. A roster of
  children probably shouldn't be visible to whoever is doing invoicing. This is
  the strongest argument yet for splitting the admin role.
- **Breach handling.** If this leaked, the notification obligations are
  different from a leaked quote.

None of that blocks building it. It does mean the roster table should be
designed with a year stamp and a deletion policy from the first migration,
rather than retrofitted once there are four years of children in it.

## Open questions

- Do the same three route types apply at every school, or do some have only AM
  and PM? (`school_routes` allows any number with any labels, so this is a data
  question, not a schema one.)
- How long should a student roster be kept after the year ends?
- Should the roster be visible to every admin, or only some?
- Should a parent with children at two schools see both? The model above binds
  a parent to one school.
- Can Samsara links be rotated or expired? If so, the honesty caveat above gets
  much smaller.
