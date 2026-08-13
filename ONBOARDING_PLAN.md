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

**Status: `invite-driver` exists** and creates the account, the `drivers` row and
the profile role in one call.

### The constraint that should drive every decision

Mila: the drivers are **older and not tech-forward**. Notes in Samsara can't be
depended on. That's why the availability grid uses taps and drags rather than
typed times, and why the driver app does one thing per screen.

Onboarding has to assume: no training session, no manual read, possibly a phone
they're not comfortable with. If a step can be skipped by the office doing it
instead, it should be.

### The sequence

1. **Office side, before the driver touches anything**
   - `invite-driver` with name and email
   - set `driver_bus_clearances` (which bench sizes they're cleared for) —
     108 rows already exist for the current roster
   - set `home_yard_id` — this now affects recommendations, since same-yard
     drivers rank first
   - `air_brake_cert`, `trip_type` (field trip / route / both)
2. **Driver side, first login**
   - accept the invite, set a password
   - see today's trips
   - mark availability
3. **Ongoing**
   - pre-trip checklist per trip
   - availability, ideally including their route hours so they aren't offered
     field trips that clash

### The honest risk

Step 3 depends on drivers maintaining their own availability, and the whole
premise is that they may not. Two mitigations, one built:

- **Built:** an admin can now edit any driver's availability from the same grid
  (the driver-picker added 2026-08-11). Melody can fill it in for anyone who
  won't.
- **Not built:** route hours are the predictable part of a driver's week and
  could be imported once rather than entered weekly. Worth doing when the
  route data arrives — it's the single biggest reduction in what drivers have
  to do themselves.

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
