-- Security fix: prevent admin role self-assignment via signup metadata.
-- Always default new users to 'customer'. Drivers get their role set
-- afterwards by the invite-driver edge function.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, email)
  values (new.id, 'customer', new.email);
  return new;
end;
$$;
