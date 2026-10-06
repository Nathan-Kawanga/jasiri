-- Jasiri update 11: payout sheet that follows each paid code from barber to service staff.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.

-- One entry per paid code of the day: who cut it, who served it, what each typed,
-- and what the client actually paid.
create or replace function public.payout_tickets(p_shop uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(p_shop, 'cashier', 'manager');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', c.display_code,
      'barber', bp.full_name,
      'barber_amount', c.barber_amount,
      'amount_paid', c.amount_paid,
      'paid_at', c.paid_at,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object('name', sp.full_name, 'amount', l.amount, 'note', l.note) order by l.added_at)
        from public.code_service_lines l join public.profiles sp on sp.id = l.performed_by
        where l.code_id = c.id and l.removed_at is null), '[]'::jsonb))
      order by c.paid_at)
    from public.codes c left join public.profiles bp on bp.id = c.barber_id
    where c.shop_id = p_shop and c.created_day = p_day and c.status = 'paid'), '[]'::jsonb);
end $$;

revoke execute on function public.payout_tickets(uuid, date) from public, anon;
grant execute on function public.payout_tickets(uuid, date) to authenticated;
