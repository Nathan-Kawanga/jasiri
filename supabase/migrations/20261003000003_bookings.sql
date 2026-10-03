-- Client book stats, bookable times, bookings and the public booking page.

-- ── Bookable times ──────────────────────────────────────────────────────

-- Weekly pattern: weekday (0 = Sunday … 6 = Saturday) with a start and end time.
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.profiles (id),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index availability_rules_barber on public.availability_rules (barber_id);

-- One-off blocks: an off day or a busy stretch.
create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.profiles (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null check (kind in ('off', 'busy')),
  note text check (length(note) <= 80),
  check (ends_at > starts_at)
);
create index availability_blocks_barber on public.availability_blocks (barber_id, starts_at);

create type public.booking_status as enum ('booked', 'cancelled', 'no_show', 'completed');

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.profiles (id),
  client_id uuid references public.clients (id) on delete set null,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  status public.booking_status not null default 'booked',
  source text not null check (source in ('link', 'manual')),
  cancel_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  code_id uuid references public.codes (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (slot_end > slot_start),
  -- One active booking per time: two clients racing for a slot cannot both win.
  constraint bookings_no_overlap exclude using gist (
    barber_id with =, tstzrange(slot_start, slot_end) with &&) where (status = 'booked')
);
create index bookings_barber_start on public.bookings (barber_id, slot_start);
create index bookings_client on public.bookings (client_id);

alter table public.codes add constraint codes_booking_fk
  foreign key (booking_id) references public.bookings (id);

create trigger audit after insert or update or delete on public.availability_rules
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.availability_blocks
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.bookings
  for each row execute function private.audit_row();

-- All bookable slot starts for a barber between two dates (Nairobi), with whether each is free.
create function private.barber_slots(p_barber uuid, p_from date, p_days int)
returns table (slot_start timestamptz, slot_end timestamptz, is_free boolean)
language sql stable security definer set search_path = '' as $$
  with p as (select slot_minutes from public.profiles where id = p_barber),
  days as (select (p_from + i)::date d from generate_series(0, p_days - 1) i),
  starts as (
    select distinct (t at time zone 'Africa/Nairobi') as s
    from days
    join public.availability_rules r on r.barber_id = p_barber and r.weekday = extract(dow from d)
    cross join p
    cross join lateral generate_series(
      d + r.start_time, d + r.end_time - make_interval(mins => p.slot_minutes),
      make_interval(mins => p.slot_minutes)) as t
  )
  select s, s + make_interval(mins => (select slot_minutes from p)),
    not exists (select 1 from public.bookings b
                where b.barber_id = p_barber and b.status = 'booked'
                  and tstzrange(b.slot_start, b.slot_end) && tstzrange(s, s + make_interval(mins => (select slot_minutes from p))))
  from starts
  where s > now()
    and not exists (select 1 from public.availability_blocks k
                    where k.barber_id = p_barber
                      and tstzrange(k.starts_at, k.ends_at) && tstzrange(s, s + make_interval(mins => (select slot_minutes from p))))
  order by s
$$;

-- ── Barber: availability ───────────────────────────────────────────────

-- Replaces the weekly pattern. p_rules: [{weekday, start_time, end_time}, …]
create function public.set_availability(p_request uuid, p_rules jsonb, p_slot_minutes int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'set_availability');
begin
  if v_resp is not null then return v_resp; end if;
  if not (select is_barber from public.profiles where id = v) then raise exception 'not_allowed'; end if;
  perform private.act('availability.set');
  update public.profiles set slot_minutes = p_slot_minutes where id = v and slot_minutes <> p_slot_minutes;
  delete from public.availability_rules where barber_id = v;
  insert into public.availability_rules (barber_id, weekday, start_time, end_time)
  select v, (r ->> 'weekday')::smallint, (r ->> 'start_time')::time, (r ->> 'end_time')::time
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) r;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

create function public.add_block(p_request uuid, p_starts timestamptz, p_ends timestamptz, p_kind text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'add_block');
  v_id uuid;
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act('availability.block_add');
  insert into public.availability_blocks (barber_id, starts_at, ends_at, kind, note)
  values (v, p_starts, p_ends, p_kind, nullif(btrim(p_note), '')) returning id into v_id;
  return private.idem_store(p_request, jsonb_build_object('id', v_id));
end $$;

create function public.remove_block(p_request uuid, p_block uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'remove_block');
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act('availability.block_remove');
  delete from public.availability_blocks where id = p_block and barber_id = v;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

-- ── Bookings ───────────────────────────────────────────────────────────

