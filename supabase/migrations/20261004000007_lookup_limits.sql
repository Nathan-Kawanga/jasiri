-- Stricter limits on finding a client served by another barber in the shop:
-- at most 1 successful find per hour and 10 per Nairobi day, per barber.
-- Lookups that find nothing reveal nothing and don't count (capped at 60 a day
-- to stop number guessing). When the limit is reached the name is not returned;
-- the client types it himself, so the code is never blocked.

create or replace function public.shop_client_lookup(p_shop uuid, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_phone text := public.normalize_phone(p_phone);
  v_mine uuid;
  v_name text;
  v_finds_hour int;
  v_finds_today int;
  v_misses_today int;
  v_status text;
begin
  if not private.has_role(p_shop, 'barber') then raise exception 'not_allowed'; end if;

  -- Already in my own book: use that record. Never counts.
  select id, first_name into v_mine, v_name from public.clients where barber_id = v and phone = v_phone;
  if v_mine is not null then
    return jsonb_build_object('status', 'mine', 'client_id', v_mine, 'first_name', v_name);
  end if;

  select
    count(*) filter (where after ->> 'result' = 'shop' and at > now() - interval '1 hour'),
    count(*) filter (where after ->> 'result' = 'shop' and private.nairobi_date(at) = private.today()),
    count(*) filter (where after ->> 'result' = 'new' and private.nairobi_date(at) = private.today())
  into v_finds_hour, v_finds_today, v_misses_today
  from public.audit_log
  where action = 'client.lookup' and actor_id = v and at > now() - interval '1 day';

  if v_misses_today >= 60 then raise exception 'rate_limited'; end if;

  -- Served in this shop before, by another barber.
  select c.first_name into v_name
  from public.clients c
  where c.phone = v_phone
    and exists (select 1 from public.codes k where k.client_id = c.id and k.shop_id = p_shop)
  order by c.created_at
  limit 1;

  v_status := case
    when v_name is null then 'new'
    when v_finds_hour >= 1 or v_finds_today >= 10 then 'limited'
    else 'shop' end;

  insert into public.audit_log (actor_id, actor_roles, shop_id, action, entity, after)
  values (v, private.my_roles(p_shop)::text[], p_shop, 'client.lookup', 'clients',
          jsonb_build_object('result', v_status));

  if v_status = 'shop' then return jsonb_build_object('status', 'shop', 'first_name', v_name); end if;
  -- Over the limit answers exactly like "not served here", so it reveals nothing.
  return jsonb_build_object('status', 'new');
end $$;

revoke execute on function public.shop_client_lookup(uuid, text) from public, anon;
