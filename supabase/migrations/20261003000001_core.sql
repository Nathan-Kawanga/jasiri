-- Jasiri core: helpers, people, shops, memberships, audit log, idempotency.
-- Business rules live here so the web app and a future Android app share them.
-- Errors are raised with a short machine code as the message (e.g. 'not_allowed');
-- the UI maps codes to plain words in src/lib/strings.ts.

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ── Time and phone helpers ──────────────────────────────────────────────

-- Every "day" in Jasiri is a calendar day in Nairobi, reset at midnight.
create function private.nairobi_date(ts timestamptz) returns date
language sql immutable as $$ select (ts at time zone 'Africa/Nairobi')::date $$;

create function private.today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Nairobi')::date $$;

-- Accepts 07XXXXXXXX, 01XXXXXXXX, 2547..., +2547..., 2541..., +2541...
-- Returns E.164 (+2547XXXXXXXX). Anything else is rejected.
create function public.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '[\s-]', '', 'g');
  if d ~ '^\+254[17][0-9]{8}$' then return d; end if;
  if d ~ '^254[17][0-9]{8}$' then return '+' || d; end if;
  if d ~ '^0[17][0-9]{8}$' then return '+254' || substr(d, 2); end if;
  raise exception 'invalid_phone';
end $$;

-- 07XX XXX 482 style mask; never reveals more than the last 3 digits.
create function public.mask_phone(p text) returns text
language sql immutable as $$
  select case when p is null then null
    else '0' || substr(p, 5, 1) || 'XX XXX ' || right(p, 3) end
$$;

-- ── People ──────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 80),
  phone text unique check (phone = public.normalize_phone(phone)),
  email text unique check (email = lower(email)),
  is_barber boolean not null default false,
  handle text unique check (handle ~ '^[a-z0-9][a-z0-9-]{2,29}$'),
  about text check (length(about) <= 400),
  slot_minutes int not null default 30 check (slot_minutes in (15, 20, 30, 45, 60, 90, 120)),
  is_platform_admin boolean not null default false,
  suspended_at timestamptz,
  trial_ends_at timestamptz not null default now() + interval '30 days',
  paid_until date,
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  check (not is_barber or handle is not null)
);

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  area text not null check (length(btrim(area)) between 2 and 80),
  join_code text not null unique check (join_code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  suspended_at timestamptz
);

create type public.shop_role as enum ('manager', 'barber', 'service_staff', 'cashier');
create type public.membership_status as enum ('pending', 'active', 'ended', 'rejected');

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id),
  user_id uuid not null references public.profiles (id),
  status public.membership_status not null default 'pending',
  roles public.shop_role[] not null default '{}',
  on_duty_date date,
  last_assigned_at timestamptz,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id),
  check (status <> 'active' or cardinality(roles) > 0)
);
create unique index memberships_one_live on public.memberships (shop_id, user_id)
  where status in ('pending', 'active');
create index memberships_user on public.memberships (user_id);

create table public.app_settings (
  key text primary key,
  value text not null
);
insert into public.app_settings (key, value) values
  ('payment_instructions', 'Pay via M-Pesa and send the confirmation message to the Jasiri team.'),
  ('monthly_price_kes', '200'),
  ('client_consent_version', 'consent-v1');

-- ── Access helpers (security definer: they read memberships without RLS) ──

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_platform_admin and p.suspended_at is null
                   from public.profiles p where p.id = auth.uid()), false)
$$;

create function private.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.suspended_at is null)
$$;

create function private.my_roles(p_shop uuid) returns public.shop_role[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select m.roles from public.memberships m
    join public.shops s on s.id = m.shop_id and s.suspended_at is null
    join public.profiles p on p.id = m.user_id and p.suspended_at is null
    where m.shop_id = p_shop and m.user_id = auth.uid() and m.status = 'active'
  ), '{}')
$$;

