-- Migration 050: allow public (anon, pre-login) read access to rate_config
-- and surcharge_config.
--
-- The customer quote form shows a live price preview before login/signup
-- (session is optional until actual submission), but until now that preview
-- was a hardcoded client-side mirror of these tables, not a live read -- RLS
-- required auth.uid() to be set, which anonymous quote-form visitors never
-- have. That mirror silently drifted from rate_config after migration 049
-- changed the 18-bench rate (customer preview kept showing the old, shared
-- 18/47 rate). This migration lets the client fetch both tables directly
-- instead, closing that class of bug for good.
--
-- Safe to open: both tables are pure pricing numbers, no PII (unlike
-- `schools`, which stays auth-gated because it holds contact info). Write
-- access is unchanged -- still admin-only.

DROP POLICY IF EXISTS "rate_config_auth_read" ON public.rate_config;
CREATE POLICY "rate_config_public_read"
  ON public.rate_config FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "surcharge_config_auth_read" ON public.surcharge_config;
CREATE POLICY "surcharge_config_public_read"
  ON public.surcharge_config FOR SELECT
  USING (true);
