# Pipeline plan: Approved → Completed → Invoiced

Written 2026-08-04 with Mila. Covers what happens to a quote after it's
approved, which is the part of the system that has never actually run.

**Grounding fact: `trips` has zero rows.** 37 active drivers, 28 buses and 108
clearance records are real and loaded, but no trip has ever been created. Every
stage below is untested against reality, so this plan assumes nothing works
until it's been run once with a real trip.

---

## What already exists

More than expected. Worth knowing before building anything new.

| Piece | State |
|---|---|
| `suggest_assignment(quote)` | Works. Filters by bench size, clearance, air-brake cert, availability, same-day conflicts. |
| `confirm_trip(quote, driver, bus)` | Works. Creates the trip. |
| `trips.actual_departure / actual_return / odometer_start / odometer_end` | Columns exist. **Nothing ever writes them.** |
| `trips.pretrip_checklist` | Written by the driver app. The only thing the driver app writes. |
| Driver app (`driver.tsx`) | Exists. Shows today's trips, pre-trip checklist. No time capture. |
| `invoices` incl. `sage_export_data` | Table exists, 1 row. Not wired to actuals. |
| Samsara | `samsaraApiToken` slot, `samsara_vehicle_id` on all buses, `samsara_geofence_id` on yards. **No API calls anywhere.** |
| `driver_no_pair_constraints` | Table exists. Nothing reads it. |

---

## Stage 1 — Approved → assigned

### What's wrong now

1. **Everything is day-level.** A driver on a 7–10am run is marked busy for the
   whole day and won't be suggested for a 1pm trip. Same for buses. With 37
   drivers this invents scarcity that doesn't exist. This is the single biggest
   constraint on assignment quality.
2. **Multi-bus can't be assigned.** `calculate_estimate` returns `bus_count`
   which can be 2+, but `confirm_trip` takes one driver and one bus. Mila
   confirmed multi-bus trips happen **regularly**, so this is a real blocker,
   not an edge case.
3. **Suggestions are unranked.** Every eligible driver × every eligible bus,
   which can be hundreds of rows with no guidance.
4. **Home yard is ignored.** A Ladner driver can be suggested for an Abbotsford
   trip. This now costs money, because driver time is measured from the yard.
5. **`driver_no_pair_constraints` is dead.** Whatever it encodes — drivers who
   shouldn't work together — is being ignored.

### Proposed

- **Time-windowed availability and conflicts.** Replace the date-equality
  checks with overlap checks against the trip's actual window, widened by the
  driver time either side. Requires `driver_availability` to gain start/end
  times (it currently has `date` + `status` only). This unblocks both this
  stage and Mila's "hourly driver availability" backlog item — same change.
- **One quote → many trips.** A `trips` row per bus, sharing `quote_id`. Keeps
  the driver app unchanged (each driver sees their own trip) and makes the
  invoice a sum over trips.
- **Rank suggestions** rather than listing them: same yard as the trip first,
  then fewest recent trips (spreads work), then clearance headroom (don't put
  the only 56-cleared driver on a 47 run if a 47-only driver is free).
- **Honour no-pair constraints** on multi-bus assignments.

**Answered 2026-08-04:** `driver_no_pair_constraints` is two specific drivers
with a personal conflict who are never sent on a field trip together. So the
rule is per-trip, not per-vehicle, and it only bites on multi-bus trips — which
are regular. It's a small table with real consequences, and it's currently
ignored.

---

## Stage 2 — Completed → what actually happened

This is the hard one, and the reason invoices can't be accurate today.

### The reality, in Mila's words

- Drivers **leave the yard earlier than they need to**, then sit at the
  location. So "bus started moving" is not "trip started".
- Drivers **forget to log off**. You can see movement stop, but not when they
  got back to the yard.
- Reconstructing what happened **requires piecing together several signals**
  and interpreting them.
- They're trying to get drivers to leave notes in Samsara when something goes
  wrong, but **the drivers are older and not tech-forward**, so note-taking
  can't be depended on.

### The design principle that follows

**Samsara proposes, Melody confirms. Never bill directly from raw telematics.**

Any design that assumes the driver did the right thing will produce wrong
invoices, and wrong invoices to schools are expensive in trust. The system's job
is to do the piecing-together Mila described, show its work, and be honest about
how confident it is.

