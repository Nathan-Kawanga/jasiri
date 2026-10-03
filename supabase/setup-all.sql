-- Jasiri: full database setup for a new Supabase project.
-- Paste into Supabase → SQL Editor → New query → Run. Run it once, on an empty project.

-- ===== 20261003000001_core.sql =====
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

-- ===== 20261003000002_codes.sql =====
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

-- ===== 20261003000003_bookings.sql =====
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

-- ===== 20261003000004_reports.sql =====
-- Earnings, payout sheet, daily summary, flags, problem reports, usage and admin.

-- ── Problem reports ─────────────────────────────────────────────────────

create table public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops (id),
  reporter_id uuid not null references public.profiles (id),
  code_id uuid references public.codes (id),
  note text not null check (length(btrim(note)) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text check (length(resolution_note) <= 500),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create trigger audit after insert or update or delete on public.problem_reports
  for each row execute function private.audit_row();

alter table public.problem_reports enable row level security;
revoke all on public.problem_reports from anon, authenticated;
grant select on public.problem_reports to authenticated;
create policy problems_read on public.problem_reports for select to authenticated using (
  reporter_id = (select auth.uid()) or private.is_admin()
  or (shop_id is not null and private.has_role(shop_id, 'manager')));

create function public.report_problem(p_request uuid, p_shop uuid, p_note text, p_code uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'report_problem');
  v_id uuid;
begin
  if v_resp is not null then return v_resp; end if;
  if p_shop is not null and not private.has_live_membership(p_shop) then raise exception 'not_allowed'; end if;
  perform private.act('problem.report');
  insert into public.problem_reports (shop_id, reporter_id, code_id, note)
  values (p_shop, v, p_code, btrim(p_note)) returning id into v_id;
  return private.idem_store(p_request, jsonb_build_object('id', v_id));
end $$;

create function public.resolve_problem(p_request uuid, p_problem uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'resolve_problem');
  r public.problem_reports;
begin
  if v_resp is not null then return v_resp; end if;
  select * into r from public.problem_reports where id = p_problem for update;
  if r.id is null or r.status <> 'open' then raise exception 'not_open'; end if;
  if not private.is_admin() and not (r.shop_id is not null and private.has_role(r.shop_id, 'manager')) then
    raise exception 'not_allowed';
  end if;
  perform private.act('problem.resolve');
  update public.problem_reports set status = 'resolved', resolution_note = nullif(btrim(p_note), ''),
    resolved_by = v, resolved_at = now()
  where id = p_problem;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

-- ── Earnings: each person's own evidence ────────────────────────────────

-- Every code I worked on between two days: as barber (my amount) or as service staff
-- (my lines). Only paid codes count as verified; open and voided are listed as evidence.
create function public.my_earnings(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  return (
    with mine as (
      select c.id, c.display_code, c.shop_id, c.created_day, c.created_at, c.status, c.service_status,
        'barber' as role, c.barber_amount as my_amount, c.client_first_name, c.void_reason,
        c.amount_paid, c.paid_at
      from public.codes c
      where c.barber_id = v and c.created_day between p_from and p_to and c.status <> 'cancelled'
      union all
      select c.id, c.display_code, c.shop_id, c.created_day, c.created_at, c.status, c.service_status,
        'service', sum(l.amount)::int, c.client_first_name, c.void_reason, c.amount_paid, c.paid_at
      from public.code_service_lines l join public.codes c on c.id = l.code_id
      where l.performed_by = v and l.removed_at is null and c.created_day between p_from and p_to
      group by c.id
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(jsonb_build_object(
          'code_id', m.id, 'display_code', m.display_code, 'shop_name', s.name, 'day', m.created_day,
          'created_at', m.created_at, 'status', m.status, 'service_status', m.service_status,
          'role', m.role, 'amount', m.my_amount, 'client_first_name', m.client_first_name,
          'void_reason', m.void_reason, 'paid_at', m.paid_at,
          'verification', case m.status when 'paid' then 'cashier_confirmed'
                                        when 'voided' then 'voided' else 'self_recorded' end)
          order by m.created_at desc), '[]'::jsonb),
      'verified_amount', coalesce(sum(m.my_amount) filter (where m.status = 'paid'), 0),
      'verified_count', count(*) filter (where m.status = 'paid'),
      'open_amount', coalesce(sum(m.my_amount) filter (where m.status in ('created', 'open')), 0),
      'open_count', count(*) filter (where m.status in ('created', 'open')),
      'voided_count', count(*) filter (where m.status = 'voided'))
    from mine m join public.shops s on s.id = m.shop_id);
end $$;

-- ── Cashier and manager: payout sheet and daily summary ─────────────────

create function public.payout_sheet(p_shop uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(p_shop, 'cashier', 'manager');
  return (
    with work as (
      select c.barber_id as user_id, 'barber' as role, c.display_code, c.barber_amount as amount, c.status
      from public.codes c
      where c.shop_id = p_shop and c.created_day = p_day and c.barber_id is not null and c.status in ('open', 'paid')
      union all
      select l.performed_by, 'service', c.display_code, sum(l.amount)::int, c.status
      from public.code_service_lines l join public.codes c on c.id = l.code_id
      where c.shop_id = p_shop and c.created_day = p_day and l.removed_at is null and c.status in ('open', 'paid')
      group by l.performed_by, c.id
    ), per as (
      select w.user_id, w.role,
        count(*) filter (where w.status = 'paid') as paid_count,
        coalesce(sum(w.amount) filter (where w.status = 'paid'), 0) as paid_amount,
        count(*) filter (where w.status = 'open') as open_count,
        coalesce(jsonb_agg(jsonb_build_object('code', w.display_code, 'amount', w.amount)
                           order by w.display_code) filter (where w.status = 'paid'), '[]'::jsonb) as codes
      from work w group by w.user_id, w.role
    )
    select jsonb_build_object('day', p_day, 'rows', coalesce(jsonb_agg(jsonb_build_object(
        'user_id', per.user_id, 'name', p.full_name, 'role', per.role, 'paid_count', per.paid_count,
        'paid_amount', per.paid_amount, 'open_count', per.open_count, 'codes', per.codes)
        order by per.role, p.full_name), '[]'::jsonb))
    from per join public.profiles p on p.id = per.user_id);
end $$;

create function public.shop_summary(p_shop uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(p_shop, 'cashier', 'manager');
  return (
    select jsonb_build_object(
      'day', p_day,
      'created', count(*) filter (where c.status <> 'cancelled'),
      'paid', count(*) filter (where c.status = 'paid'),
      'voided', count(*) filter (where c.status = 'voided'),
      'cancelled', count(*) filter (where c.status = 'cancelled'),
      'open', count(*) filter (where c.status in ('created', 'open')),
      'till_total', coalesce(sum(c.amount_paid) filter (where c.status = 'paid'), 0),
      'expected_total', coalesce(sum(c.barber_amount + private.code_lines_total(c.id)) filter (where c.status = 'paid'), 0),
      'barber_total', coalesce(sum(c.barber_amount) filter (where c.status = 'paid'), 0),
      'service_total', coalesce(sum(private.code_lines_total(c.id)) filter (where c.status = 'paid'), 0),
      'mismatch_count', count(*) filter (where c.status = 'paid' and c.amount_paid <> c.barber_amount + private.code_lines_total(c.id)))
    from public.codes c where c.shop_id = p_shop and c.created_day = p_day);
end $$;

-- Cashier's list: open codes, plus today's paid and voided.
create function public.cashier_codes(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(p_shop, 'cashier', 'manager');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'display_code', c.display_code, 'status', c.status, 'service_status', c.service_status,
      'client_first_name', c.client_first_name, 'barber_name', b.full_name, 'staff_name', st.full_name,
      'barber_amount', c.barber_amount, 'lines_total', private.code_lines_total(c.id),
      'expected_total', c.barber_amount + private.code_lines_total(c.id),
      'amount_paid', c.amount_paid, 'created_at', c.created_at, 'confirmed_at', c.confirmed_at,
      'created_day', c.created_day, 'paid_at', c.paid_at, 'void_reason', c.void_reason)
      order by c.status = 'open' desc, coalesce(c.paid_at, c.voided_at, c.confirmed_at) desc)
    from public.codes c
    left join public.profiles b on b.id = c.barber_id
    left join public.profiles st on st.id = c.assigned_staff_id
    where c.shop_id = p_shop and (c.status = 'open'
      or (c.status in ('paid', 'voided') and private.nairobi_date(coalesce(c.paid_at, c.voided_at)) = private.today()))
  ), '[]'::jsonb);
