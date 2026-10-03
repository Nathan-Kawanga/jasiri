-- Jasiri update 2: barber photos. Paste into Supabase → SQL Editor → New query → Run, once.

-- Barber photos: a profile photo and a "My cuts" gallery shown on the booking page.
-- Files live in the public "portfolio" bucket under {barber_id}/…; each barber can
-- only write inside his own folder.

alter table public.profiles add column photo_path text check (length(photo_path) <= 300);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy portfolio_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'portfolio');
create policy portfolio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'portfolio'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and private.is_active_user());
create policy portfolio_update on storage.objects for update to authenticated
  using (bucket_id = 'portfolio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy portfolio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'portfolio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.portfolio_photos (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.profiles (id),
  path text not null unique check (length(path) <= 300),
  caption text check (length(caption) <= 60),
  created_at timestamptz not null default now()
);
create index portfolio_barber on public.portfolio_photos (barber_id, created_at desc);
create trigger audit after insert or update or delete on public.portfolio_photos
  for each row execute function private.audit_row();

alter table public.portfolio_photos enable row level security;
revoke all on public.portfolio_photos from anon, authenticated;
grant select on public.portfolio_photos to authenticated;
create policy portfolio_own on public.portfolio_photos for select to authenticated
  using (barber_id = (select auth.uid()));

create function private.require_own_path(p_path text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not (select is_barber from public.profiles where id = v) then raise exception 'not_allowed'; end if;
  if split_part(p_path, '/', 1) <> v::text or p_path like '%..%' then raise exception 'not_allowed'; end if;
  return v;
end $$;

create function public.add_portfolio_photo(p_request uuid, p_path text, p_caption text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_own_path(p_path);
  v_resp jsonb := private.idem_claim(p_request, 'add_portfolio_photo');
  v_id uuid;
begin
  if v_resp is not null then return v_resp; end if;
  if (select count(*) from public.portfolio_photos where barber_id = v) >= 12 then
    raise exception 'too_many_photos';
  end if;
  perform private.act('photo.add');
  insert into public.portfolio_photos (barber_id, path, caption)
  values (v, p_path, nullif(btrim(p_caption), '')) returning id into v_id;
  return private.idem_store(p_request, jsonb_build_object('id', v_id));
end $$;

-- Returns the file path so the app can delete the file from storage.
create function public.remove_portfolio_photo(p_request uuid, p_photo uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := private.require_user();
  v_resp jsonb := private.idem_claim(p_request, 'remove_portfolio_photo');
  v_path text;
begin
  if v_resp is not null then return v_resp; end if;
  perform private.act('photo.remove');
  delete from public.portfolio_photos where id = p_photo and barber_id = v returning path into v_path;
  if v_path is null then raise exception 'not_found'; end if;
  return private.idem_store(p_request, jsonb_build_object('path', v_path));
end $$;

-- Sets (or clears) the profile photo. Returns the previous path for cleanup.
create function public.set_my_photo(p_request uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := case when p_path is null then private.require_user() else private.require_own_path(p_path) end;
  v_resp jsonb := private.idem_claim(p_request, 'set_my_photo');
  v_old text;
begin
  if v_resp is not null then return v_resp; end if;
  select photo_path into v_old from public.profiles where id = v;
  perform private.act('profile.photo');
  update public.profiles set photo_path = p_path where id = v;
  return private.idem_store(p_request, jsonb_build_object('old_path', v_old));
end $$;

-- my_profile and the public page now include the photos.
create or replace function public.my_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid(); r jsonb;
begin
  if v is null then raise exception 'not_signed_in'; end if;
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email,
    'is_barber', p.is_barber, 'handle', p.handle, 'about', p.about, 'photo_path', p.photo_path,
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

create or replace function public.public_barber_page(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles := private.public_barber(p_handle);
begin
  if p.id is null then return null; end if;
  return jsonb_build_object(
    'name', p.full_name, 'handle', p.handle, 'about', p.about, 'slot_minutes', p.slot_minutes,
    'photo_path', p.photo_path,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'caption', f.caption) order by f.created_at desc)
                        from public.portfolio_photos f where f.barber_id = p.id), '[]'::jsonb),
    'shop', (select jsonb_build_object('name', s.name, 'area', s.area)
             from public.memberships m join public.shops s on s.id = m.shop_id and s.suspended_at is null
             where m.user_id = p.id and m.status = 'active' and 'barber' = any (m.roles)
             order by m.decided_at desc nulls last limit 1),
    'slots', coalesce((select jsonb_agg(s.slot_start order by s.slot_start)
                       from private.barber_slots(p.id, private.today(), 7) s where s.is_free), '[]'::jsonb));
end $$;

revoke execute on function public.public_barber_page(text) from public, anon, authenticated;
revoke execute on function public.add_portfolio_photo(uuid, text, text), public.remove_portfolio_photo(uuid, uuid),
  public.set_my_photo(uuid, text), public.my_profile() from public, anon;
revoke execute on function private.require_own_path(text) from public;
