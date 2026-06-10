-- Migration 021: fix driver@test.com — confirmation_token NULL crashes GoTrue's Go scanner.
-- GoTrue scans confirmation_token into a non-pointer string; NULL → panic → 500.
UPDATE auth.users
SET
  confirmation_token     = COALESCE(confirmation_token, ''),
  recovery_token         = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change           = COALESCE(email_change, ''),
  updated_at             = now()
WHERE email = 'driver@test.com';