end $$;

-- Service staff queue: my codes, unassigned codes, and colleagues on duty for handover.
create function public.service_queue(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not private.has_role(p_shop, 'service_staff') then raise exception 'not_allowed'; end if;
  return jsonb_build_object(
    'on_duty', (select on_duty_date = private.today() from public.memberships
                where shop_id = p_shop and user_id = v and status = 'active'),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'display_code', c.display_code, 'service_status', c.service_status,
        'client_first_name', c.client_first_name, 'barber_name', b.full_name,
        'assigned_staff_id', c.assigned_staff_id, 'mine', c.assigned_staff_id = v,
        'assigned_at', c.assigned_at, 'confirmed_at', c.confirmed_at,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'amount', l.amount, 'note', l.note,
                                 'performed_by', l.performed_by, 'mine', l.performed_by = v) order by l.added_at)
                           from public.code_service_lines l where l.code_id = c.id and l.removed_at is null), '[]'::jsonb))
        order by c.assigned_staff_id is null, coalesce(c.assigned_at, c.confirmed_at))
      from public.codes c left join public.profiles b on b.id = c.barber_id
      where c.shop_id = p_shop and c.status = 'open' and c.service_status in ('pending', 'in_progress')
        and (c.assigned_staff_id = v or c.assigned_staff_id is null)), '[]'::jsonb),
    'colleagues', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name,
                                          'on_duty', m.on_duty_date = private.today()) order by p.full_name)
      from public.memberships m join public.profiles p on p.id = m.user_id
      where m.shop_id = p_shop and m.status = 'active' and 'service_staff' = any (m.roles) and m.user_id <> v), '[]'::jsonb),
    'recent_amounts', coalesce((
      select jsonb_agg(amount) from (
        select l.amount, max(l.added_at) as last_used from public.code_service_lines l
        where l.performed_by = v and l.removed_at is null and l.added_at > now() - interval '30 days'
        group by l.amount order by count(*) desc, last_used desc limit 6) a), '[]'::jsonb));
