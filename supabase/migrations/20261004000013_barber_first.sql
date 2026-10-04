-- Jasiri update 10: barbers who manage a shop keep their barber role.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.

-- 1. Repair: anyone who is a barber but was left as manager only in a shop gets the barber role.
update public.memberships m set roles = array_append(m.roles, 'barber'::public.shop_role)
from public.profiles p
where p.id = m.user_id and p.is_barber and m.status = 'active'
  and 'manager' = any (m.roles) and not ('barber' = any (m.roles));

-- 2. Turning on "I am a barber" also makes you a barber in the shops you manage.
create or replace function public.update_my_profile(
  p_full_name text, p_is_barber boolean, p_handle text, p_about text, p_slot_minutes int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  perform private.act('profile.update');
  update public.profiles set
    full_name = btrim(p_full_name),
    is_barber = p_is_barber,
    handle = nullif(lower(btrim(p_handle)), ''),
    about = nullif(btrim(p_about), ''),
    slot_minutes = coalesce(p_slot_minutes, slot_minutes)
  where id = v;
  if p_is_barber then
    perform private.act('membership.add_barber_role');
    update public.memberships set roles = array_append(roles, 'barber'::public.shop_role)
    where user_id = v and status = 'active' and 'manager' = any (roles) and not ('barber' = any (roles));
  end if;
  return public.my_profile();
exception when unique_violation then raise exception 'handle_taken';
end $$;

-- 3. Adding a shop: you are its manager AND whatever you work as (barber if you're a barber).
create or replace function public.create_shop(p_request uuid, p_name text, p_area text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'create_shop');
  v_shop uuid;
  v_roles public.shop_role[] := '{manager}';
  p public.profiles;
begin
  if v_resp is not null then return v_resp; end if;
  select * into p from public.profiles where id = v;
  perform private.act('shop.create');
  insert into public.shops (name, area, join_code, created_by)
  values (btrim(p_name), btrim(p_area), private.new_join_code(), v)
  returning id into v_shop;
  if p.is_barber or p.signup_role = 'barber' then
    v_roles := v_roles || 'barber'::public.shop_role;
  elsif p.signup_role in ('service_staff', 'cashier') then
    v_roles := v_roles || p.signup_role;
  end if;
  perform private.act('membership.create_manager');
  insert into public.memberships (shop_id, user_id, status, roles, decided_at, decided_by, requested_role)
  values (v_shop, v, 'active', v_roles, now(), v, coalesce(p.signup_role, 'manager'));
  return private.idem_store(p_request, jsonb_build_object('shop_id', v_shop));
end $$;

revoke execute on function public.update_my_profile(text, boolean, text, text, int), public.create_shop(uuid, text, text) from public, anon;
grant execute on function public.update_my_profile(text, boolean, text, text, int), public.create_shop(uuid, text, text) to authenticated;
