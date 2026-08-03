-- Migration 059: make the email queue drain on a schedule.
--
-- APPLIED to the live DB 2026-07-29 via the Supabase connector.
--
-- Until now notify-send ran ONLY when the frontend invoked it after a user
-- action, and src/lib/notify.ts deliberately swallows failures. So a queued
-- email whose dispatch failed sat at 'pending' until some unrelated quote
-- submission or admin action happened to flush it. On a quiet day that could
-- be a long time, and nothing anywhere said so.
--
-- Every five minutes, pg_cron asks the edge function to drain whatever is
-- pending. If nothing is queued it returns {"sent":0,"queued":0} and costs
-- essentially nothing.
--
-- ON THE KEY BELOW: notify-send has verify_jwt enabled, so the call needs an
-- Authorization header. This uses the PUBLISHABLE key, which already ships
-- inside the public site bundle — so no secret is stored in the database where
-- it would sit readable in cron.job to anyone with DB access. Verified by
-- calling the function with it: HTTP 200, {"sent":0,"queued":0}. The
-- service-role key is deliberately NOT used here. If the publishable key is
-- ever rotated, this job's header must be updated with it.
--
-- Verified after applying: the job registered (jobid 1, active), and running
-- its exact body by hand returned status_code 200 with {"sent":0,"queued":0}
-- in net._http_response — so pg_net, the URL and the auth header are all good,
-- rather than merely scheduled and untested.
--
-- Historical note found while doing this: notification_log holds 13 'failed'
-- rows, all from 11–23 June, all the same Resend error — "You can only send
-- testing emails to your own email address" — i.e. before the sending domain
-- was verified. Since then mail to marianne@the-grove.net,
-- info@dasmeshacademy.ca, curtisbraun@hotmail.com and admin@ccsta.net all
-- shows 'sent', so the domain is verified and real customers are receiving
-- email. Those 13 are history, not a live fault, and are deliberately left in
-- place as a record.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Replace any previous definition so this migration is safe to re-run.
SELECT cron.unschedule('drain-email-queue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-email-queue');

SELECT cron.schedule(
  'drain-email-queue',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url     := 'https://wurnsxgvmpabfchzeyrz.supabase.co/functions/v1/notify-send',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer sb_publishable_g4vm1crP0gNKiiZmFu82FA_DaR7XpTb'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $job$
);

-- Anything still pending after 30 minutes means the drain itself is failing --
-- worth a human look rather than silently accumulating.
CREATE OR REPLACE VIEW public.stuck_notifications AS
SELECT id, type, recipient, subject, status, error, created_at,
       now() - created_at AS waiting_for
FROM public.notification_log
WHERE status = 'pending'
  AND created_at < now() - interval '30 minutes'
ORDER BY created_at;

COMMENT ON VIEW public.stuck_notifications IS
  'Emails still pending 30+ minutes after being queued. Should normally be empty — the pg_cron job drain-email-queue runs every 5 minutes.';

-- Useful checks:
--   SELECT * FROM public.stuck_notifications;
--   SELECT * FROM cron.job WHERE jobname = 'drain-email-queue';
--   SELECT status, return_message, start_time FROM cron.job_run_details
--     ORDER BY start_time DESC LIMIT 10;
