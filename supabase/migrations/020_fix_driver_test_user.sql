-- Migration 020: fix driver@test.com test user created with aud=NULL.
--
-- The test user was inserted via raw SQL which left aud and instance_id unset.
-- Supabase GoTrue rejects signInWithPassword when aud != 'authenticated'.

UPDATE auth.users
SET
  aud         = 'authenticated',
  instance_id = '00000000-0000-0000-0000-000000000000',
  updated_at  = now()
WHERE email = 'driver@test.com';
