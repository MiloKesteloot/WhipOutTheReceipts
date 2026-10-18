-- ─────────────────────────────────────────────────────────────
--  delete_my_account(): an owner deleting their account used to
--  leave a shared group with no owner (no one could rename it,
--  make a new invite link or remove people). Now ownership passes
--  to the longest-standing active member with an account first,
--  like leaving a group requires. Otherwise unchanged; see
--  20261018010000_delete_account.sql.
-- ─────────────────────────────────────────────────────────────
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  -- No history for groups being deleted: it would point at the group being
  -- removed (and be deleted with it anyway)
  perform set_config('app.skip_audit', 'on', true);
  delete from public.groups g
  where exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = me)
    and not exists (
      select 1 from public.group_members m
      where m.group_id = g.id and m.user_id is not null and m.user_id <> me
    );
  perform set_config('app.skip_audit', 'off', true);

  -- Hand ownership of the groups that remain to someone who can use it
  update public.group_members heir set role = 'owner'
  from public.group_members mine
  where mine.user_id = me and mine.role = 'owner'
    and heir.id = (
      select m.id from public.group_members m
      where m.group_id = mine.group_id and m.user_id is not null and m.user_id <> me
      order by m.active desc, m.created_at
      limit 1
    );
  update public.group_members set role = 'member' where user_id = me and role = 'owner';

  update public.group_members set is_guest = true where user_id = me;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
