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