end $$;

-- ── Flags: manager and platform admin ───────────────────────────────────

create function public.shop_flags(p_shop uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(p_shop, 'manager');
  return jsonb_build_object(
    -- Confirmed but still unpaid after their day ended. Never auto-voided: they are evidence.
    'open_after_day', coalesce((
      select jsonb_agg(jsonb_build_object('code_id', c.id, 'display_code', c.display_code, 'day', c.created_day,
        'barber_name', b.full_name, 'staff_name', st.full_name) order by c.created_day desc)
      from public.codes c left join public.profiles b on b.id = c.barber_id
      left join public.profiles st on st.id = c.assigned_staff_id
      where c.shop_id = p_shop and c.status = 'open' and c.created_day < private.today()
        and c.created_day between p_from and p_to), '[]'::jsonb),
    'mismatches', coalesce((
      select jsonb_agg(jsonb_build_object('code_id', c.id, 'display_code', c.display_code, 'day', c.created_day,
        'barber_name', b.full_name, 'expected', c.barber_amount + private.code_lines_total(c.id),
        'paid', c.amount_paid, 'cashier_name', pb.full_name) order by c.paid_at desc)
      from public.codes c left join public.profiles b on b.id = c.barber_id
      left join public.profiles pb on pb.id = c.paid_by
      where c.shop_id = p_shop and c.status = 'paid' and c.created_day between p_from and p_to
        and c.amount_paid <> c.barber_amount + private.code_lines_total(c.id)), '[]'::jsonb),
    'voids_by_person', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.full_name, 'count', x.n, 'reasons', x.reasons) order by x.n desc)
      from (select voided_by, count(*) n, jsonb_object_agg_strict(void_reason, cnt) reasons
            from (select voided_by, void_reason, count(*) over (partition by voided_by, void_reason) cnt
                  from public.codes where shop_id = p_shop and status = 'voided'
                    and created_day between p_from and p_to) v
            group by voided_by) x
      join public.profiles p on p.id = x.voided_by), '[]'::jsonb),
    'handovers', coalesce((
      select jsonb_agg(jsonb_build_object('display_code', c.display_code, 'at', h.at,
        'from_name', f.full_name, 'to_name', t.full_name) order by h.at desc)
      from public.code_handovers h join public.codes c on c.id = h.code_id
      left join public.profiles f on f.id = h.from_staff join public.profiles t on t.id = h.to_staff
      where h.shop_id = p_shop and private.nairobi_date(h.at) between p_from and p_to), '[]'::jsonb),
    -- A code voided and a new one made for the same client under a different barber within 10 minutes.
    'void_recreate', coalesce((
      select jsonb_agg(jsonb_build_object('voided_code', v.display_code, 'new_code', n.display_code,
        'voided_barber', vb.full_name, 'new_barber', nb.full_name, 'at', n.created_at) order by n.created_at desc)
      from public.codes v
      join public.codes n on n.shop_id = v.shop_id and n.barber_id is distinct from v.barber_id
        and n.created_at between v.voided_at and v.voided_at + interval '10 minutes'
      left join public.clients vc on vc.id = v.client_id
      left join public.clients nc on nc.id = n.client_id
      left join public.profiles vb on vb.id = v.barber_id
      left join public.profiles nb on nb.id = n.barber_id
      where v.shop_id = p_shop and v.status = 'voided' and v.created_day between p_from and p_to
        and n.barber_id is not null
        and ((vc.phone is not null and vc.phone = nc.phone)
             or (v.client_first_name is not null and lower(v.client_first_name) = lower(n.client_first_name))
             or (v.client_id is null and n.client_id is null and v.client_first_name is null))), '[]'::jsonb),
    'open_problems', (select count(*) from public.problem_reports where shop_id = p_shop and status = 'open'));
