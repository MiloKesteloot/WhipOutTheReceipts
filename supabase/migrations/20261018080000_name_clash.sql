-- ─────────────────────────────────────────────────────────────
--  Last names are optional, but joining a group as a new person
--  needs a name the group can tell apart:
--    - someone already has your first name and you have no last
--      name → add one (or change your first name)
--    - someone has your exact first and last name → change it
--  A different last name is enough ("Alex K." / "Alex M.").
--  The join page asks up front (invite_preview → name_clash);
--  join_group enforces it. Same rule as nameClash() in
--  src/lib/names.js. Claiming an existing person isn't affected.
-- ─────────────────────────────────────────────────────────────

-- 'needs_last' / 'same_name' / null, and who it clashes with
create function public.name_clash(p_group uuid, p_first text, p_last text, p_except_user uuid default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(trim(p_last), '') = '' then jsonb_build_object('kind', 'needs_last', 'first_name', m.first_name, 'last_name', m.last_name)
    else jsonb_build_object('kind', 'same_name', 'first_name', m.first_name, 'last_name', m.last_name)
  end
  from public.group_members m
  where m.group_id = p_group and m.active
    and (p_except_user is null or m.user_id is distinct from p_except_user)
    and lower(trim(m.first_name)) = lower(trim(p_first))
    and (coalesce(trim(p_last), '') = '' or lower(trim(m.last_name)) = lower(trim(p_last)))
  order by m.created_at
  limit 1
$$;
revoke all on function public.name_clash(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.invite_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g public.groups;
  p public.profiles;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into g from public.groups where invite_code = upper(trim(p_code));
  if g.id is null then return null; end if;
  select * into p from public.profiles where id = auth.uid();
  return jsonb_build_object(
    'group_id', g.id,
    'name', g.name,
    'already_member', public.is_group_member(g.id),
    'banned', exists (select 1 from public.group_members where group_id = g.id and user_id = auth.uid() and banned),
    -- Left or was removed: joining brings back your old person
    'rejoining', exists (select 1 from public.group_members where group_id = g.id and user_id = auth.uid() and not active and not banned),
    -- Joining as someone new with your current name would clash
    'name_clash', public.name_clash(g.id, coalesce(nullif(trim(p.first_name), ''), 'Me'), p.last_name, auth.uid()),
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
  first text;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select id into gid from public.groups where invite_code = upper(trim(p_code));
  if gid is null then raise exception 'That invite code is not valid'; end if;
  select * into p from public.profiles where id = uid;
  first := coalesce(nullif(trim(p.first_name), ''), 'Me');

  if exists (select 1 from public.group_members where group_id = gid and user_id = uid and banned) then
    raise exception 'The owner removed you from this group. Ask them to let you back in.';
  end if;

  -- Already in (or previously left or removed): just reactivate
  if exists (select 1 from public.group_members where group_id = gid and user_id = uid) then
    update public.group_members set active = true where group_id = gid and user_id = uid;
  elsif p_claim_member is not null then
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
    if public.name_clash(gid, first, p.last_name, uid) is not null then
      raise exception 'Someone in this group already has that name. Add your last name or use a different first name.'
        using hint = 'name_clash';
    end if;
    insert into public.group_members (group_id, user_id, first_name, last_name)
    values (gid, uid, first, coalesce(p.last_name, ''));
  end if;

  perform public.claim_ownership_if_none(gid, uid);
  return gid;
end $$;