### Two more complications, added after Mila described the day properly

**Driver attribution is unreliable; vehicle location is not.**
Buses switch drivers mid-day, and if a driver doesn't log on properly Samsara
will report them somewhere they weren't. So driver identity from Samsara can't
be trusted for billing. The *vehicle* is trustworthy — a bus is where it is
regardless of who claims to be driving it.

Which is fine, because we don't need Samsara to tell us who was driving. The
assignment already knows. Samsara only has to answer "where was bus 53, and
when" — the question it's actually good at.

**A field trip is a segment of the bus's day, not the whole day.**
Buses run the morning school route, then a field trip, then the afternoon route.
So there is no clean "the bus went out and came back" signal to read; there's a
continuous stream of movement and the field trip is a slice of it. Mila: "it's
kind of tricky to decode what is what."

The way through is that we already know the slice: the assigned bus plus the
scheduled window bounds which movements belong to this trip. Reconstruction is
therefore "interpret bus X's movements between roughly these times", not "figure
out what bus X did today".

**A payoff worth noting.** That same route-then-field-trip pattern is exactly the
case the pre-trip waiver exists for (migration 064) — if the bus already ran the
morning route, the pre-trip was already done and shouldn't be billed. Once
Samsara is connected, that's *detectable*: a bus that was already moving that
morning almost certainly had its pre-trip done. So the waiver Melody toggles by
hand today can later be suggested automatically, with her still confirming.

### The log-off problem is more solvable than it looks

"They forget to log off, so you don't know when they got back to the yard" —
but you don't need the driver for that. **The yard has a geofence.** The bus
crossing into the yard boundary *is* the return, whether or not anyone logged
off. `yards.samsara_geofence_id` exists for exactly this and is currently null
for all four yards.

Mila confirms Samsara already reports arrival at the yard — it says they're back,
and merely keeps showing the driver on duty afterwards. So the return timestamp
is already in the data; what's missing is anything reading it. The stale on-duty
status is a driver-side artefact and can be ignored, because the billable event
is the vehicle arriving, not the driver clocking off.

Same trick separates "left early and sat" from a real start: geofence exit from
the yard, geofence arrival at the destination, and the scheduled pickup time are
three different timestamps, and having all three is what lets you tell the
difference.

So the capture design is:

| Signal | Source | Used for |
|---|---|---|
| Yard geofence exit | Samsara, **vehicle** | Driver time out, real start |
| Arrival at pickup | Samsara GPS vs pickup address | Distinguishes "left early" from "started early" |
| Departure from destination | Samsara, **vehicle** | Trip end |
| Yard geofence entry | Samsara, **vehicle** | Driver time back — **works even if the driver never logs off** |
| Assigned bus + scheduled window | Our own data | Slices the field trip out of a day that also contains routes |
| Who was driving | **Our assignment, NOT Samsara** | Samsara's driver attribution breaks on switches and bad log-ons |
| Driver note | Samsara, optional | Explaining exceptions. Nice to have, never required. |

### What Melody sees

A completion screen per trip showing planned vs reconstructed, each timestamp
with where it came from, and anything the system couldn't resolve flagged rather
than guessed. She adjusts and confirms. The confirmed numbers — not the raw
ones — are what the invoice uses.

**Open:** does Samsara give clean geofence enter/exit events on your plan, or
only a location stream we'd have to derive them from? This determines whether
this is a small integration or a real one.

---

## Stage 3 — Invoiced

### The nuance that shapes everything

Mila: they like to charge accurately, and if a trip runs over — traffic, or the
group leaving late — that's chargeable. **But elementary schools collect money
from parents based on the estimate.** Going back afterwards for more doesn't
work, so CCSTA eats the difference.

That's not a formula about trip length. It's a property of **the customer**:
some schools can absorb a corrected invoice and some structurally cannot.

### Proposed

- A per-school flag — `estimate_is_binding` — meaning "this school pre-collects,
  the quote is a ceiling".
- Invoice logic:
  - compute the true cost from confirmed actuals
  - if the school's estimate is binding → **bill the quoted amount**, and record
    the difference as *absorbed*
  - otherwise → bill actual, with the variance itemised so it can be explained