end $$;

-- ── Usage measurements ──────────────────────────────────────────────────

create function private.code_metrics(p_shop uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'confirmed', count(*) filter (where c.confirmed_at is not null),
    'with_phone_pct', round(100.0 * count(*) filter (where c.confirmed_at is not null and c.has_client_phone and c.barber_id is not null)
                      / nullif(count(*) filter (where c.confirmed_at is not null and c.barber_id is not null), 0), 1),
    'paid_pct', round(100.0 * count(*) filter (where c.status = 'paid')
                / nullif(count(*) filter (where c.confirmed_at is not null), 0), 1),
    'median_confirm_to_paid_min', round((percentile_cont(0.5) within group (
        order by extract(epoch from (c.paid_at - c.confirmed_at)) / 60.0)
        filter (where c.status = 'paid'))::numeric, 1))
  from public.codes c
  where (p_shop is null or c.shop_id = p_shop) and c.created_day between p_from and p_to
$$;

create function private.booking_metrics(p_barbers uuid[], p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) from (
    select jsonb_build_object('name', p.full_name,
      'link', count(*) filter (where b.source = 'link'),
      'manual', count(*) filter (where b.source = 'manual'),
      'link_pct', round(100.0 * count(*) filter (where b.source = 'link') / nullif(count(*), 0), 1),
      'no_show_pct', round(100.0 * count(*) filter (where b.status = 'no_show')
                    / nullif(count(*) filter (where b.status in ('no_show', 'completed')), 0), 1)) x
    from public.bookings b join public.profiles p on p.id = b.barber_id
    where (p_barbers is null or b.barber_id = any (p_barbers))
      and private.nairobi_date(b.slot_start) between p_from and p_to
    group by p.id, p.full_name) t
$$;

