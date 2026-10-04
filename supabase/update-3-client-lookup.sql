-- Jasiri update 3: find a client served in this shop by his phone number. Paste into Supabase → SQL Editor → New query → Run, once.

-- A client served by one barber can be added to another barber's book in the same
-- shop without retyping his name. Lookup is by exact phone number only (no browsing
-- other barbers' clients), returns the first name only, is limited to 30 lookups an
-- hour per barber, and every lookup is written to the audit log.

create function public.shop_client_lookup(p_shop uuid, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_phone text := public.normalize_phone(p_phone);
  v_mine uuid;
  v_name text;
begin
  if not private.has_role(p_shop, 'barber') then raise exception 'not_allowed'; end if;

  -- Already in my own book: use that record.
  select id, first_name into v_mine, v_name from public.clients where barber_id = v and phone = v_phone;
  if v_mine is not null then
    return jsonb_build_object('status', 'mine', 'client_id', v_mine, 'first_name', v_name);
  end if;

  if not public.hit_rate_limit('client-lookup:' || v, 30, 3600) then raise exception 'rate_limited'; end if;

  -- Served in this shop before, by any barber.
  select c.first_name into v_name
  from public.clients c
  where c.phone = v_phone
    and exists (select 1 from public.codes k where k.client_id = c.id and k.shop_id = p_shop)
  order by c.created_at
  limit 1;

  insert into public.audit_log (actor_id, actor_roles, shop_id, action, entity, after)
  values (v, private.my_roles(p_shop)::text[], p_shop, 'client.lookup', 'clients',
          jsonb_build_object('found', v_name is not null));

  if v_name is null then return jsonb_build_object('status', 'new'); end if;
  return jsonb_build_object('status', 'shop', 'first_name', v_name);
end $$;

revoke execute on function public.shop_client_lookup(uuid, text) from public, anon;
