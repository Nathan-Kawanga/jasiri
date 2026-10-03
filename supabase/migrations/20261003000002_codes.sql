-- The code chain: barber → (service staff) → cashier.
-- Barber, shop and display code are fixed at creation and can never change.
-- Paid, voided and cancelled codes are final. Codes are never deleted.

-- ── Client book (belongs to the barber, not the shop) ───────────────────

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.profiles (id),
  first_name text not null check (length(btrim(first_name)) between 1 and 40),
  phone text not null check (phone = public.normalize_phone(phone)),
  consent_version text not null,
  consented_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (barber_id, phone)
);

create trigger audit after insert or update or delete on public.clients
  for each row execute function private.audit_row();

-- Finds or creates a client in the caller's book. Requires the consent tick for new clients.
create function private.upsert_client(p_barber uuid, p_first_name text, p_phone text, p_consent boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_phone text := public.normalize_phone(p_phone); v_id uuid;
begin
  if v_phone is null then raise exception 'invalid_phone'; end if;
  select id into v_id from public.clients where barber_id = p_barber and phone = v_phone;
  if v_id is not null then return v_id; end if;
  if not coalesce(p_consent, false) then raise exception 'consent_required'; end if;
  if coalesce(btrim(p_first_name), '') = '' then raise exception 'name_required'; end if;
  perform private.act('client.create');
  insert into public.clients (barber_id, first_name, phone, consent_version, consented_at)
  values (p_barber, btrim(p_first_name), v_phone,
          (select value from public.app_settings where key = 'client_consent_version'), now())
  returning id into v_id;
  return v_id;
end $$;

-- ── Codes ───────────────────────────────────────────────────────────────

create type public.code_status as enum ('created', 'open', 'paid', 'voided', 'cancelled');
create type public.service_status as enum ('pending', 'in_progress', 'done', 'no_service', 'skipped');
create type public.void_reason as enum ('left_without_paying', 'mistake', 'duplicate', 'other');

create table public.codes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id),
  display_code text not null check (display_code ~ '^[2-9A-HJKMNP-Z]{4}$'),
  barber_id uuid references public.profiles (id),          -- null = service-only code
  created_by uuid not null references public.profiles (id),
  client_id uuid references public.clients (id) on delete set null,
  client_first_name text,
  has_client_phone boolean not null default false,
  booking_id uuid,
  status public.code_status not null default 'created',
  barber_amount int not null default 0 check (barber_amount between 0 and 1000000),
  created_at timestamptz not null default now(),
  created_day date not null,
  confirmed_at timestamptz,
  service_status public.service_status not null default 'pending',
  assigned_staff_id uuid references public.profiles (id),
  assigned_at timestamptz,
  service_confirmed_at timestamptz,
  service_done_at timestamptz,
  amount_paid int check (amount_paid between 0 and 10000000),
  paid_at timestamptz,
  paid_by uuid references public.profiles (id),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason public.void_reason,
  void_note text check (length(void_note) <= 200),
  cancelled_at timestamptz,
  unique (shop_id, display_code),
  check (barber_id is not null or barber_amount = 0),
  check ((status = 'paid') = (paid_at is not null and amount_paid is not null)),
  check ((status = 'voided') = (voided_at is not null and void_reason is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (status = 'created' or status = 'cancelled' or status = 'voided' or confirmed_at is not null)
);
create index codes_shop_status on public.codes (shop_id, status);
create index codes_shop_day on public.codes (shop_id, created_day);
create index codes_barber_day on public.codes (barber_id, created_day);
create index codes_staff on public.codes (assigned_staff_id) where status = 'open';
create index codes_client on public.codes (client_id);

create table public.code_service_lines (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.codes (id),
  shop_id uuid not null references public.shops (id),
  performed_by uuid not null references public.profiles (id),
  amount int not null check (amount between 1 and 1000000),
  note text check (length(note) <= 60),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id)
);
create index lines_code on public.code_service_lines (code_id);
create index lines_performer on public.code_service_lines (performed_by, added_at);

