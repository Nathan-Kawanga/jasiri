-- What a person said they do when signing up (barber, service staff, cashier,
-- shop manager). Used to pre-tick their role when a shop manager approves them.
-- Actual permissions still come only from the roles the manager approves.

alter table public.profiles add column signup_role public.shop_role;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone, email, is_barber, handle, signup_role)
  values (
    new.id,
    btrim(new.raw_user_meta_data ->> 'full_name'),
    public.normalize_phone(nullif(new.raw_user_meta_data ->> 'phone', '')),
    nullif(lower(new.raw_user_meta_data ->> 'contact_email'), ''),
    coalesce((new.raw_user_meta_data ->> 'is_barber')::boolean, false),
    nullif(lower(new.raw_user_meta_data ->> 'handle'), ''),
    nullif(new.raw_user_meta_data ->> 'signup_role', '')::public.shop_role);
  return new;
end $$;

-- Existing barbers count as having signed up as barbers.
update public.profiles set signup_role = 'barber' where is_barber and signup_role is null;

grant select (signup_role) on public.profiles to authenticated;
