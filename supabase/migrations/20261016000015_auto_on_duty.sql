-- Jasiri update 12: service staff go on duty by working, not by tapping a button.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.
--
-- Taking a code, confirming a service-only code you made, or adding a service puts you
-- on duty for today, so the next codes come to you automatically. "Go off duty" still
-- works, and everyone is off duty again at midnight.

create or replace function private.auto_on_duty() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
  v_prev text := current_setting('jasiri.action', true);
  -- Codes: the person the code is assigned to. Service lines: who did the work.
  v_worker uuid := (to_jsonb(new) ->> case tg_table_name when 'codes' then 'assigned_staff_id' else 'performed_by' end)::uuid;
begin
  if v is null or v_worker is distinct from v then return null; end if;
  perform private.act('membership.auto_on_duty');
  update public.memberships set on_duty_date = private.today()
  where shop_id = new.shop_id and user_id = v and status = 'active'
    and 'service_staff' = any (roles) and on_duty_date is distinct from private.today();
  perform set_config('jasiri.action', coalesce(v_prev, ''), true);
  return null;
end $$;

drop trigger if exists auto_on_duty on public.codes;
create trigger auto_on_duty after update of assigned_staff_id on public.codes
  for each row when (new.assigned_staff_id is not null) execute function private.auto_on_duty();

drop trigger if exists auto_on_duty on public.code_service_lines;
create trigger auto_on_duty after insert on public.code_service_lines
  for each row execute function private.auto_on_duty();

revoke execute on function private.auto_on_duty() from public;