create table public.code_handovers (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.codes (id),
  shop_id uuid not null references public.shops (id),
  from_staff uuid references public.profiles (id),
  to_staff uuid not null references public.profiles (id),
  by_user uuid not null references public.profiles (id),
  at timestamptz not null default now()
);

-- ── Guards: enforced for every role, including the platform admin ───────

create function private.codes_before_insert() returns trigger
language plpgsql as $$
begin
  new.created_day := private.nairobi_date(new.created_at);
  return new;
end $$;
create trigger codes_before_insert before insert on public.codes
  for each row execute function private.codes_before_insert();

create function private.codes_guard() returns trigger
language plpgsql as $$
declare
  o jsonb := to_jsonb(old) - 'client_id' - 'client_first_name';
  n jsonb := to_jsonb(new) - 'client_id' - 'client_first_name';
begin
  if tg_op = 'DELETE' then raise exception 'codes_cannot_be_deleted'; end if;

  if new.barber_id is distinct from old.barber_id then raise exception 'barber_cannot_change'; end if;
  if new.shop_id <> old.shop_id or new.display_code <> old.display_code
     or new.created_by <> old.created_by or new.created_at <> old.created_at
     or new.created_day <> old.created_day or new.id <> old.id
     or new.booking_id is distinct from old.booking_id
     or new.has_client_phone <> old.has_client_phone then
    raise exception 'field_cannot_change';
  end if;

  -- The only change allowed on a final code: removing a deleted client's details.
  if old.status in ('paid', 'voided', 'cancelled') then
    if o = n and new.client_id is null and new.client_first_name is null then return new; end if;
    raise exception 'code_is_final';
  end if;

  if new.barber_amount <> old.barber_amount and old.status <> 'created' then
    raise exception 'amount_locked';
  end if;
  if new.client_id is distinct from old.client_id and old.status <> 'created'
     and new.client_id is not null then
    raise exception 'field_cannot_change';
  end if;

  if new.status <> old.status and not (
       (old.status = 'created' and new.status in ('open', 'voided', 'cancelled'))
    or (old.status = 'open' and new.status in ('paid', 'voided'))) then
    raise exception 'bad_transition';
  end if;
  return new;
end $$;
create trigger codes_guard before update or delete on public.codes
  for each row execute function private.codes_guard();

create function private.lines_guard() returns trigger
language plpgsql as $$
declare v_status public.code_status;
begin
  if tg_op = 'DELETE' then raise exception 'lines_cannot_be_deleted'; end if;
  select status into v_status from public.codes where id = coalesce(new.code_id, old.code_id);
  if v_status <> 'open' then raise exception 'code_is_final'; end if;
  if tg_op = 'UPDATE' then
    if new.code_id <> old.code_id or new.amount <> old.amount or new.performed_by <> old.performed_by
       or new.shop_id <> old.shop_id or new.added_at <> old.added_at
       or new.note is distinct from old.note or old.removed_at is not null then
      raise exception 'field_cannot_change';
    end if;
  end if;
  return new;
end $$;
create trigger lines_guard before insert or update or delete on public.code_service_lines
  for each row execute function private.lines_guard();

create function private.no_change() returns trigger
language plpgsql as $$ begin raise exception 'append_only'; end $$;
create trigger handovers_append_only before update or delete on public.code_handovers
  for each row execute function private.no_change();

create trigger audit after insert or update or delete on public.codes
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.code_service_lines
  for each row execute function private.audit_row();
create trigger audit after insert on public.code_handovers
  for each row execute function private.audit_row();

-- ── Code helpers ────────────────────────────────────────────────────────

create function private.lock_code(p_code uuid) returns public.codes
language plpgsql security definer set search_path = '' as $$
declare c public.codes;
begin
  select * into c from public.codes where id = p_code for update;
  if c.id is null then raise exception 'code_not_found'; end if;
  return c;
end $$;

