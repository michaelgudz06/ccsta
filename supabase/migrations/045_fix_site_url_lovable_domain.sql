-- Migration 045: fix the Lovable placeholder domain in notification links.
--
-- app_config.site_url was seeded in migration 025 as
-- 'https://ccsta-test.lovable.app' and never updated since -- every
-- notification email that links to /portal or /admin (admin new-quote
-- alerts, approve_quote, reject_quote, resolve_cancellation_request, and
-- the customer confirmation email) has been building that link off this
-- one row via _site_url(). Confirmed live domain is https://ccsta.net.
--
-- Two parts, matching the pattern already used for app_config updates
-- (see migration 027's notify_admin_email fix):
--   1. Update the actual data row.
--   2. Update _site_url()'s hardcoded fallback (used only if the row is
--      ever missing) so a reseed can't reintroduce the Lovable URL.
--
-- No trailing slash on either value -- every call site appends a path
-- ('/portal', '/admin') directly onto the result.

UPDATE public.app_config
SET value = 'https://ccsta.net', updated_at = now()
WHERE key = 'site_url';

CREATE OR REPLACE FUNCTION public._site_url()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM app_config WHERE key = 'site_url'),
    'https://ccsta.net'
  );
$$;
