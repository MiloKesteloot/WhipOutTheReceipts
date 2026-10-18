-- ─────────────────────────────────────────────────────────────
--  Remove vs. ban. join_group reactivated anyone who had a row
--  in the group, so nobody could be kept out. Now the owner can:
--    remove_member(p)        out of the group, can rejoin with the invite
--    remove_member(p, true)  banned: the invite won't let them back in
--    unban_member(p)         can rejoin with the invite again
--    restore_member(p)       back in right away (also lifts a ban)
-- ─────────────────────────────────────────────────────────────

alter table public.group_members add column banned boolean not null default false;

drop function public.remove_member(uuid);
create function public.remove_member(p_member uuid, p_ban boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := public.member_group(p_member);
begin
  if not public.is_group_owner(gid) then raise exception 'Only the group owner can do that'; end if;
  if exists (select 1 from public.group_members where id = p_member and user_id = auth.uid()) then
    raise exception 'Use leave group to remove yourself';
  end if;
  update public.group_members set active = false, banned = p_ban where id = p_member;
end $$;

create or replace function public.restore_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_owner(public.member_group(p_member)) then raise exception 'Only the group owner can do that'; end if;
  update public.group_members set active = true, banned = false where id = p_member;
end $$;

create function public.unban_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_owner(public.member_group(p_member)) then raise exception 'Only the group owner can do that'; end if;
  update public.group_members set banned = false where id = p_member;
end $$;

-- The join page shows a banned person why they can't join
create or replace function public.invite_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g public.groups;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into g from public.groups where invite_code = upper(trim(p_code));
  if g.id is null then return null; end if;
  return jsonb_build_object(
    'group_id', g.id,
    'name', g.name,
    'already_member', public.is_group_member(g.id),
    'banned', exists (select 1 from public.group_members where group_id = g.id and user_id = auth.uid() and banned),
    'unclaimed', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'first_name', m.first_name, 'last_name', m.last_name, 'is_guest', m.is_guest)
                       order by m.is_guest, m.first_name)
      from public.group_members m
      where m.group_id = g.id and m.user_id is null and m.active
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.join_group(p_code text, p_claim_member uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  p public.profiles;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select id into gid from public.groups where invite_code = upper(trim(p_code));
  if gid is null then raise exception 'That invite code is not valid'; end if;
  select * into p from public.profiles where id = uid;

  if exists (select 1 from public.group_members where group_id = gid and user_id = uid and banned) then
    raise exception 'The owner removed you from this group. Ask them to let you back in.';
  end if;

  -- Already in (or previously left or removed): just reactivate
  if exists (select 1 from public.group_members where group_id = gid and user_id = uid) then
    update public.group_members set active = true where group_id = gid and user_id = uid;
    return gid;
  end if;

  if p_claim_member is not null then
    -- Only people the join page offers: unclaimed and still in the group
    update public.group_members set
      user_id = uid,
      first_name = coalesce(nullif(trim(p.first_name), ''), first_name),
      last_name = coalesce(nullif(trim(p.last_name), ''), last_name),
      is_guest = false,
      active = true
    where id = p_claim_member and group_id = gid and user_id is null and active;
    if not found then raise exception 'That person has already been claimed'; end if;
  else
    insert into public.group_members (group_id, user_id, first_name, last_name)
    values (gid, uid, coalesce(nullif(trim(p.first_name), ''), 'Me'), coalesce(p.last_name, ''));
  end if;
  return gid;
end $$;

-- Owners only, signed in (remove_member was dropped and recreated)
revoke execute on function public.remove_member(uuid, boolean), public.unban_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid, boolean), public.unban_member(uuid) to authenticated;