create function private.code_lines_total(p_code uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0)::int from public.code_service_lines
  where code_id = p_code and removed_at is null
$$;

-- On-duty service staff: fewest open codes first, then longest since last assignment.
create function private.pick_staff(p_shop uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_shop::text, 2));
  select m.user_id into v
  from public.memberships m
  join public.profiles p on p.id = m.user_id and p.suspended_at is null
  where m.shop_id = p_shop and m.status = 'active' and 'service_staff' = any (m.roles)
    and m.on_duty_date = private.today()
  order by (select count(*) from public.codes c
            where c.shop_id = p_shop and c.assigned_staff_id = m.user_id and c.status = 'open'
              and c.service_status in ('pending', 'in_progress')),
           m.last_assigned_at asc nulls first, m.requested_at
  limit 1;
  if v is not null then
    update public.memberships set last_assigned_at = clock_timestamp()
    where shop_id = p_shop and user_id = v and status = 'active';
  end if;
  return v;
end $$;

create function private.insert_code(
  p_shop uuid, p_barber uuid, p_creator uuid, p_client uuid, p_first_name text,
  p_has_phone boolean, p_booking uuid, p_amount int) returns public.codes
language plpgsql security definer set search_path = '' as $$
declare c public.codes;
begin
  loop
    begin
      insert into public.codes (shop_id, display_code, barber_id, created_by, client_id,
                                client_first_name, has_client_phone, booking_id, barber_amount)
      values (p_shop, private.random_code(4), p_barber, p_creator, p_client,
              nullif(btrim(p_first_name), ''), p_has_phone, p_booking, p_amount)
      returning * into c;
      return c;
    exception when unique_violation then
      -- display code already used in this shop: draw again (codes are never reused)
    end;
  end loop;
end $$;

create function private.code_json(c public.codes) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'display_code', c.display_code, 'status', c.status,
    'service_status', c.service_status, 'barber_amount', c.barber_amount,
    'client_first_name', c.client_first_name,
    'assigned_staff_id', c.assigned_staff_id,
    'assigned_staff_name', (select full_name from public.profiles where id = c.assigned_staff_id),
    'lines_total', private.code_lines_total(c.id),
    'expected_total', c.barber_amount + private.code_lines_total(c.id),
    'amount_paid', c.amount_paid)
$$;

-- ── Barber: create, cancel, client confirm ──────────────────────────────

-- p_client: a client from the barber's book; or p_new_first_name + p_new_phone + p_consent
-- for a new client; or p_anonymous for "No details". p_booking preselects from a booking.
create function public.create_code(
  p_request uuid, p_shop uuid, p_amount int,
  p_client uuid default null, p_new_first_name text default null, p_new_phone text default null,
  p_consent boolean default false, p_anonymous boolean default false, p_booking uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'create_code');
  v_client uuid;
  v_name text;
  v_has_phone boolean := false;
  c public.codes;
begin
  if v_resp is not null then return v_resp; end if;
  if not private.has_role(p_shop, 'barber') then raise exception 'not_allowed'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'amount_required'; end if;

  if p_booking is not null then
    select client_id into v_client from public.bookings
    where id = p_booking and barber_id = v and status = 'booked' for update;
    if not found then raise exception 'booking_not_found'; end if;
  elsif p_client is not null then
    v_client := p_client;
  elsif not coalesce(p_anonymous, false) then
    v_client := private.upsert_client(v, p_new_first_name, p_new_phone, p_consent);
  end if;

  if v_client is not null then
    select first_name into v_name from public.clients where id = v_client and barber_id = v;
    if not found then raise exception 'client_not_found'; end if;
    v_has_phone := true;
  end if;

  perform private.act('code.create');
  c := private.insert_code(p_shop, v, v, v_client, v_name, v_has_phone, p_booking, p_amount);

  if p_booking is not null then
    perform private.act('booking.start_code');
    update public.bookings set status = 'completed', code_id = c.id where id = p_booking;
  end if;
  return private.idem_store(p_request, private.code_json(c));