create function private.has_role(p_shop uuid, p_role public.shop_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_role = any (private.my_roles(p_shop))
$$;

create function private.is_member(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select cardinality(private.my_roles(p_shop)) > 0
$$;

create function private.has_live_membership(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.shop_id = p_shop and m.user_id = auth.uid()
                   and m.status in ('pending', 'active'))
$$;

create function private.shares_shop(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships mine
    join public.memberships theirs on theirs.shop_id = mine.shop_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = p_user and theirs.status in ('pending', 'active', 'ended'))
$$;

-- Raises unless the caller is signed in and not suspended. Returns the caller id.
create function private.require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.profiles where id = v and suspended_at is null) then
    raise exception 'account_suspended';
  end if;
  return v;
end $$;

create function private.require_role(p_shop uuid, variadic p_roles public.shop_role[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if private.is_admin() then return v; end if;
  if not (private.my_roles(p_shop) && p_roles) then raise exception 'not_allowed'; end if;
  return v;
end $$;

create function private.random_code(p_len int) returns text
language plpgsql volatile as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- no 0, O, 1, I, L
  r text := '';
begin
  for i in 1 .. p_len loop
    r := r || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return r;
end $$;

-- ── Audit log: append-only ──────────────────────────────────────────────

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_roles text[] not null default '{}',
  shop_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb
);
create index audit_log_shop_at on public.audit_log (shop_id, at desc);
create index audit_log_actor_at on public.audit_log (actor_id, at);

create function private.audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log_is_append_only';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_immutable();

-- Names the business action for the audit rows written by the next statements.
create function private.act(p_action text) returns void
language sql as $$ select set_config('jasiri.action', p_action, true) $$;

-- Generic row trigger: who, which role, what, when, before and after.
-- Phone numbers and cancel tokens never enter the log.
create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_after, v_before);
  v_shop uuid := nullif(v_row ->> 'shop_id', '')::uuid;
  v_action text := coalesce(nullif(current_setting('jasiri.action', true), ''),
                            tg_table_name || '.' || lower(tg_op));
  v_roles text[];
begin
  if tg_table_name = 'shops' then v_shop := (v_row ->> 'id')::uuid; end if;
  v_before := v_before - 'phone' - 'cancel_token';
  v_after := v_after - 'phone' - 'cancel_token';
  if tg_op = 'UPDATE' and v_before = v_after then return null; end if;
  v_roles := case when v_shop is null then '{}' else private.my_roles(v_shop)::text[] end;
  if private.is_admin() then v_roles := v_roles || 'platform_admin'::text; end if;
  if auth.uid() is null then v_roles := v_roles || 'public'::text; end if;
  insert into public.audit_log (actor_id, actor_roles, shop_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_roles, v_shop, v_action, tg_table_name,
          nullif(v_row ->> 'id', '')::uuid, v_before, v_after);
  return null;
end $$;

create trigger audit after insert or update or delete on public.profiles
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.shops
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.memberships
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.app_settings
  for each row execute function private.audit_row();

-- ── Idempotency: a retried or double-tapped write returns the first result ──

create table private.idempotency (
  request_id uuid primary key,
  user_id uuid,
  fn text not null,
  response jsonb,
  created_at timestamptz not null default now()
);

-- Returns null when this request is new (and claims it), or the stored response.
-- A concurrent duplicate blocks on the insert until the first one commits.
create function private.idem_claim(p_request uuid, p_fn text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rows int; v_resp jsonb;
begin
  if p_request is null then raise exception 'missing_request_id'; end if;
  insert into private.idempotency (request_id, user_id, fn)
  values (p_request, auth.uid(), p_fn) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then return null; end if;
  select response into v_resp from private.idempotency
  where request_id = p_request and fn = p_fn and user_id is not distinct from auth.uid();
  if not found then raise exception 'request_id_reused'; end if;
  return coalesce(v_resp, '{}'::jsonb);
end $$;

create function private.idem_store(p_request uuid, p_resp jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  update private.idempotency set response = p_resp where request_id = p_request;
  select p_resp;
$$;

-- ── Rate limits and login lockout (called by the server with the service key) ──

create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

create function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limits (key, window_start, hits) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  delete from private.rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_limit;
end $$;

create table private.login_attempts (
  identifier text primary key,
  failures int not null default 0,
  locked_until timestamptz
);

-- Returns seconds until the identifier may try again (0 = allowed).
create function public.login_wait_seconds(p_identifier text) returns int
language sql security definer set search_path = '' as $$
  select coalesce(greatest(0, ceil(extract(epoch from (locked_until - now()))))::int, 0)
  from private.login_attempts where identifier = p_identifier
  union all select 0 limit 1
$$;

-- 5 wrong PINs lock the account for 15 minutes.
create function public.login_record(p_identifier text, p_success boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_success then
    delete from private.login_attempts where identifier = p_identifier;
    return;
  end if;
  insert into private.login_attempts (identifier, failures) values (p_identifier, 1)
  on conflict (identifier) do update set failures = private.login_attempts.failures + 1;
  update private.login_attempts set locked_until = now() + interval '15 minutes', failures = 0
  where identifier = p_identifier and failures >= 5;
end $$;

-- ── New account → profile ───────────────────────────────────────────────
-- Accounts are created by the server (admin API) after validation.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone, email, is_barber, handle)
  values (
    new.id,
    btrim(new.raw_user_meta_data ->> 'full_name'),
    public.normalize_phone(nullif(new.raw_user_meta_data ->> 'phone', '')),
    nullif(lower(new.raw_user_meta_data ->> 'contact_email'), ''),
    coalesce((new.raw_user_meta_data ->> 'is_barber')::boolean, false),
    nullif(lower(new.raw_user_meta_data ->> 'handle'), ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── Profile RPCs ────────────────────────────────────────────────────────

create function public.my_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid(); r jsonb;
begin
  if v is null then raise exception 'not_signed_in'; end if;
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email,
    'is_barber', p.is_barber, 'handle', p.handle, 'about', p.about,
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

create function public.update_my_profile(
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
  return public.my_profile();
exception when unique_violation then raise exception 'handle_taken';
end $$;

create function public.handle_available(p_handle text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles
                     where handle = lower(btrim(p_handle)) and id is distinct from auth.uid())
$$;

-- ── Shop RPCs ───────────────────────────────────────────────────────────

create function private.new_join_code() returns text
language plpgsql volatile set search_path = '' as $$
declare c text;
begin
  loop
    c := private.random_code(6);
    exit when not exists (select 1 from public.shops where join_code = c);
  end loop;
  return c;
end $$;

create function public.create_shop(p_request uuid, p_name text, p_area text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'create_shop');
  v_shop uuid;
  v_roles public.shop_role[] := '{manager}';
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act('shop.create');
  insert into public.shops (name, area, join_code, created_by)
  values (btrim(p_name), btrim(p_area), private.new_join_code(), v)
  returning id into v_shop;
  if (select is_barber from public.profiles where id = v) then
    v_roles := v_roles || 'barber'::public.shop_role;
  end if;
  perform private.act('membership.create_manager');
  insert into public.memberships (shop_id, user_id, status, roles, decided_at, decided_by)
  values (v_shop, v, 'active', v_roles, now(), v);
  return private.idem_store(p_request, jsonb_build_object('shop_id', v_shop));
end $$;

create function public.shop_by_join_code(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'area', s.area)
  from public.shops s
  where s.join_code = upper(btrim(p_code)) and s.suspended_at is null and auth.uid() is not null
$$;

create function public.request_join(p_request uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'request_join');
  v_shop uuid;
  v_id uuid;
begin
  if v_resp is not null then return v_resp; end if;
  select id into v_shop from public.shops
  where join_code = upper(btrim(p_code)) and suspended_at is null;
  if v_shop is null then raise exception 'shop_not_found'; end if;
  perform private.act('membership.request');
  begin
    insert into public.memberships (shop_id, user_id) values (v_shop, v) returning id into v_id;
  exception when unique_violation then raise exception 'already_member';
  end;
  return private.idem_store(p_request, jsonb_build_object('membership_id', v_id, 'shop_id', v_shop));
end $$;

-- Keeps at least one active manager while the shop has other active members.
create function private.check_managers(p_shop uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.memberships where shop_id = p_shop and status = 'active')
     and not exists (select 1 from public.memberships
                     where shop_id = p_shop and status = 'active' and 'manager' = any (roles)) then
    raise exception 'last_manager';
  end if;
end $$;

create function public.decide_join(p_request uuid, p_membership uuid, p_approve boolean, p_roles public.shop_role[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'decide_join');
  m public.memberships;
begin
  if v_resp is not null then return v_resp; end if;
  select * into m from public.memberships where id = p_membership for update;
  if m.id is null or m.status <> 'pending' then raise exception 'not_pending'; end if;
  perform private.require_role(m.shop_id, 'manager');
  if p_approve and coalesce(cardinality(p_roles), 0) = 0 then raise exception 'pick_a_role'; end if;
  perform private.act(case when p_approve then 'membership.approve' else 'membership.reject' end);
  update public.memberships set
    status = case when p_approve then 'active'::public.membership_status else 'rejected' end,
    roles = case when p_approve then (select array_agg(distinct r) from unnest(p_roles) r) else '{}' end,
    decided_at = now(), decided_by = v
  where id = p_membership;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

create function public.set_member_roles(p_request uuid, p_membership uuid, p_roles public.shop_role[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'set_member_roles');
  m public.memberships;
begin
  if v_resp is not null then return v_resp; end if;
  select * into m from public.memberships where id = p_membership for update;
  if m.id is null or m.status <> 'active' then raise exception 'not_active'; end if;
  perform private.require_role(m.shop_id, 'manager');
  if coalesce(cardinality(p_roles), 0) = 0 then raise exception 'pick_a_role'; end if;
  perform pg_advisory_xact_lock(hashtextextended(m.shop_id::text, 1));
  perform private.act('membership.set_roles');
  update public.memberships set roles = (select array_agg(distinct r) from unnest(p_roles) r)
  where id = p_membership;
  perform private.check_managers(m.shop_id);
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

-- The member themself or a manager ends a membership. Codes stay with the shop;
-- the barber keeps his client book and booking link (they belong to him).
create function public.end_membership(p_request uuid, p_membership uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'end_membership');
  m public.memberships;
begin
  if v_resp is not null then return v_resp; end if;
  select * into m from public.memberships where id = p_membership for update;
  if m.id is null or m.status not in ('active', 'pending') then raise exception 'not_active'; end if;
  if m.user_id <> v then perform private.require_role(m.shop_id, 'manager'); end if;
  perform pg_advisory_xact_lock(hashtextextended(m.shop_id::text, 1));
  perform private.act(case when m.user_id = v then 'membership.leave' else 'membership.end' end);
  update public.memberships set status = 'ended', ended_at = now(), ended_by = v, on_duty_date = null
  where id = p_membership;
  perform private.check_managers(m.shop_id);
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

create function public.set_on_duty(p_request uuid, p_shop uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'set_on_duty');
begin
  if v_resp is not null then return v_resp; end if;
  if not private.has_role(p_shop, 'service_staff') then raise exception 'not_allowed'; end if;
  perform private.act(case when p_on then 'duty.on' else 'duty.off' end);
  update public.memberships set on_duty_date = case when p_on then private.today() end
  where shop_id = p_shop and user_id = v and status = 'active';
  return private.idem_store(p_request, jsonb_build_object('on_duty', p_on));
end $$;

create function public.new_join_code(p_request uuid, p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_role(p_shop, 'manager');
  v_resp jsonb := private.idem_claim(p_request, 'new_join_code');
  c text := private.new_join_code();
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act('shop.new_join_code');
  update public.shops set join_code = c where id = p_shop;
  return private.idem_store(p_request, jsonb_build_object('join_code', c));
end $$;

create function public.update_shop(p_request uuid, p_shop uuid, p_name text, p_area text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_role(p_shop, 'manager');
  v_resp jsonb := private.idem_claim(p_request, 'update_shop');
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act('shop.update');
  update public.shops set name = btrim(p_name), area = btrim(p_area) where id = p_shop;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

-- My shops with my roles, for the shop switcher.
create function public.my_shops() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'membership_id', m.id, 'shop_id', s.id, 'name', s.name, 'area', s.area,
    'status', m.status, 'roles', m.roles,
    'on_duty', m.on_duty_date = private.today(),
    'join_code', case when 'manager' = any (m.roles) and m.status = 'active' then s.join_code end,
    'suspended', s.suspended_at is not null)
    order by m.requested_at), '[]'::jsonb)
  from public.memberships m join public.shops s on s.id = m.shop_id
  where m.user_id = auth.uid() and m.status in ('pending', 'active')
$$;

-- ── Row Level Security ──────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.profiles, public.shops, public.memberships, public.audit_log, public.app_settings
  from anon, authenticated;

-- Colleagues see each other's names only; phone, email and billing come via my_profile().
grant select (id, full_name, is_barber, handle) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_shop(id) or private.is_admin());

grant select (id, name, area, created_at, suspended_at) on public.shops to authenticated;
create policy shops_read on public.shops for select to authenticated
  using (private.has_live_membership(id) or private.is_admin());

grant select on public.memberships to authenticated;
create policy memberships_read on public.memberships for select to authenticated
  using (user_id = (select auth.uid())
         or private.has_role(shop_id, 'manager')
         or (status = 'active' and private.is_member(shop_id))
         or private.is_admin());

grant select on public.audit_log to authenticated;
create policy audit_read on public.audit_log for select to authenticated
  using (private.is_admin() or (shop_id is not null and private.has_role(shop_id, 'manager')));

grant select on public.app_settings to authenticated;
create policy settings_read on public.app_settings for select to authenticated using (true);

grant execute on function private.is_admin(), private.is_active_user(), private.my_roles(uuid),
  private.has_role(uuid, public.shop_role), private.is_member(uuid),
  private.has_live_membership(uuid), private.shares_shop(uuid), private.nairobi_date(timestamptz),
  private.today() to authenticated;
