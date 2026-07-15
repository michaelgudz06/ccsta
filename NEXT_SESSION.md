# Next Session — Pick Up Here

_Branch: `email-notify-melody` (based on `main`, isolated from other unreleased work)._

## Email notifications — diagnosis so far (not yet working)

- The "new quote" email feature **already exists in code** — `submit_quote`
  queues it via `_queue_email` (see `supabase/migrations/025_...sql`). No
  build needed for the feature itself.
- **DONE:** Resend account created, `ccsta.net` domain **verified** in
  Resend (all DNS records — DKIM/SPF/MX — were already present in GoDaddy
  from a prior setup).
- **DONE:** `RESEND_API_KEY` added to Supabase Project Settings → Edge
  Functions → Secrets, correct name, correct project
  (`wurnsxgvmpabfchzeyrz`). Also added `NOTIFY_FROM_EMAIL`.
- **DONE:** `notify_admin_email` in `app_config` updated to `admin@ccsta.net`.
- **PROBLEM:** emails stay `'pending'` in `notification_log`. Manual Invoke
  of `notify-send` returns `"RESEND_API_KEY not set"` — the function
  cannot see the secret despite it being correctly saved.
- **Ruled out:** wrong project (`.env` confirms `wurnsxgvmpabfchzeyrz`),
  wrong secret name, wrong secret location, no `.env.local` override,
  function IS deployed and listed. Deployed source's `Deno.env.get(...)`
  line for the API key was confirmed to match the repo's
  `supabase/functions/notify-send/index.ts` character-for-character.
- **Likely remaining cause:** the deployed `notify-send` function has a
  **stale runtime environment** (or is otherwise not picking up newly
  added secrets) — possibly tied to how it was originally deployed
  (e.g. a Lovable-managed deploy path separate from this repo).
  **Fix to try next:** redeploy the `notify-send` function (in-browser
  Deploy button if the dashboard offers one, or via Supabase CLI:
  `supabase functions deploy notify-send`) to force it to restart and
  re-read secrets. Also double check the deployed function's *full*
  source against the repo's `supabase/functions/notify-send/index.ts` (not
  just the API-key line) in case of any other drift.
- **Note:** consider asking whoever originally set up the Lovable/Supabase
  deploy — they may have deploy access/context to resolve this in minutes.
