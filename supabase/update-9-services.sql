-- Jasiri update 9: services and prices. Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.
-- Every barber and service staff member keeps their own list of services and prices
-- (it belongs to the person and moves with them). Clients pick services when booking a
-- barber: his own services plus "extras" from the service staff in his current shop.
-- Prices on a booking are taken from the lists, never from the client's phone.
-- Safe to run more than once.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id),
  name text not null check (length(btrim(name)) between 1 and 40),
  price int not null check (price between 0 and 100000),
  minutes int check (minutes between 5 and 480),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists services_owner on public.services (owner_id, sort);

alter table public.services enable row level security;
revoke all on public.services from anon, authenticated;
grant select on public.services to authenticated;
drop policy if exists services_own on public.services;
create policy services_own on public.services for select to authenticated
  using (owner_id = (select auth.uid()));
drop trigger if exists audit on public.services;
create trigger audit after insert or update or delete on public.services
  for each row execute function private.audit_row();

-- Chosen services on a booking: [{name, price, kind: 'barber' | 'extra'}], copied at booking time.
alter table public.bookings add column if not exists services jsonb not null default '[]'::jsonb;
grant select (services) on public.bookings to authenticated;

-- Replace my whole list. p_items: [{name, price, minutes?}, …] in display order.
create or replace function public.save_my_services(p_request uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'save_my_services');
begin
  if v_resp is not null then return v_resp; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 30 then raise exception 'too_many_services'; end if;
  perform private.act('services.save');
  delete from public.services where owner_id = v;
  insert into public.services (owner_id, name, price, minutes, sort)
  select v, btrim(i ->> 'name'), (i ->> 'price')::int, nullif(i ->> 'minutes', '')::int, ord::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, ord)
  where btrim(coalesce(i ->> 'name', '')) <> '';
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

create or replace function public.my_services() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'minutes', minutes) order by sort, name), '[]'::jsonb)
  from public.services where owner_id = auth.uid()
$$;

-- The shop a barber currently works in (most recently approved).
create or replace function private.barber_shop(p_barber uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.shop_id from public.memberships m join public.shops s on s.id = m.shop_id and s.suspended_at is null
  where m.user_id = p_barber and m.status = 'active' and 'barber' = any (m.roles)
  order by m.decided_at desc nulls last limit 1
$$;

-- Extras offered by the service staff in a shop: one row per service name, lowest price.
create or replace function private.shop_extras(p_shop uuid) returns table (name text, price int)
language sql stable security definer set search_path = '' as $$
  select min(sv.name), min(sv.price)::int
  from public.services sv
  join public.memberships m on m.user_id = sv.owner_id and m.shop_id = p_shop and m.status = 'active'
       and 'service_staff' = any (m.roles)
  where p_shop is not null
  group by lower(sv.name)
  order by 2, 1
$$;

-- Turns the names a client picked into a priced snapshot. Unknown names are refused.
create or replace function private.resolve_services(p_barber uuid, p_names jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  n text;
  r jsonb := '[]'::jsonb;
  v_price int;
  v_name text;
  v_shop uuid := private.barber_shop(p_barber);
begin
  if p_names is null or jsonb_typeof(p_names) <> 'array' then return '[]'::jsonb; end if;
  if jsonb_array_length(p_names) > 8 then raise exception 'too_many_services'; end if;
  -- Keep the order the client picked them in; ignore repeats.
  for n in select lower(btrim(x)) from jsonb_array_elements_text(p_names) with ordinality t(x, o)
           group by 1 order by min(o) loop
    select sv.name, sv.price into v_name, v_price from public.services sv
    where sv.owner_id = p_barber and lower(sv.name) = n limit 1;
    if v_name is not null then
      r := r || jsonb_build_object('name', v_name, 'price', v_price, 'kind', 'barber');
      continue;
    end if;
    select e.name, e.price into v_name, v_price from private.shop_extras(v_shop) e where lower(e.name) = n;
    if v_name is null then raise exception 'service_not_found'; end if;
    r := r || jsonb_build_object('name', v_name, 'price', v_price, 'kind', 'extra');
    v_name := null;
  end loop;
  return r;
end $$;

-- Public page now lists the barber's services and the shop's extras.
create or replace function public.public_barber_page(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles := private.public_barber(p_handle);
  v_shop uuid;
begin
  if p.id is null then return null; end if;
  v_shop := private.barber_shop(p.id);
  return jsonb_build_object(
    'name', p.full_name, 'handle', p.handle, 'about', p.about, 'slot_minutes', p.slot_minutes,
    'photo_path', p.photo_path,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'caption', f.caption) order by f.created_at desc)
                        from public.portfolio_photos f where f.barber_id = p.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('name', sv.name, 'price', sv.price, 'minutes', sv.minutes) order by sv.sort, sv.name)
                          from public.services sv where sv.owner_id = p.id), '[]'::jsonb),
    'extras', coalesce((select jsonb_agg(jsonb_build_object('name', e.name, 'price', e.price)) from private.shop_extras(v_shop) e), '[]'::jsonb),
    'shop', (select jsonb_build_object('name', s.name, 'area', s.area) from public.shops s where s.id = v_shop),
    'slots', coalesce((select jsonb_agg(s.slot_start order by s.slot_start)
                       from private.barber_slots(p.id, private.today(), 7) s where s.is_free), '[]'::jsonb));