end $$;

-- Service-only code (no barber): created by service staff for a client who only wants her services.
create function public.create_service_code(p_request uuid, p_shop uuid, p_first_name text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'create_service_code');
  c public.codes;
begin
  if v_resp is not null then return v_resp; end if;
  if not private.has_role(p_shop, 'service_staff') then raise exception 'not_allowed'; end if;
  perform private.act('code.create_service_only');
  c := private.insert_code(p_shop, null, v, null, p_first_name, false, null, 0);
  return private.idem_store(p_request, private.code_json(c));
end $$;

create function public.cancel_code(p_request uuid, p_code uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'cancel_code');
  c public.codes := private.lock_code(p_code);
begin
  if v_resp is not null then return v_resp; end if;
  if c.created_by <> v then raise exception 'not_allowed'; end if;
  if c.status <> 'created' then raise exception 'already_confirmed'; end if;
  perform private.act('code.cancel');
  update public.codes set status = 'cancelled', cancelled_at = now() where id = p_code returning * into c;
  if c.booking_id is not null then
    perform private.act('booking.reopen');
    update public.bookings set status = 'booked', code_id = null where id = c.booking_id;
  end if;
  return private.idem_store(p_request, private.code_json(c));
end $$;

-- The client's tap on the creator's phone. Opens the code: it now shows on the
-- service staff queue and the cashier screen at the same time.
create function public.confirm_code(p_request uuid, p_code uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'confirm_code');
  c public.codes := private.lock_code(p_code);
  v_staff uuid;
begin
  if v_resp is not null then return v_resp; end if;
  if c.created_by <> v then raise exception 'not_allowed'; end if;
  if c.status <> 'created' then raise exception 'already_confirmed'; end if;
  if c.barber_id is null then
    v_staff := v;   -- service-only code stays with the staff member who made it
  else
    v_staff := private.pick_staff(c.shop_id);
  end if;
  perform private.act('code.confirm');
  update public.codes set status = 'open', confirmed_at = now(),
    assigned_staff_id = v_staff, assigned_at = case when v_staff is not null then now() end,
    service_status = case when c.barber_id is null then 'in_progress'::public.service_status else 'pending' end,
    service_confirmed_at = case when c.barber_id is null then now() end
  where id = p_code returning * into c;
  return private.idem_store(p_request, private.code_json(c));
end $$;

-- ── Service staff ───────────────────────────────────────────────────────

create function private.require_service_on(c public.codes) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not private.has_role(c.shop_id, 'service_staff') then raise exception 'not_allowed'; end if;
  if c.status <> 'open' then raise exception 'code_not_open'; end if;
  if c.service_status not in ('pending', 'in_progress') then raise exception 'service_closed'; end if;
  return v;
end $$;