create function private.insert_booking(p_barber uuid, p_client uuid, p_start timestamptz, p_source text)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_minutes int := (select slot_minutes from public.profiles where id = p_barber);
begin
  if p_start <= now() then raise exception 'slot_in_past'; end if;
  -- One active future booking per client per barber.
  perform pg_advisory_xact_lock(hashtextextended(p_barber::text, 3));
  if exists (select 1 from public.bookings where barber_id = p_barber and client_id = p_client
             and status = 'booked' and slot_start > now()) then
    raise exception 'already_booked';
  end if;
  begin
    insert into public.bookings (barber_id, client_id, slot_start, slot_end, source)
    values (p_barber, p_client, p_start, p_start + make_interval(mins => v_minutes), p_source)
    returning * into b;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;
  return b;
end $$;

-- Manual booking by the barber for a client who texted him. Any future time.
create function public.manual_booking(
  p_request uuid, p_slot_start timestamptz, p_client uuid default null,
  p_new_first_name text default null, p_new_phone text default null, p_consent boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'manual_booking');
  v_client uuid := p_client;
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
  perform private.act('booking.create_manual');
  b := private.insert_booking(v, v_client, p_slot_start, 'manual');
  return private.idem_store(p_request, jsonb_build_object('id', b.id, 'slot_start', b.slot_start));
end $$;

create function public.update_booking_status(p_request uuid, p_booking uuid, p_status public.booking_status)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'update_booking_status');
  b public.bookings;
begin
  if v_resp is not null then return v_resp; end if;
  if p_status not in ('cancelled', 'no_show') then raise exception 'bad_transition'; end if;
  select * into b from public.bookings where id = p_booking and barber_id = v for update;
  if b.id is null then raise exception 'booking_not_found'; end if;
  if b.status <> 'booked' then raise exception 'bad_transition'; end if;
  perform private.act(case when p_status = 'no_show' then 'booking.no_show' else 'booking.cancel_barber' end);
  update public.bookings set status = p_status,
    cancelled_at = case when p_status = 'cancelled' then now() end
  where id = p_booking;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

-- Barber's day: bookings plus free bookable slots, in time order.
create function public.my_day(p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  return jsonb_build_object(
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'slot_start', b.slot_start, 'slot_end', b.slot_end, 'status', b.status,
        'source', b.source, 'client_id', b.client_id, 'client_first_name', c.first_name,
        'client_phone', c.phone, 'code_id', b.code_id) order by b.slot_start)
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

-- Upcoming bookings (next 7 days) for the barber's list.
create function public.my_upcoming_bookings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'slot_start', b.slot_start, 'status', b.status, 'source', b.source,
    'client_first_name', c.first_name, 'client_phone', c.phone) order by b.slot_start), '[]'::jsonb)
  from public.bookings b left join public.clients c on c.id = b.client_id
  where b.barber_id = auth.uid() and b.status = 'booked' and b.slot_start > now()
    and b.slot_start < now() + interval '30 days'
$$;

-- ── Client book ────────────────────────────────────────────────────────

