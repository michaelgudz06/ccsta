-- Migration 019: fix infinite RLS recursion on profiles table.
--
-- profiles_admin_read and profiles_admin_write used a correlated subquery that
-- queried public.profiles from inside a policy ON public.profiles, causing
-- PostgreSQL to detect infinite recursion and return HTTP 500 for every
-- profiles read — breaking role detection for all users.
--
-- Fix: SECURITY DEFINER helper bypasses RLS when checking the caller's role,
-- breaking the recursion.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

DROP POLICY IF EXISTS "profiles_admin_read"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_write" ON public.profiles;

CREATE POLICY "profiles_admin_read"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "profiles_admin_write"
  ON public.profiles FOR ALL
  USING (public.is_admin());