create function public.shop_usage(p_shop uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_barbers uuid[];
begin
  perform private.require_role(p_shop, 'manager');
  select array_agg(distinct user_id) into v_barbers from public.memberships
  where shop_id = p_shop and 'barber' = any (roles) and status = 'active';
  return jsonb_build_object(
    'codes', private.code_metrics(p_shop, p_from, p_to),
    'per_barber', coalesce((
      select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object('name', p.full_name,
          'confirmed', count(*), 'paid', count(*) filter (where c.status = 'paid'),
          'with_phone_pct', round(100.0 * count(*) filter (where c.has_client_phone) / nullif(count(*), 0), 1)) x
        from public.codes c join public.profiles p on p.id = c.barber_id
        where c.shop_id = p_shop and c.confirmed_at is not null and c.created_day between p_from and p_to
        group by p.id, p.full_name) t), '[]'::jsonb),
    'bookings', private.booking_metrics(coalesce(v_barbers, '{}'), p_from, p_to),
    'problems', (select jsonb_build_object('open', count(*) filter (where status = 'open'),
                                           'resolved', count(*) filter (where status = 'resolved'))
                 from public.problem_reports where shop_id = p_shop
                   and private.nairobi_date(created_at) between p_from and p_to),
    'active_staff', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'names', names) order by d desc)
      from (select private.nairobi_date(a.at) d, jsonb_agg(distinct p.full_name) names
            from public.audit_log a join public.profiles p on p.id = a.actor_id
            where a.shop_id = p_shop and private.nairobi_date(a.at) between p_from and p_to
            group by 1) t), '[]'::jsonb));
end $$;

create function public.platform_usage(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not_allowed'; end if;
  return jsonb_build_object(
    'codes', private.code_metrics(null, p_from, p_to),
    'bookings', private.booking_metrics(null, p_from, p_to),
    'signups', (select count(*) from public.profiles where private.nairobi_date(created_at) between p_from and p_to),
    'new_shops', (select count(*) from public.shops where private.nairobi_date(created_at) between p_from and p_to),
    -- Barbers who joined a new shop and brought an existing client book.
    'barbers_moved_with_book', (
      select count(distinct m.user_id) from public.memberships m
      where 'barber' = any (m.roles) and m.decided_at is not null
        and private.nairobi_date(m.decided_at) between p_from and p_to
        and exists (select 1 from public.clients c where c.barber_id = m.user_id and c.created_at < m.decided_at)),
    'problems', (select jsonb_build_object('open', count(*) filter (where status = 'open'),
                                           'resolved', count(*) filter (where status = 'resolved'))
                 from public.problem_reports where private.nairobi_date(created_at) between p_from and p_to),
    -- Kill criteria: week-4 usage and month-2 payment.
    'kill_criteria', (
      select jsonb_build_object(
        'barbers', count(*),
        'barbers_15_codes_last_7_days', count(*) filter (where (
          select count(*) from public.codes c where c.barber_id = p.id and c.status <> 'cancelled'
            and c.created_at > now() - interval '7 days') >= 15),
        'trial_ended', count(*) filter (where p.trial_ends_at < now()),
        'paying_after_trial', count(*) filter (where p.trial_ends_at < now() and p.paid_until >= private.today()))
      from public.profiles p where p.is_barber and p.suspended_at is null),
    'daily_active', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'users', n) order by d desc)
      from (select private.nairobi_date(at) d, count(distinct actor_id) n from public.audit_log
            where actor_id is not null and private.nairobi_date(at) between p_from and p_to group by 1) t), '[]'::jsonb));
end $$;

-- ── Platform admin ──────────────────────────────────────────────────────

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not private.is_admin() then raise exception 'not_allowed'; end if;
  return v;
end $$;

create function public.admin_shops() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'area', s.area, 'created_at', s.created_at, 'suspended', s.suspended_at is not null,
      'members', (select count(*) from public.memberships m where m.shop_id = s.id and m.status = 'active'),
      'codes_7d', (select count(*) from public.codes c where c.shop_id = s.id and c.created_at > now() - interval '7 days'))
      order by s.created_at desc) from public.shops s), '[]'::jsonb);
end $$;

create function public.admin_users(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(btrim(p_search), '');
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email, 'handle', p.handle,
      'is_barber', p.is_barber, 'is_platform_admin', p.is_platform_admin, 'suspended', p.suspended_at is not null,
      'trial_ends_at', p.trial_ends_at, 'paid_until', p.paid_until, 'created_at', p.created_at,
      'shops', (select jsonb_agg(s.name) from public.memberships m join public.shops s on s.id = m.shop_id
                where m.user_id = p.id and m.status = 'active'))
      order by p.created_at desc)
    from (select * from public.profiles p
          where q is null or p.full_name ilike '%' || q || '%' or p.phone like '%' || q || '%'
             or p.email ilike '%' || q || '%' or p.handle ilike '%' || q || '%'
          order by p.created_at desc limit 200) p), '[]'::jsonb);
