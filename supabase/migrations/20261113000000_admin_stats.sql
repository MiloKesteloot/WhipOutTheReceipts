-- ─────────────────────────────────────────────────────────────
--  Admin stats: app-wide numbers for the app's owner.
--
--  RLS keeps everyone inside their own groups, so this is a
--  security definer function that checks the caller first: only the
--  admin account (by user id, so no email lives in this public repo)
--  gets anything back; anyone else gets an error. Read-only. Invite codes, Gemini keys and receipt
--  contents are never returned.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.uid() = any (array[
    '91562882-10ff-4805-b5c4-198549969951'  -- Milo
  ]::uuid[]), false)
$$;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with
  -- Live receipts with their totals (items + tax + tip + fees)
  r as (
    select rc.id, rc.group_id, rc.created_by, rc.created_at,
           coalesce(rc.receipt_date, rc.created_at::date) as day,
           coalesce((select sum(i.price) from public.items i where i.receipt_id = rc.id and i.deleted_at is null), 0)
             + rc.tax + rc.tip + rc.fees as total
    from public.receipts rc
    where rc.deleted_at is null and rc.group_id is not null
  ),
  p as (select * from public.payments where deleted_at is null),
  weeks as (
    select generate_series(date_trunc('week', now() - interval '25 weeks'), date_trunc('week', now()), interval '1 week') as wk
  )
  select jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'users',            (select count(*) from auth.users),
      'users_confirmed',  (select count(*) from auth.users where email_confirmed_at is not null),
      'active_7d',        (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
      'active_30d',       (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
      'new_users_30d',    (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'users_no_group',   (select count(*) from auth.users u where not exists (
                             select 1 from public.group_members m where m.user_id = u.id and m.active)),
      'groups',           (select count(*) from public.groups),
      'groups_active_30d',(select count(distinct group_id) from r where created_at > now() - interval '30 days'),
      'new_groups_30d',   (select count(*) from public.groups where created_at > now() - interval '30 days'),
      'members',          (select count(*) from public.group_members where active),
      'members_linked',   (select count(*) from public.group_members where active and user_id is not null),
      'guests',           (select count(*) from public.group_members where active and is_guest),
      'receipts',         (select count(*) from r),
      'receipts_30d',     (select count(*) from r where created_at > now() - interval '30 days'),
      'items',            (select count(*) from public.items i join r on r.id = i.receipt_id where i.deleted_at is null),
      'claims',           (select count(*) from public.claims),
      'total_spend',      (select coalesce(sum(total), 0) from r),
      'payments',         (select count(*) from p),
      'payments_total',   (select coalesce(sum(amount), 0) from p),
      'gemini_keys',      (select count(*) from public.user_secrets where coalesce(gemini_api_key, '') <> '')
    ),
    -- Last 26 weeks, oldest first
    'weekly', (
      select jsonb_agg(jsonb_build_object(
        'week', w.wk::date,
        'signups',  (select count(*) from auth.users u where u.created_at >= w.wk and u.created_at < w.wk + interval '1 week'),
        'groups',   (select count(*) from public.groups g where g.created_at >= w.wk and g.created_at < w.wk + interval '1 week'),
        'receipts', (select count(*) from r where r.created_at >= w.wk and r.created_at < w.wk + interval '1 week'),
        'active_users', (select count(distinct r.created_by) from r where r.created_at >= w.wk and r.created_at < w.wk + interval '1 week')
      ) order by w.wk)
      from weeks w
    ),
    'groups', (
      select coalesce(jsonb_agg(x order by x->>'last_activity' desc nulls last), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'created_at', g.created_at,
          'owner', (select trim(m.first_name || ' ' || m.last_name) from public.group_members m
                    where m.group_id = g.id and m.role = 'owner' and m.active limit 1),
          'accounts', (select count(*) from public.group_members m where m.group_id = g.id and m.active and m.user_id is not null),
          'unlinked', (select count(*) from public.group_members m where m.group_id = g.id and m.active and m.user_id is null and not m.is_guest),
          'guests',   (select count(*) from public.group_members m where m.group_id = g.id and m.active and m.is_guest),
          'receipts', (select count(*) from r where r.group_id = g.id),
          'spend',    (select coalesce(sum(total), 0) from r where r.group_id = g.id),
          'payments', (select count(*) from p where p.group_id = g.id),
          'last_activity', greatest(
            (select max(created_at) from r where r.group_id = g.id),
            (select max(created_at) from p where p.group_id = g.id))
        ) as x
        from public.groups g
      ) s
    ),
    'users', (
      select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', u.id,
          'name', trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')),
          'email', u.email,
          'provider', coalesce(u.raw_app_meta_data->>'provider', 'email'),
          'confirmed', u.email_confirmed_at is not null,
          'created_at', u.created_at,
          'last_sign_in_at', u.last_sign_in_at,
          'groups', (select coalesce(jsonb_agg(g.name order by g.name), '[]'::jsonb)
                     from public.group_members m join public.groups g on g.id = m.group_id
                     where m.user_id = u.id and m.active),
          'receipts_added', (select count(*) from r where r.created_by = u.id),
          'has_gemini_key', exists (select 1 from public.user_secrets s where s.user_id = u.id and coalesce(s.gemini_api_key, '') <> '')
        ) as x
        from auth.users u
        left join public.profiles pr on pr.id = u.id
      ) s
    )
  ) into result;

  return result;
end $$;

revoke all on function public.is_app_admin() from public, anon;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.admin_stats() to authenticated;
