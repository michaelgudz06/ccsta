-- Migration 028: harden role-based access. Closes two live privilege-escalation
-- vectors and pins search_path on SECURITY DEFINER / trigger functions.
--
-- Background: 026_fix_role_escalation.sql (added via Lovable) hardcoded the
-- signup role but was never applied to the live database, and it did not address
-- the profile-UPDATE vector at all. This migration applies both fixes for real.
--   (1) handle_new_user trusted raw_user_meta_data->>'role' at signup.
--   (2) profiles UPDATE policy had no WITH CHECK, so a user could PATCH their
--       own role to 'admin' via REST.

-- (1) New signups always default to 'customer'. Elevated roles are set only by
--     admins / the service role (e.g. the invite-driver edge function).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, email)
  VALUES (new.id, 'customer', new.email);
  RETURN new;
END;
$$;

-- It's a trigger function — it should never be callable via the REST RPC surface.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- (2) Self-update: a user may edit their own row but never change their role.
--     RLS WITH CHECK can't see the OLD value, so a trigger enforces the role rule;
--     the policy WITH CHECK keeps the row owned by the same user.
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.prevent_role_self_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.role IS DISTINCT FROM old.role THEN
    -- A request carrying a JWT (auth.uid() not null) is an end user: only admins
    -- may change roles. Server-side contexts (service role, migrations) have a
    -- null auth.uid() and are allowed through.
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only an administrator can change a user role.';
    END IF;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_role_change ON public.profiles;
CREATE TRIGGER profiles_prevent_role_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_self_change();

-- (3) Pin search_path on the remaining flagged function.
ALTER FUNCTION public.set_updated_at() SET search_path = public;
