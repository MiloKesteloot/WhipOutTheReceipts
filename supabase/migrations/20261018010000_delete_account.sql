-- ─────────────────────────────────────────────────────────────
--  "Delete my account" (Settings). The app can't delete auth users
--  itself, so this runs as the function owner, only ever for the
--  signed-in person:
--  - Groups where nobody else has an account are deleted, with all
--    their receipts and payments (no one could reach them again).
--  - In other groups the person stays on past receipts and payments
--    as a guest with no account, so everyone else's balances and
--    history don't change.
--  - The login, profile and saved API key are deleted (profiles and
--    user_secrets cascade; created_by / user_id links become null).
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

  update public.group_members set is_guest = true where user_id = me;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