end $$;

create function public.admin_set_suspended(p_request uuid, p_user uuid, p_suspended boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_admin();
  v_resp jsonb := private.idem_claim(p_request, 'admin_set_suspended');
begin
  if v_resp is not null then return v_resp; end if;
  if p_user = v then raise exception 'not_allowed'; end if;
  perform private.act(case when p_suspended then 'admin.suspend_user' else 'admin.unsuspend_user' end);
  update public.profiles set suspended_at = case when p_suspended then now() end where id = p_user;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

create function public.admin_set_shop_suspended(p_request uuid, p_shop uuid, p_suspended boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_admin();
  v_resp jsonb := private.idem_claim(p_request, 'admin_set_shop_suspended');
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act(case when p_suspended then 'admin.suspend_shop' else 'admin.unsuspend_shop' end);
  update public.shops set suspended_at = case when p_suspended then now() end where id = p_shop;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

create function public.admin_set_paid_until(p_request uuid, p_user uuid, p_until date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_admin();
  v_resp jsonb := private.idem_claim(p_request, 'admin_set_paid_until');
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act('admin.set_paid_until');
  update public.profiles set paid_until = p_until where id = p_user;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

create function public.admin_set_setting(p_request uuid, p_key text, p_value text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_admin();
  v_resp jsonb := private.idem_claim(p_request, 'admin_set_setting');
begin
  if v_resp is not null then return v_resp; end if;
  if p_key not in ('payment_instructions', 'monthly_price_kes') then raise exception 'not_allowed'; end if;
  perform private.act('admin.set_setting');
  update public.app_settings set value = p_value where key = p_key;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

-- Find a client record by phone number across barbers (for deletion requests).
create function public.admin_find_clients(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'first_name', c.first_name,
      'barber_name', p.full_name, 'created_at', c.created_at))
    from public.clients c join public.profiles p on p.id = c.barber_id
    where c.phone = public.normalize_phone(p_phone)), '[]'::jsonb);
end $$;

-- Deletes a client on request. Past codes stay, with the client's details removed.
create function public.admin_delete_client(p_request uuid, p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_admin();
  v_resp jsonb := private.idem_claim(p_request, 'admin_delete_client');
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act('admin.delete_client');
  update public.codes set client_id = null, client_first_name = null where client_id = p_client;
  update public.bookings set client_id = null where client_id = p_client;
  delete from public.clients where id = p_client;
  return private.idem_store(p_request, jsonb_build_object('ok', true));
end $$;

-- Signs a user out everywhere (after an admin PIN reset). Server only.
create function public.end_user_sessions(p_user uuid, p_keep_session uuid default null) returns void
language sql security definer set search_path = '' as $$
  delete from auth.sessions where user_id = p_user and id is distinct from p_keep_session;
$$;

-- After changing my own PIN: end my other sessions, keep this one.
create function public.end_my_other_sessions() returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  perform public.end_user_sessions(v, nullif(auth.jwt() ->> 'session_id', '')::uuid);
end $$;

create function public.record_pin_change(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, actor_roles, action, entity, entity_id)
  values (coalesce(auth.uid(), p_user), '{}', 'auth.pin_change', 'profiles', p_user);
end $$;

-- ── Function permissions ────────────────────────────────────────────────
-- Everything callable by signed-in users is listed by default; the anonymous role
-- can call nothing. Public booking, rate limits and login checks are server-only.

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema private to service_role;

revoke execute on function
  public.hit_rate_limit(text, int, int), public.login_wait_seconds(text), public.login_record(text, boolean),
  public.public_barber_page(text), public.public_phone_known(text, text),
  public.public_book(uuid, text, timestamptz, text, text, boolean),
  public.public_booking(text), public.public_cancel(text),
  public.end_user_sessions(uuid, uuid), public.record_pin_change(uuid)
from authenticated;

grant execute on function private.is_admin(), private.is_active_user(), private.my_roles(uuid),
  private.has_role(uuid, public.shop_role), private.is_member(uuid),
  private.has_live_membership(uuid), private.shares_shop(uuid), private.nairobi_date(timestamptz),
  private.today(), private.performed_on(uuid) to authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;
