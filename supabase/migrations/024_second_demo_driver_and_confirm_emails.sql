-- Migration 024: add a second demo driver so two quotes can be assigned on the same date,
-- and confirm test account emails so login works without manual SQL fixes.

-- ── Confirm test account emails ────────────────────────────────────────────────
-- These were created without email confirmation, causing HTTP 400 on login.
UPDATE auth.users
SET    email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE  email IN (
  'test-customer@ccsta.ca',
  'test-admin@ccsta.ca',
  'test-driver@ccsta.ca',
  'admin@test.com',
  'driver@test.com'
);

-- ── Second demo driver profile ─────────────────────────────────────────────────
-- Creates a second driver (Sarah Wilson) so that multiple trips on the same date
-- can each be assigned a different driver.  Uses a stable UUID so re-running this
-- migration is idempotent.
DO $$
DECLARE
  v_uid  uuid := 'b2000000-0000-0000-0000-000000000002'::uuid;
  v_did  uuid;
BEGIN
  -- Auth user (email/password login)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role,
      email, encrypted_password,
      email_confirmed_at, confirmation_token,
      recovery_token, email_change_token_new, email_change_token_current,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      v_uid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'test-driver2@ccsta.ca',
      crypt('TestPass123!', gen_salt('bf')),
      now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(), now()
    );
  END IF;

  -- Profile
  INSERT INTO public.profiles (id, role)
  VALUES (v_uid, 'driver')
  ON CONFLICT (id) DO NOTHING;

  -- Driver record
  INSERT INTO public.drivers (
    profile_id, first_name, last_name, phone,
    air_brake_cert, trip_type, active, notes
  ) VALUES (
    v_uid, 'Sarah', 'Wilson', '778-555-0202',
    true, 'both', true,
    'DEMO seed — replace with real driver data from Curtis'
  )
  ON CONFLICT (profile_id) DO NOTHING
  RETURNING id INTO v_did;

  -- If it already existed, look it up
  IF v_did IS NULL THEN
    SELECT id INTO v_did FROM public.drivers WHERE profile_id = v_uid;
  END IF;

  -- Clearances for all three bus sizes
  INSERT INTO public.driver_bus_clearances (driver_id, bench_count)
  VALUES (v_did, 18), (v_did, 47), (v_did, 56)
  ON CONFLICT DO NOTHING;
END $$;
