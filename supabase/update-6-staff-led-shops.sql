-- Jasiri update 6: staff-led shops (find your shop by name, coworkers vouch for new staff). Run update 5 first. Paste into Supabase → SQL Editor → New query → Run, once.

-- Staff-led shops: barbers bring the app into the shop, not the owner.
-- * Find a shop by typing its name (matches pop up, typos tolerated) and ask to join
--   with your role. No join code needed.
-- * Any one person already working in the shop can vouch for a new barber, service
--   staff or cashier. Owner/manager requests need the shop's current manager.
-- * Whoever adds the shop first becomes its manager (alongside their own role) and
--   can hand the manager role to the real owner later.

create extension if not exists pg_trgm with schema extensions;
create index shops_name_trgm on public.shops using gin (lower(name) extensions.gin_trgm_ops);

alter table public.memberships add column requested_role public.shop_role;

-- Shops whose name looks like the search. Name, area and staff count only.
create function public.search_shops(p_query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(btrim(p_query));
begin
  perform private.require_user();
  if length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object(
        'id', s.id, 'name', s.name, 'area', s.area,
        'members', (select count(*) from public.memberships m where m.shop_id = s.id and m.status = 'active'),
        'mine', exists (select 1 from public.memberships m where m.shop_id = s.id and m.user_id = auth.uid()
                        and m.status in ('pending', 'active'))) x
      from public.shops s
      where s.suspended_at is null
        and (lower(s.name) like '%' || q || '%' or extensions.similarity(lower(s.name), q) > 0.3)
      order by extensions.similarity(lower(s.name), q) desc, s.created_at
      limit 8) t), '[]'::jsonb);
end $$;

-- Ask to join a shop picked from the search, as one role.
create function public.request_join_shop(p_request uuid, p_shop uuid, p_role public.shop_role) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'request_join_shop');
  v_id uuid;
begin
  if v_resp is not null then return v_resp; end if;
  if p_role is null then raise exception 'pick_a_role'; end if;
  if not exists (select 1 from public.shops where id = p_shop and suspended_at is null) then
    raise exception 'shop_not_found';
  end if;
  if p_role = 'barber' and not (select is_barber from public.profiles where id = v) then
    raise exception 'barber_profile_required';
  end if;
  perform private.act('membership.request');
  begin
    insert into public.memberships (shop_id, user_id, requested_role) values (p_shop, v, p_role) returning id into v_id;
  exception when unique_violation then raise exception 'already_member';
  end;
  return private.idem_store(p_request, jsonb_build_object('membership_id', v_id, 'shop_id', p_shop));
end $$;

-- Join requests waiting in my shop, for anyone who works there.
create function public.shop_join_requests(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_shop) then raise exception 'not_allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'membership_id', m.id, 'name', p.full_name,
      'requested_role', coalesce(m.requested_role, p.signup_role),
      'requested_at', m.requested_at,
      'can_decide', private.has_role(p_shop, 'manager') or coalesce(m.requested_role, p.signup_role) is distinct from 'manager')
      order by m.requested_at)
    from public.memberships m join public.profiles p on p.id = m.user_id
    where m.shop_id = p_shop and m.status = 'pending'), '[]'::jsonb);
end $$;

-- Approve or turn down a join request.
-- Manager: any roles. Anyone else working in the shop: only the role that was asked
-- for, and never the manager role.
create or replace function public.decide_join(p_request uuid, p_membership uuid, p_approve boolean, p_roles public.shop_role[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'decide_join');
  m public.memberships;
  v_asked public.shop_role;
  v_roles public.shop_role[];
begin
  if v_resp is not null then return v_resp; end if;
  select * into m from public.memberships where id = p_membership for update;
  if m.id is null or m.status <> 'pending' then raise exception 'not_pending'; end if;
  if m.user_id = v then raise exception 'not_allowed'; end if;
  v_asked := coalesce(m.requested_role, (select signup_role from public.profiles where id = m.user_id));

  if private.has_role(m.shop_id, 'manager') or private.is_admin() then
    v_roles := (select array_agg(distinct r) from unnest(p_roles) r);
  elsif private.is_member(m.shop_id) then
    if v_asked is null or v_asked = 'manager' then raise exception 'manager_must_approve'; end if;
    v_roles := array[v_asked];
  else
    raise exception 'not_allowed';
  end if;

  if p_approve and coalesce(cardinality(v_roles), 0) = 0 then raise exception 'pick_a_role'; end if;
  perform private.act(case when p_approve then 'membership.approve' else 'membership.reject' end);
  update public.memberships set
    status = case when p_approve then 'active'::public.membership_status else 'rejected' end,
    roles = case when p_approve then v_roles else '{}' end,
    decided_at = now(), decided_by = v
  where id = p_membership;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

-- The person who adds a shop becomes its manager plus the role they work as.
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
  if p.is_barber then
    v_roles := v_roles || 'barber'::public.shop_role;
  elsif p.signup_role in ('service_staff', 'cashier') then
    v_roles := v_roles || p.signup_role;
  end if;
  perform private.act('membership.create_manager');
  insert into public.memberships (shop_id, user_id, status, roles, decided_at, decided_by, requested_role)
  values (v_shop, v, 'active', v_roles, now(), v, coalesce(p.signup_role, 'manager'));
  return private.idem_store(p_request, jsonb_build_object('shop_id', v_shop));
end $$;

-- my_profile now also says what the person signed up as.
create or replace function public.my_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid(); r jsonb;
begin
  if v is null then raise exception 'not_signed_in'; end if;
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email,
    'is_barber', p.is_barber, 'handle', p.handle, 'about', p.about, 'photo_path', p.photo_path, 'signup_role', p.signup_role,
    'slot_minutes', p.slot_minutes, 'is_platform_admin', p.is_platform_admin,
    'suspended', p.suspended_at is not null,
    'trial_ends_at', p.trial_ends_at, 'paid_until', p.paid_until,
    'subscription', case
      when not p.is_barber then 'free'
      when p.paid_until is not null and p.paid_until >= private.today() then 'paid'
      when p.trial_ends_at > now() then 'trial'
      else 'due' end,
    'payment_instructions', (select value from public.app_settings where key = 'payment_instructions'),
    'monthly_price_kes', (select value from public.app_settings where key = 'monthly_price_kes'))
  into r from public.profiles p where p.id = v;
  return r;
end $$;

revoke execute on function public.search_shops(text), public.request_join_shop(uuid, uuid, public.shop_role),
  public.shop_join_requests(uuid), public.my_profile() from public, anon;
