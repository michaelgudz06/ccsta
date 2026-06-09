# Fraser Valley School Bus — Data Request for Curtis
**Prepared by:** Michael  
**Date:** June 2026  
**Purpose:** Seed the new booking platform with accurate real-world data. Everything marked *(estimated)* is a placeholder I used to build the system — please correct any that are wrong.

---

## 1. Bus Yard Locations

We need the address and GPS coordinates for each yard. The system uses these to calculate drive time to/from schools and apply out-of-radius surcharges.

| Field | Format | Example |
|---|---|---|
| Yard name | Text | Surrey Main |
| Street address | Full civic address | 8888 162 Street, Surrey, BC |
| Postal code | Canadian postal code | V4N 3G1 |
| Latitude | Decimal degrees | 49.1732 |
| Longitude | Decimal degrees | -122.7533 |
| Is this the primary/default yard? | Yes / No | Yes |

**Currently in the system (needs confirmation):**
- Surrey Main — 8888 162 Street, Surrey, BC, V4N 3G1

> **Please provide:** Confirm this address is correct. Add any other yard locations. GPS coordinates can be found by right-clicking the address in Google Maps → "What's here?"

---

## 2. Bus Fleet

One row per bus. We use the **bench count** (number of bench seats, not total passenger seats) to match buses to trips.

| Field | Format | Notes |
|---|---|---|
| Fleet / unit number | Text | e.g. Bus 14, Unit 22 |
| Bench count | Number | 18, 47, or 56 |
| Requires air-brake certified driver? | Yes / No | Usually yes for 47 & 56 |
| Serial / VIN | Text | Optional — for records |
| Samsara vehicle ID | Text | From Samsara dashboard — needed for GPS tracking |
| Home yard | Yard name from Section 1 | e.g. Surrey Main |
| Active / in service? | Yes / No | |
| Notes | Text | e.g. "AC, wheelchair lift, out for inspection until Jul 1" |

**Example format (one row per bus):**

| Fleet # | Bench count | Air brake req | VIN | Samsara ID | Home yard | Active | Notes |
|---|---|---|---|---|---|---|---|
| Bus 14 | 18 | No | 1BABNBKA... | abc123 | Surrey Main | Yes | |
| Bus 22 | 47 | Yes | | | Surrey Main | Yes | AC unit |

---

## 3. Drivers

One row per driver.

| Field | Format | Notes |
|---|---|---|
| First name | Text | |
| Last name | Text | |
| Email | Email address | Used for login and notifications |
| Phone | 604-555-0100 format | Used for day-of contact and SMS alerts |
| Air-brake certified? | Yes / No | |
| Trip types | Route / Field Trip / Both | What types of trips can they do? |
| Home yard | Yard name from Section 1 | |
| Samsara driver ID | Text | From Samsara dashboard |
| Notes | Text | e.g. "First aid certified", "Part-time — 3 days/week" |

**Example format:**

| First | Last | Email | Phone | Air brake | Trip types | Home yard | Samsara ID | Notes |
|---|---|---|---|---|---|---|---|---|
| Barry | Smith | barry@example.com | 604-555-0101 | Yes | Both | Surrey Main | drv_abc | |
| Judy | Lee | judy@example.com | 604-555-0102 | Yes | Route | Surrey Main | drv_def | Part-time |

---

## 4. Driver–Bus Clearances

Which bus sizes is each driver cleared/licensed to operate? A driver can be cleared for multiple sizes.

| Driver full name | Bus sizes they are cleared for |
|---|---|
| Barry Smith | 18, 47, 56 |
| Judy Lee | 47 |
| Sam Jones | 18 |

*(Just list all the bench counts: 18, 47, 56)*

---

## 5. Driver Pairing Restrictions

Are there any pairs of drivers who **cannot be scheduled on the same day** (e.g. due to personal conflicts, union rules, or company policy)?

| Driver A | Driver B | Reason (optional) |
|---|---|---|
| Barry Smith | Judy Lee | Personal conflict |

If there are none, just write "None."

---

## 6. Member Schools

Schools we have existing relationships with. The booking form creates new schools automatically when a customer types their school name, so this list is for pre-populating the database (so their name auto-matches).

| Field | Format |
|---|---|
| School name | Official full name |
| Street address | Full civic address |
| City | Text |
| Postal code | Canadian postal code |
| School district | e.g. SD36 Surrey |
| Primary contact name | Text |
| Primary contact email | Email |
| Primary contact phone | 604-555-0100 |
| Member school? | Yes / No |
| Notes | Any special notes |

---

## 7. Pricing — Hourly Rates

We use bench count (18 / 47 / 56) as the bus size tier for pricing.

**Currently in the system *(estimated — please correct)* :**

| Bus size | Hourly rate | Minimum hours | Minimum charge |
|---|---|---|---|
| 18-bench mini-bus | $95 / hr | 2 hrs | $190 |
| 47-bench coach | $125 / hr | 2 hrs | $250 |
| 56-bench coach | $145 / hr | 2 hrs | $290 |

> **Please provide:** The correct hourly rate, minimum hours, and minimum charge for each bus size.

---

## 8. Pricing — Surcharges & Config

**Currently in the system *(estimated — please correct)* :**

| Setting | Current value | What it means |
|---|---|---|
| Fuel surcharge | 5% | Percentage added to the base fare on every trip |
| Out-of-radius threshold | 50 km | Distance from the Surrey yard before a per-km charge kicks in |
| Out-of-radius rate | $2.50 / km | Per-km charge beyond the threshold |
| Driver pre-trip buffer | 15 min | Extra minutes added to driver hours before each trip (for pre-trip inspection, yard departure, etc.) |
| Admin buffer | 0% | Optional markup % on estimates (currently off) |

> **Please provide:** Correct values for any of these that are wrong. If there are other fees or surcharges (weekend rates, holiday rates, after-hours, parking reimbursement, etc.) please list them too.

---

## 9. API Keys & Credentials

These are needed to enable specific features. Each one has a placeholder slot already set up in the system.

| Service | What it's used for | What I need from you | Status |
|---|---|---|---|
| **Google Maps** | Calculating driving distance and time between the yard and destination (for accurate hour estimates) | A Google Maps API key (Platform → Directions API enabled) | Needed for Phase 2 estimate engine |
| **Samsara** | Live bus GPS tracking, geofencing — show dispatchers where buses are in real time | Samsara API token (from Samsara dashboard → Settings → API Tokens) | Needed for Phase 5 |
| **Email (SMTP)** | Automated emails — quote received confirmation to school, approval notice, trip details | SMTP host, port, username, password, and the "from" email address (e.g. bookings@fraservalleybus.ca) | Needed for Phase 4 |
| **SMS** | Text message alerts to drivers when a new trip is assigned to them | SMS provider and API key (e.g. Twilio, SimpleTexting, etc. — or let me know what you currently use) | Needed for Phase 4 |

---

## 10. Existing Quote / Invoice Reference

If you have sample quote PDFs or confirmation sheets that go out to schools, please send them. The system will eventually generate these documents automatically and I want them to match your current format exactly.

Similarly, if you have a Sage 50 invoice template or know the exact field layout Sage expects for the import, that will help me build the export correctly.

---

## How to Send

The easiest formats:
- **Spreadsheet** (Excel or Google Sheets) — one tab per section above
- **Email with the corrections** typed inline — for small things like pricing
- **PDFs of existing documents** — for quote templates and Sage formats

Send to: **[your email here]**

---

*Built with: TanStack Start · Supabase · Vercel*  
*Questions? Michael can explain any field in more detail.*
