# Next Session — Pick Up Here

_Branch: `email-notify-melody` (based on `main`, isolated from other unreleased work)._

## Email notifications — ✅ WORKING (resolved)

- The "new quote" email feature **already existed in code** — `submit_quote`
  queues it via `_queue_email` (see `supabase/migrations/025_...sql`). No
  build was needed for the feature itself, only configuration.
- Resend account set up, `ccsta.net` domain verified.
- Two Supabase Edge Function secrets are required (Project Settings → Edge
  Functions → Secrets — **names are CASE-SENSITIVE, all caps**):
  - `RESEND_API_KEY` = the Resend API key.
  - `NOTIFY_FROM_EMAIL` = `CCSTA Bookings <bookings@ccsta.net>` (must be an
    address on the verified `ccsta.net` domain).
- `notify_admin_email` in `app_config` = `admin@ccsta.net` (the recipient).
- **Root causes that were fixed:**
  1. The API key secret had been saved as lowercase `resend_api_key`, but
     the code reads `Deno.env.get("RESEND_API_KEY")` — secret names are
     case-sensitive, so it was invisible to the function even though a
     secret with a similar name was present and everything else (project,
     deployment, function code) checked out correctly.
  2. The from-address wasn't set to an address on the verified domain —
     `NOTIFY_FROM_EMAIL` was effectively missing/wrong, so the function was
     falling back to its default sender instead of a `ccsta.net` address,
     rather than actually sending via the verified domain.
- See `WHATS_NEW.md` § "Email notifications (Resend)" for the full working
  config, now recorded there as the source of truth going forward.
