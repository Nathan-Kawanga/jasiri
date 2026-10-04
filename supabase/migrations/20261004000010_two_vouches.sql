-- New barbers, service staff and cashiers need 2 different coworkers to confirm
-- they work in the shop (1 while the shop has only one person). Turning someone
-- away also takes 2 "No"s, so one person can't block a colleague alone.
-- Owner/manager requests are still decided by the shop's manager alone.

create table public.membership_votes (
  membership_id uuid not null references public.memberships (id),
  voter_id uuid not null references public.profiles (id),
  approve boolean not null,
  at timestamptz not null default now(),
  primary key (membership_id, voter_id)
);
alter table public.membership_votes enable row level security;
revoke all on public.membership_votes from anon, authenticated;
create trigger audit after insert or update or delete on public.membership_votes
  for each row execute function private.audit_row();

-- How many coworkers must agree, given who is in the shop right now.
create function private.vouches_needed(p_shop uuid) returns int
language sql stable security definer set search_path = '' as $$
  select least(2, greatest(1, (select count(*)::int from public.memberships
                               where shop_id = p_shop and status = 'active')))
$$;

create or replace function public.decide_join(p_request uuid, p_membership uuid, p_approve boolean, p_roles public.shop_role[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'decide_join');
  m public.memberships;
  v_asked public.shop_role;
  v_roles public.shop_role[];
  v_needed int;
  v_yes int;
  v_no int;
  v_result text := 'pending';
begin
  if v_resp is not null then return v_resp; end if;
  select * into m from public.memberships where id = p_membership for update;
  if m.id is null or m.status <> 'pending' then raise exception 'not_pending'; end if;
  if m.user_id = v then raise exception 'not_allowed'; end if;
  v_asked := coalesce(m.requested_role, (select signup_role from public.profiles where id = m.user_id));

  -- Owner / manager requests (or no stated role): the shop's manager decides alone.
  if v_asked is null or v_asked = 'manager' then
    if not (private.has_role(m.shop_id, 'manager') or private.is_admin()) then raise exception 'manager_must_approve'; end if;
    v_roles := (select array_agg(distinct r) from unnest(coalesce(p_roles, array[v_asked])) r where r is not null);
    if p_approve and coalesce(cardinality(v_roles), 0) = 0 then raise exception 'pick_a_role'; end if;
    perform private.act(case when p_approve then 'membership.approve' else 'membership.reject' end);
    update public.memberships set
      status = case when p_approve then 'active'::public.membership_status else 'rejected' end,
      roles = case when p_approve then v_roles else '{}' end, decided_at = now(), decided_by = v
    where id = p_membership;
    return private.idem_store(p_request, jsonb_build_object('result', case when p_approve then 'approved' else 'rejected' end));
  end if;

  -- Everyone else: coworkers vouch. Platform admin may decide alone.
  if private.is_admin() and not private.is_member(m.shop_id) then
    v_needed := 1;
  elsif not private.is_member(m.shop_id) then
    raise exception 'not_allowed';
  else
    v_needed := private.vouches_needed(m.shop_id);
  end if;

  perform private.act(case when p_approve then 'membership.vouch_yes' else 'membership.vouch_no' end);
  insert into public.membership_votes (membership_id, voter_id, approve) values (p_membership, v, p_approve)
  on conflict (membership_id, voter_id) do update set approve = excluded.approve, at = now();

  select count(*) filter (where approve), count(*) filter (where not approve)
  into v_yes, v_no from public.membership_votes where membership_id = p_membership;

  if v_yes >= v_needed then
    perform private.act('membership.approve');
    update public.memberships set status = 'active', roles = array[v_asked], decided_at = now(), decided_by = v
    where id = p_membership;
    v_result := 'approved';
  elsif v_no >= v_needed then
    perform private.act('membership.reject');
    update public.memberships set status = 'rejected', roles = '{}', decided_at = now(), decided_by = v
    where id = p_membership;
    v_result := 'rejected';
  end if;
  return private.idem_store(p_request, jsonb_build_object('result', v_result, 'yes', v_yes, 'no', v_no, 'needed', v_needed));
end $$;

create or replace function public.shop_join_requests(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not private.is_member(p_shop) then raise exception 'not_allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'membership_id', m.id, 'name', p.full_name,
      'requested_role', coalesce(m.requested_role, p.signup_role),
      'requested_at', m.requested_at,
      'manager_only', coalesce(m.requested_role, p.signup_role) is null or coalesce(m.requested_role, p.signup_role) = 'manager',
      'can_decide', private.has_role(p_shop, 'manager')
                    or (coalesce(m.requested_role, p.signup_role) is not null and coalesce(m.requested_role, p.signup_role) <> 'manager'),
      'yes', (select count(*) from public.membership_votes x where x.membership_id = m.id and x.approve),
      'no', (select count(*) from public.membership_votes x where x.membership_id = m.id and not x.approve),
      'needed', private.vouches_needed(p_shop),
      'my_vote', (select x.approve from public.membership_votes x where x.membership_id = m.id and x.voter_id = v))
      order by m.requested_at)
    from public.memberships m join public.profiles p on p.id = m.user_id
    where m.shop_id = p_shop and m.status = 'pending'), '[]'::jsonb);
end $$;

revoke execute on function public.shop_join_requests(uuid) from public, anon;
revoke execute on function private.vouches_needed(uuid) from public;
