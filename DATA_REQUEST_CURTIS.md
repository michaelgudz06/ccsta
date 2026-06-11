# CCSTA Platform — Remaining Data Request for Curtis
**Updated:** June 2026  
**Prepared by:** Michael  
**Purpose:** Track what is still needed to finish the platform. Everything marked ✅ is already confirmed in the system — no action needed on those.

---

## Already done — no action needed

| Section | What's in the system | Source |
|---|---|---|
| ✅ Hourly rates | Non-member, member, and church rates for all three bus sizes (2026-2027 season) | Rate sheet / quote template |
| ✅ Surcharges | Fuel ($50 flat/trip), long-distance ($1/km beyond 200km), overtime ($16/hr beyond 8h), GST 5% (GST# 129645727), 10-min driver buffer | Rate sheet |
| ✅ Destinations | ~100 pickup/destination locations with pre-calculated drive times from the Surrey yard | Quote template "Destinations" sheet |
| ✅ Schools & companies | ~100 schools and organisations with contact info and member flags | Quote template "Companies" sheet |
| ✅ Yard location | Surrey Main — 8888 162 Street, Surrey, BC V4N 3G1 | Confirmed |

---

## Still needed — please provide

### 1. Real bus fleet  *(blocks accurate trip assignments)*

The system currently has 7 placeholder demo buses. Please replace with the real fleet.

One row per bus:

| Field | Format | Example |
|---|---|---|
| Fleet / unit number | Text | Bus 14 |
| Bench count | 18, 47, or 56 | 47 |
| Requires air-brake certified driver? | Yes / No | Yes |
| Active / in service? | Yes / No | Yes |
| Notes | Text | AC unit, wheelchair lift, out for inspection until Jul 1 |
| Samsara vehicle ID | From Samsara dashboard | veh_abc123 *(Phase 5 — can add later)* |

> **Please send:** A list of all buses currently in service. A simple spreadsheet or email is fine.

---

### 2. Driver list  *(blocks accurate trip assignments)*

The system currently has 2 placeholder demo drivers. Please replace with the real roster.

One row per driver:

| Field | Format | Example |
|---|---|---|
| First name | Text | Barry |
| Last name | Text | Smith |
| Email address | Email | barry@ccsta.ca |
| Phone (cell) | 604-555-0100 format | 604-555-0101 |
| Air-brake certified? | Yes / No | Yes |
| Trip types | Route / Field Trip / Both | Both |
| Samsara driver ID | From Samsara dashboard | drv_xyz789 *(Phase 5 — can add later)* |

> **Please send:** A list of all active drivers. Email and phone are required so we can create their login accounts and send trip notifications.

---

### 3. Driver–bus clearances  *(blocks accurate trip assignments)*

Which bus sizes is each driver licensed/cleared to operate?

| Driver full name | Cleared for (circle all that apply) |
|---|---|
| e.g. Barry Smith | 18 / 47 / 56 |
| e.g. Judy Lee | 18 / 47 |

*(Just the bench counts: 18, 47, or 56)*

---

### 4. Driver pairing restrictions  *(optional — only if applicable)*

Are there any pairs of drivers who **cannot be scheduled on the same day?**

| Driver A | Driver B | Reason (optional) |
|---|---|---|
| | | |

If none, write "None."

---

### 5. Member school confirmation  *(affects pricing — members get the lower rate)*

The system has ~100 schools pre-loaded. We've made an educated guess at which ones are CCSTA members, but this needs confirmation so the right rate is applied automatically.

**Currently flagged as member schools:**
- Abbotsford Christian School
- B.C. Christian Academy
- Credo Christian Elementary School
- Credo Christian High School
- Delta Christian School
- John Knox Christian School
- Langley Christian School
- Maple Ridge Christian
- MEI (Mennonite Educational Institute)
- Pacific Academy
- Regent Christian Academy
- Surrey Christian School *(also listed as CCSTA home school)*
- The Kings School
- Valley Christian School
- Vancouver Christian School
- White Rock Christian Academy

> **Please confirm:** Is this list correct? Any schools to add or remove?

---

### 6. Yard address confirmation  *(low priority)*

The system uses **8888 162 Street, Surrey, BC V4N 3G1** as the main yard — this address also appears as Surrey Christian School in the companies sheet.

> **Please confirm:** Is 8888 162 St the actual bus yard address, or is the yard at a different location?

---

### 7. API credentials  *(needed for specific phases)*

| # | Service | What it unlocks | What we need | Priority |
|---|---|---|---|---|
| A | **Samsara** | Live bus GPS on the dispatch screen; driver hours-of-service sync | Samsara API token (Settings → API Tokens in Samsara dashboard) + vehicle IDs per bus + driver IDs per driver | Phase 5 |
| B | **Email (SMTP)** | Automated emails — quote confirmation to school, approval notice, trip details to driver | SMTP host, port, username, password, and "from" email (e.g. bookings@ccsta.ca) | Phase 4 |
| C | **SMS** | Text alerts to drivers when a new trip is assigned | SMS provider + API key (Twilio, SimpleTexting, etc. — or let us know what you use) | Phase 4 |

> **Note on Google Maps:** The API key is already set up and billing just needs to be enabled on the Google Cloud account. Maps currently work using OpenStreetMap — Google gives more accurate live-traffic routing but is not blocking anything.

---

### 8. Quote & invoice document templates  *(needed for document generation)*

- **Sample quote PDF or confirmation sheet** — the document currently sent to schools when a trip is confirmed. Any recent one is fine.
- **Sage 50 invoice template** — either a sample Sage 50 import CSV, or the expected field layout so we can format the export to match.

---

## How to send

Easiest formats:
- **Spreadsheet** (Excel or Google Sheets) — one tab per section
- **Email** with the info typed inline — fine for small confirmations
- **PDFs** — for quote template and Sage format

Send to **Michael** — he'll enter it into the system.

---

*Platform built with TanStack Start · Supabase · Vercel*  
*Questions? Michael can explain any field in more detail.*