create function public.take_code(p_request uuid, p_code uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_resp jsonb := private.idem_claim(p_request, 'take_code');
  c public.codes := private.lock_code(p_code);
  v uuid := private.require_service_on(c);
begin
  if v_resp is not null then return v_resp; end if;
  if c.assigned_staff_id is not null then raise exception 'already_assigned'; end if;
  perform private.act('code.take');
  update public.codes set assigned_staff_id = v, assigned_at = now() where id = p_code returning * into c;
  update public.memberships set last_assigned_at = now()
  where shop_id = c.shop_id and user_id = v and status = 'active';
  return private.idem_store(p_request, private.code_json(c));
end $$;

create function public.handover_code(p_request uuid, p_code uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_resp jsonb := private.idem_claim(p_request, 'handover_code');
  c public.codes := private.lock_code(p_code);
  v uuid := private.require_service_on(c);
begin
  if v_resp is not null then return v_resp; end if;
  if c.assigned_staff_id is distinct from v then raise exception 'not_your_code'; end if;
  if p_to = v then raise exception 'pick_someone_else'; end if;
  if not exists (select 1 from public.memberships where shop_id = c.shop_id and user_id = p_to
                 and status = 'active' and 'service_staff' = any (roles)) then
    raise exception 'not_service_staff';
  end if;
  perform private.act('code.handover');
  insert into public.code_handovers (code_id, shop_id, from_staff, to_staff, by_user)
  values (c.id, c.shop_id, v, p_to, v);
  update public.codes set assigned_staff_id = p_to, assigned_at = now() where id = p_code returning * into c;
  return private.idem_store(p_request, private.code_json(c));
end $$;

-- The client's tap on the service staff screen when he reaches her.
create function public.service_start(p_request uuid, p_code uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_resp jsonb := private.idem_claim(p_request, 'service_start');
  c public.codes := private.lock_code(p_code);
  v uuid := private.require_service_on(c);
begin
  if v_resp is not null then return v_resp; end if;
  if c.assigned_staff_id is distinct from v then raise exception 'not_your_code'; end if;
  if c.service_status = 'pending' then
    perform private.act('code.service_start');
    update public.codes set service_status = 'in_progress', service_confirmed_at = now()
    where id = p_code returning * into c;
  end if;
  return private.idem_store(p_request, private.code_json(c));
end $$;

create function public.add_service_line(p_request uuid, p_code uuid, p_amount int, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_resp jsonb := private.idem_claim(p_request, 'add_service_line');
  c public.codes := private.lock_code(p_code);
  v uuid := private.require_service_on(c);
begin
  if v_resp is not null then return v_resp; end if;
  if c.assigned_staff_id is distinct from v then raise exception 'not_your_code'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'amount_required'; end if;
  perform private.act('code.service_add');
  insert into public.code_service_lines (code_id, shop_id, performed_by, amount, note)
  values (c.id, c.shop_id, v, p_amount, nullif(btrim(p_note), ''));
  if c.service_status = 'pending' then
    update public.codes set service_status = 'in_progress', service_confirmed_at = now()
    where id = p_code returning * into c;
  end if;
  return private.idem_store(p_request, private.code_json(c));
end $$;

create function public.remove_service_line(p_request uuid, p_line uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_resp jsonb := private.idem_claim(p_request, 'remove_service_line');
  l public.code_service_lines;
  c public.codes;
  v uuid;
begin
  if v_resp is not null then return v_resp; end if;
  select * into l from public.code_service_lines where id = p_line;
  if l.id is null or l.removed_at is not null then raise exception 'line_not_found'; end if;
  c := private.lock_code(l.code_id);
  v := private.require_service_on(c);
  if l.performed_by <> v then raise exception 'not_your_line'; end if;
  perform private.act('code.service_remove');
  update public.code_service_lines set removed_at = now(), removed_by = v where id = p_line;
  return private.idem_store(p_request, private.code_json(c));
end $$;

-- "Done" (with services) or "No service". The code stays open for the cashier.
create function public.finish_service(p_request uuid, p_code uuid, p_no_service boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_resp jsonb := private.idem_claim(p_request, 'finish_service');
  c public.codes := private.lock_code(p_code);
  v uuid := private.require_service_on(c);
  v_lines int := private.code_lines_total(p_code);
begin
  if v_resp is not null then return v_resp; end if;
  if c.assigned_staff_id is not null and c.assigned_staff_id <> v then raise exception 'not_your_code'; end if;
  if not p_no_service and v_lines = 0 then raise exception 'add_a_service_first'; end if;
  if p_no_service and v_lines > 0 then raise exception 'remove_services_first'; end if;
  perform private.act(case when p_no_service then 'code.no_service' else 'code.service_done' end);
  update public.codes set
    service_status = case when p_no_service then 'no_service'::public.service_status else 'done' end,
    service_done_at = now(),
    assigned_staff_id = coalesce(assigned_staff_id, v)
  where id = p_code returning * into c;
  return private.idem_store(p_request, private.code_json(c));
end $$;

-- ── Cashier ─────────────────────────────────────────────────────────────

-- The client taps his code on the cashier's screen after paying. The cashier types
-- what was actually paid. How he paid is never recorded. Happens once.
create function public.pay_code(p_request uuid, p_code uuid, p_amount_paid int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'pay_code');
  c public.codes := private.lock_code(p_code);
begin
  if v_resp is not null then return v_resp; end if;
  if not private.has_role(c.shop_id, 'cashier') then raise exception 'not_allowed'; end if;
  if c.status = 'paid' then raise exception 'already_paid'; end if;
  if c.status <> 'open' then raise exception 'code_not_open'; end if;
  if p_amount_paid is null or p_amount_paid < 0 then raise exception 'amount_required'; end if;
  perform private.act('code.pay');
  update public.codes set
    status = 'paid', paid_at = now(), paid_by = v, amount_paid = p_amount_paid,
    service_status = case
      when service_status in ('pending', 'in_progress') and private.code_lines_total(id) > 0 then 'done'::public.service_status
      when service_status in ('pending', 'in_progress') then 'skipped'
      else service_status end,
    service_done_at = coalesce(service_done_at, now())
  where id = p_code returning * into c;
  return private.idem_store(p_request, private.code_json(c));
end $$;

create function public.void_code(p_request uuid, p_code uuid, p_reason public.void_reason, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'void_code');
  c public.codes := private.lock_code(p_code);
begin
  if v_resp is not null then return v_resp; end if;
  perform private.require_role(c.shop_id, 'cashier', 'manager');
  if p_reason is null then raise exception 'reason_required'; end if;
  if p_reason = 'other' and coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  if c.status not in ('created', 'open') then raise exception 'code_is_final'; end if;
  perform private.act('code.void');
  update public.codes set status = 'voided', voided_at = now(), voided_by = v,
    void_reason = p_reason, void_note = nullif(btrim(p_note), '')
  where id = p_code returning * into c;
  return private.idem_store(p_request, private.code_json(c));
end $$;

-- ── Reads ───────────────────────────────────────────────────────────────

create function private.performed_on(p_code uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.code_service_lines
                 where code_id = p_code and performed_by = auth.uid())
$$;
grant execute on function private.performed_on(uuid) to authenticated;

alter table public.clients enable row level security;
alter table public.codes enable row level security;
alter table public.code_service_lines enable row level security;
alter table public.code_handovers enable row level security;
revoke all on public.clients, public.codes, public.code_service_lines, public.code_handovers
  from anon, authenticated;

-- Only the barber reads his own clients (with phone numbers). Nobody else.
grant select on public.clients to authenticated;
create policy clients_own on public.clients for select to authenticated
  using (barber_id = (select auth.uid()) and private.is_active_user());

-- Codes never carry a phone number: only the client's first name.
grant select on public.codes to authenticated;
create policy codes_read on public.codes for select to authenticated using (
  private.is_admin()
  or barber_id = (select auth.uid())
  or created_by = (select auth.uid())
  or assigned_staff_id = (select auth.uid())
  or private.performed_on(id)
  or private.has_role(shop_id, 'manager')
  or (status = 'open' and assigned_staff_id is null and private.has_role(shop_id, 'service_staff'))
  or (private.has_role(shop_id, 'cashier')
      and (status = 'open'
           or private.nairobi_date(coalesce(paid_at, voided_at)) = private.today()))
);

grant select on public.code_service_lines to authenticated;
create policy lines_read on public.code_service_lines for select to authenticated using (
  performed_by = (select auth.uid())
  or exists (select 1 from public.codes c where c.id = code_id)
);

grant select on public.code_handovers to authenticated;
create policy handovers_read on public.code_handovers for select to authenticated using (
  private.is_admin() or private.has_role(shop_id, 'manager')
  or from_staff = (select auth.uid()) or to_staff = (select auth.uid())
);

-- Live queues.
alter publication supabase_realtime add table public.codes;
alter publication supabase_realtime add table public.code_service_lines;
