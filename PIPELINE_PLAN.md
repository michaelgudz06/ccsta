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

**Open:** what `driver_no_pair_constraints` actually means operationally — is
it "never on the same trip" or "never in the same vehicle"?

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

### The log-off problem is more solvable than it looks

"They forget to log off, so you don't know when they got back to the yard" —
but you don't need the driver for that. **The yard has a geofence.** The bus
crossing into the yard boundary *is* the return, whether or not anyone logged
off. `yards.samsara_geofence_id` exists for exactly this and is currently null
for all four yards.

Same trick separates "left early and sat" from a real start: geofence exit from
the yard, geofence arrival at the destination, and the scheduled pickup time are
three different timestamps, and having all three is what lets you tell the
difference.

So the capture design is:

| Signal | Source | Used for |
|---|---|---|
| Yard geofence exit | Samsara | Driver time out, real start |
| Arrival at pickup | Samsara GPS vs pickup address | Distinguishes "left early" from "started early" |
| Departure from destination | Samsara | Trip end |
| Yard geofence entry | Samsara | Driver time back — **works even if the driver never logs off** |
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

### Format

`invoices.sage_export_data` suggests Sage was the intended destination.

**Open:** what does the accountant actually need — a Sage import file, a PDF per
school, a monthly summary? And does the school need a document showing the
variance, or just the amount owed?

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
