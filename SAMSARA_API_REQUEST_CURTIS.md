# Samsara API Token — What We Need From You

**To:** Curtis
**From:** Michael
**Re:** Connecting Samsara to the CCSTA booking platform

Hi Curtis,

To put live bus locations on the dispatch screen and sync driver hours, the platform needs to connect to your Samsara account. That connection uses an **API token** — think of it as a special read-only password that lets our system *see* Samsara data without anyone having to log in.

This is the **last big piece** I need from you for the tracking feature. Here's exactly how to create it and send it to me safely.

---

## Step 1 — Create the API token in Samsara

1. Sign in to the Samsara dashboard at **https://cloud.samsara.com** using an **admin** account.
2. Click the **Settings** gear icon (bottom-left corner).
3. Find **API Tokens** (it's under the "Integrations" or "Developer" area, depending on your dashboard version).
4. Click **+ Add API Token** (or **Create API Token**).
5. Name it something recognizable: **`CCSTA Booking Platform`**
6. For permissions, **Read-Only is all we need.** If it asks you to choose specific scopes, tick the read scopes for:
   - **Vehicles**
   - **Locations / GPS**
   - **Drivers / Hours of Service**

   Please **don't** give it write or admin access — read-only keeps the account safe.
7. Click **Generate**.
8. Samsara will show the token **one time only.** It's a long string that starts with something like `samsara_api_...`. **Copy the whole thing right away** — once you close the window you can't see it again (you'd just delete it and make a new one).

---

## Step 2 — Send the token to me securely

The token is essentially a password to your Samsara account, so **please don't put it in a regular email or text message.** Pick whichever of these is easiest:

- **Phone call / in person** — just read it out to me, or
- **One-time secure link** — go to **https://onetimesecret.com**, paste the token in, and it gives you a link that **self-destructs the moment I open it.** Send me that link by email or text (the link is safe to send; the token itself isn't), or
- **Password manager** — if you use 1Password, LastPass, etc., share it through that.

Once I have it, I store it in a locked-down server vault — it never goes into the website code or anywhere it could leak.

---

## Step 3 — Two quick lists while you're in there

So the live map can match each vehicle and driver to the right bus and person, I also need their Samsara IDs:

- **Vehicle IDs** — In Samsara go to **Fleet → Vehicles**. Each bus has an ID. When you send me the bus list, just add each bus's Samsara vehicle ID beside it.
- **Driver IDs** — Under **Drivers**, each driver has an ID. Add those next to the names on the driver roster.

A simple spreadsheet or even a typed list is perfectly fine.

---

## Quick summary

| # | What | Where |
|---|------|-------|
| 1 | Create a **read-only API token** named "CCSTA Booking Platform" | Settings → API Tokens |
| 2 | Send it to me via **phone, onetimesecret.com, or a password manager** (not plain email/text) | — |
| 3 | Send me the **vehicle IDs** and **driver IDs** | Fleet → Vehicles / Drivers |

No rush if the live-tracking feature isn't urgent — everything else on the platform works without it. But whenever you have ten minutes, this unlocks the live bus map.

Thanks!
Michael

*Any questions on any step, just call or text me and I'll walk you through it.*