- Melody can override either way; the flag sets the default, not the answer.

### Why the absorbed figure is the valuable part

Every dollar absorbed is a dollar that was quoted wrong. Right now that's
invisible — the cost is eaten and never counted, so there's no signal about
where quoting is systematically off.

Recording it turns it into a report: which schools, which trip types, which
destinations run over most. **That's the business case for the accurate driver
time we just built** — on binding-estimate schools, quote accuracy isn't a
nicety, it's the only chance to charge correctly at all. Once the trip is over,
the money is gone.

Worth building the absorbed-cost tracking even before the fancier parts, because
it's cheap and it tells you where to aim.

### Format — Simply Accounting

Confirmed 2026-08-04: invoicing is done in **Simply Accounting**, which is now
Sage 50 Canadian Edition. That matches the existing `invoices.sage_export_data`
column.

Mila had researched importing and come up short. Likely reason: **Sage 50
Canadian imports transactions as `.IMP` files, not CSV.** Almost everything
findable about "importing invoices into Sage 50" describes the *UK* product,
which is a different application with a different import system (CSV via Audit
Trail Transactions). Following UK instructions on the Canadian edition doesn't
work, and nothing says so.

What the Canadian edition supports:

- `.IMP` is a plain-text ASCII format, imported through Sage 50's import wizard.
- Sales invoices, sales orders, purchase invoices, quotes and time slips can all
  be imported this way.
- The customer must already exist in Sage, or the import stops and asks.
- Known limitations: customer discount percentages don't come through, and if GL
  account details are omitted Sage prompts for each transaction manually — so
  the export should include GL accounts or the "automation" still involves
  clicking through every invoice.

That makes generating `.IMP` a realistic target: it's a text format we control,
and school records already exist in the database to match against Sage customers.

**What actually went wrong before (2026-08-04):** Mila doesn't remember the
specifics, but recalls it being a formatting problem and believed Sage needed
"a specific CSV format". That is itself the likely explanation — the Canadian
edition wants `.IMP`, and every findable guide pushes you toward CSV because
they're describing the UK product. Not worth reconstructing further.

**Update 2026-08-05:** Simply Accounting wouldn't let Mila export an invoice.
Didn't matter — Sage publishes the `.IMP` specification, including a worked
`<SalInvoice>` example, so the format is known without needing an export.

A test file now exists at `sage-import-test.IMP`, built from that spec using
CCSTA's real rate config. It must be imported into a BACKUP company file, not
the live books: a successful import creates a real invoice.

Three fields in it are inferred rather than confirmed, because Sage documents
the field tables as images:
  - version number (32101 = Sage 50 2025; older versions differ)
  - the payment-method fields on the options line
  - whether a single tax authority (GST, no PST) is accepted

Any error is useful — a complaint about a specific field is more information
than the previous attempt ever produced.

**Likely explanation for the original failure:** Sage 50 Canadian DOES import
CSV, but only for *records* — customers, vendors, inventory. Transactions
require `.IMP`. So CSV appears to work, which makes it look like the right path
right up until invoices won't go.

Worth doing EARLY rather than in sequence order. Every other item in this plan
is under our control; the Sage import is the one piece that could turn out to be
a dead end, and a one-file experiment settles it before anything is built
toward it.

**Still open:**
- Does the school need a document showing the variance, or only the amount owed?
- Do the school names in the database match the customer names in Sage? A name
  mismatch is the most likely thing to break an otherwise working import.

---

## Suggested order

1. **Time-windowed availability** — unblocks assignment, and it's the backlog
   item Mila already wanted.
2. **Multi-bus assignment** — confirmed as regular, and it changes the data
   shape, so doing it before anything downstream avoids building twice.
3. **Manual completion screen** — planned vs actual, typed by Melody. Deliberately
   before Samsara: it makes the pipeline runnable end to end, and Samsara then
   becomes a way to pre-fill a screen that already works rather than a
   dependency.
4. **Invoice from confirmed actuals**, with the binding-estimate flag and
   absorbed-cost tracking.
5. **Samsara integration** — geofences first, since those solve the log-off
   problem and need no driver behaviour change.

Putting Samsara last is deliberate. It's the piece with an external dependency,
an unknown API surface, and the least certainty — and everything above it is
useful without it.