-- Verified visits = paid codes. "Due" when the usual gap since the last visit has passed.
create function public.my_client_book(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user(); q text := nullif(btrim(p_search), '');
begin
  return coalesce((
    with visits as (
      select c.client_id, c.paid_at, c.barber_amount
      from public.codes c where c.barber_id = v and c.status = 'paid' and c.client_id is not null
    ), stats as (
      select cl.id, cl.first_name, cl.phone, cl.created_at,
        count(vi.paid_at) as visits,
        max(vi.paid_at) as last_visit,
        coalesce(sum(vi.barber_amount), 0) as total_spent,
        case when count(vi.paid_at) >= 2 then
          extract(epoch from (max(vi.paid_at) - min(vi.paid_at))) / 86400.0 / (count(vi.paid_at) - 1)
        end as avg_gap_days
      from public.clients cl left join visits vi on vi.client_id = cl.id
      where cl.barber_id = v
        and (q is null or cl.first_name ilike '%' || q || '%' or right(cl.phone, length(q)) = q
             or cl.phone like '%' || q)
      group by cl.id
    )
    select jsonb_agg(jsonb_build_object(
      'id', id, 'first_name', first_name, 'phone', phone, 'created_at', created_at,
      'visits', visits, 'last_visit', last_visit, 'total_spent', total_spent,
      'avg_gap_days', round(avg_gap_days::numeric, 1),
      'days_since', case when last_visit is not null
                         then floor(extract(epoch from (now() - last_visit)) / 86400) end,
      'due', avg_gap_days is not null and extract(epoch from (now() - last_visit)) / 86400.0 >= avg_gap_days)
      order by (avg_gap_days is not null and extract(epoch from (now() - last_visit)) / 86400.0 >= avg_gap_days) desc,
               last_visit desc nulls last, first_name)
    from stats), '[]'::jsonb);
end $$;

create function public.add_client(p_request uuid, p_first_name text, p_phone text, p_consent boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'add_client');
  v_id uuid;
begin
  if v_resp is not null then return v_resp; end if;
  if not (select is_barber from public.profiles where id = v) then raise exception 'not_allowed'; end if;
  v_id := private.upsert_client(v, p_first_name, p_phone, p_consent);
  return private.idem_store(p_request, jsonb_build_object('id', v_id));
end $$;

create function public.rename_client(p_request uuid, p_client uuid, p_first_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'rename_client');
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act('client.rename');
  update public.clients set first_name = btrim(p_first_name) where id = p_client and barber_id = v;
  if not found then raise exception 'client_not_found'; end if;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

-- ── Public booking page (server-only: called with the service key, rate-limited) ──

create function private.public_barber(p_handle text) returns public.profiles
language sql stable security definer set search_path = '' as $$
  select * from public.profiles
  where handle = lower(btrim(p_handle)) and is_barber and suspended_at is null
$$;

create function public.public_barber_page(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles := private.public_barber(p_handle);
begin
  if p.id is null then return null; end if;
  return jsonb_build_object(
    'name', p.full_name, 'handle', p.handle, 'about', p.about, 'slot_minutes', p.slot_minutes,
    'shop', (select jsonb_build_object('name', s.name, 'area', s.area)
             from public.memberships m join public.shops s on s.id = m.shop_id and s.suspended_at is null
             where m.user_id = p.id and m.status = 'active' and 'barber' = any (m.roles)
             order by m.decided_at desc nulls last limit 1),
    'slots', coalesce((select jsonb_agg(s.slot_start order by s.slot_start)
                       from private.barber_slots(p.id, private.today(), 7) s where s.is_free), '[]'::jsonb));
end $$;

-- Whether this number is already in this barber's book (so the name step can be skipped).
-- Never returns the stored name.
create function public.public_phone_known(p_handle text, p_phone text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles := private.public_barber(p_handle);
begin
  if p.id is null then raise exception 'barber_not_found'; end if;
  return exists (select 1 from public.clients where barber_id = p.id and phone = public.normalize_phone(p_phone));
end $$;

create function public.public_book(
  p_request uuid, p_handle text, p_slot_start timestamptz, p_phone text,
  p_first_name text default null, p_consent boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_resp jsonb := private.idem_claim(p_request, 'public_book');
  p public.profiles := private.public_barber(p_handle);
  v_client uuid;
  b public.bookings;
begin
  if v_resp is not null then return v_resp; end if;
  if p.id is null then raise exception 'barber_not_found'; end if;
  if not exists (select 1 from private.barber_slots(p.id, private.today(), 7) s
                 where s.slot_start = p_slot_start) then
    raise exception 'slot_not_bookable';
  end if;
  v_client := private.upsert_client(p.id, p_first_name, p_phone, p_consent);
  perform private.act('booking.create_link');
  b := private.insert_booking(p.id, v_client, p_slot_start, 'link');
  return private.idem_store(p_request, jsonb_build_object(
    'slot_start', b.slot_start, 'barber_name', p.full_name,
    'masked_phone', public.mask_phone(public.normalize_phone(p_phone)),
    'cancel_token', b.cancel_token));
end $$;

create function public.public_booking(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slot_start', b.slot_start, 'status', b.status,
    'barber_name', p.full_name, 'handle', p.handle, 'masked_phone', public.mask_phone(c.phone))
  from public.bookings b join public.profiles p on p.id = b.barber_id
  left join public.clients c on c.id = b.client_id
  where b.cancel_token = p_token
$$;

create function public.public_cancel(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where cancel_token = p_token for update;
  if b.id is null then raise exception 'booking_not_found'; end if;
  if b.status = 'booked' and b.slot_start > now() then
    perform private.act('booking.cancel_client');
    update public.bookings set status = 'cancelled', cancelled_at = now() where id = b.id;
  end if;
  return public.public_booking(p_token);
end $$;

-- ── RLS ────────────────────────────────────────────────────────────────

alter table public.availability_rules enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.bookings enable row level security;
revoke all on public.availability_rules, public.availability_blocks, public.bookings from anon, authenticated;

grant select on public.availability_rules, public.availability_blocks to authenticated;
create policy rules_own on public.availability_rules for select to authenticated
  using (barber_id = (select auth.uid()));
create policy blocks_own on public.availability_blocks for select to authenticated
  using (barber_id = (select auth.uid()));

grant select (id, barber_id, client_id, slot_start, slot_end, status, source, code_id, created_at, cancelled_at)
  on public.bookings to authenticated;
create policy bookings_own on public.bookings for select to authenticated
  using (barber_id = (select auth.uid()) or private.is_admin());