end $$;

-- Booking from the public link, with chosen services.
drop function if exists public.public_book(uuid, text, timestamptz, text, text, boolean);
create or replace function public.public_book(
  p_request uuid, p_handle text, p_slot_start timestamptz, p_phone text,
  p_first_name text default null, p_consent boolean default false, p_services jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_resp jsonb := private.idem_claim(p_request, 'public_book');
  p public.profiles := private.public_barber(p_handle);
  v_client uuid;
  v_services jsonb;
  b public.bookings;
begin
  if v_resp is not null then return v_resp; end if;
  if p.id is null then raise exception 'barber_not_found'; end if;
  if not exists (select 1 from private.barber_slots(p.id, private.today(), 7) s
                 where s.slot_start = p_slot_start) then
    raise exception 'slot_not_bookable';
  end if;
  v_services := private.resolve_services(p.id, p_services);
  v_client := private.upsert_client(p.id, p_first_name, p_phone, p_consent);
  perform private.act('booking.create_link');
  b := private.insert_booking(p.id, v_client, p_slot_start, 'link');
  update public.bookings set services = v_services where id = b.id;
  return private.idem_store(p_request, jsonb_build_object(
    'slot_start', b.slot_start, 'barber_name', p.full_name,
    'masked_phone', public.mask_phone(public.normalize_phone(p_phone)),
    'cancel_token', b.cancel_token, 'services', v_services));
end $$;

-- Manual booking by the barber, also with services.
drop function if exists public.manual_booking(uuid, timestamptz, uuid, text, text, boolean);
create or replace function public.manual_booking(
  p_request uuid, p_slot_start timestamptz, p_client uuid default null,
  p_new_first_name text default null, p_new_phone text default null, p_consent boolean default false,
  p_services jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'manual_booking');
  v_client uuid := p_client;
  v_services jsonb;
  b public.bookings;
begin
  if v_resp is not null then return v_resp; end if;
  if not (select is_barber from public.profiles where id = v) then raise exception 'not_allowed'; end if;
  if v_client is null then
    v_client := private.upsert_client(v, p_new_first_name, p_new_phone, p_consent);
  elsif not exists (select 1 from public.clients where id = v_client and barber_id = v) then
    raise exception 'client_not_found';
  end if;
  if p_slot_start > now() + interval '60 days' then raise exception 'too_far_ahead'; end if;
  v_services := private.resolve_services(v, p_services);
  perform private.act('booking.create_manual');
  b := private.insert_booking(v, v_client, p_slot_start, 'manual');
  update public.bookings set services = v_services where id = b.id;
  return private.idem_store(p_request, jsonb_build_object('id', b.id, 'slot_start', b.slot_start));
end $$;

-- The barber's day and upcoming list show the chosen services.
create or replace function public.my_day(p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  return jsonb_build_object(
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'slot_start', b.slot_start, 'slot_end', b.slot_end, 'status', b.status,
        'source', b.source, 'client_id', b.client_id, 'client_first_name', c.first_name,
        'client_phone', c.phone, 'code_id', b.code_id, 'services', b.services) order by b.slot_start)
      from public.bookings b left join public.clients c on c.id = b.client_id
      where b.barber_id = v and private.nairobi_date(b.slot_start) = p_date), '[]'::jsonb),
    'free_slots', coalesce((
      select jsonb_agg(jsonb_build_object('slot_start', s.slot_start, 'slot_end', s.slot_end) order by s.slot_start)
      from private.barber_slots(v, p_date, 1) s where s.is_free), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', weekday, 'start_time', start_time, 'end_time', end_time)
                       order by weekday, start_time)
      from public.availability_rules where barber_id = v), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'starts_at', starts_at, 'ends_at', ends_at, 'kind', kind, 'note', note)
                       order by starts_at)
      from public.availability_blocks where barber_id = v and ends_at > now()), '[]'::jsonb));
end $$;

create or replace function public.my_upcoming_bookings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'slot_start', b.slot_start, 'status', b.status, 'source', b.source,
    'client_first_name', c.first_name, 'client_phone', c.phone, 'services', b.services) order by b.slot_start), '[]'::jsonb)
  from public.bookings b left join public.clients c on c.id = b.client_id
  where b.barber_id = auth.uid() and b.status = 'booked' and b.slot_start > now()
    and b.slot_start < now() + interval '30 days'
$$;

-- Server-only functions stay server-only; signed-in users get the rest.
revoke execute on function public.public_barber_page(text) from public, anon, authenticated;
revoke execute on function public.public_book(uuid, text, timestamptz, text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.public_barber_page(text), public.public_book(uuid, text, timestamptz, text, text, boolean, jsonb) to service_role;
revoke execute on function public.save_my_services(uuid, jsonb), public.my_services(),
  public.manual_booking(uuid, timestamptz, uuid, text, text, boolean, jsonb) from public, anon;
grant execute on function public.save_my_services(uuid, jsonb), public.my_services(),
  public.manual_booking(uuid, timestamptz, uuid, text, text, boolean, jsonb) to authenticated;
revoke execute on function private.barber_shop(uuid), private.shop_extras(uuid), private.resolve_services(uuid, jsonb) from public;
