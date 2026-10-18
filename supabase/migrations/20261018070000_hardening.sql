-- ─────────────────────────────────────────────────────────────
--  Fixes from the app review (2026-10-18):
--
--  - Guest links: a person's link is cleared once they have an
--    account, so it can't come back to life if the account is later
--    unlinked or deleted.
--  - Ownership: a group always ends up with a usable owner. Merging
--    moves the owner role (and active/banned) along with the account;
--    leaving gives up the role; if a group has no active owner, the
--    next person to join becomes it. Account deletion only hands
--    ownership to an active member.
--  - Deleting an account takes that person out of the groups they
--    shared (so nobody can claim "I'm <them>" with the invite), and
--    the account's removal isn't logged as edits to everything they
--    ever created.
--  - Check-offs and check-ins can be made for people who left or were
--    removed, so receipts they're on can still be finished.
--  - "Created by" can only become empty when the account is deleted.
--  - The join page knows when you're rejoining (your old person is
--    reused, so it doesn't offer names).
--  - guest_view: claims carry their id and come in a fixed order (so
--    leftover cents land on the same person as everywhere else), meals
--    have a stable order, and the guest's payments are included.
--  - Helper functions used by policies are no longer callable by
--    signed-out visitors.
-- ─────────────────────────────────────────────────────────────

-- ── Guest links die with the guest ────────────────────────────
create function public.clear_guest_token() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id is not null then new.guest_token := null; end if;
  return new;
end $$;

create trigger clear_guest_token before insert or update of user_id on public.group_members
  for each row execute function public.clear_guest_token();

select set_config('app.skip_audit', 'on', true);
update public.group_members set guest_token = null where user_id is not null and guest_token is not null;
select set_config('app.skip_audit', 'off', true);

-- ── Ownership ─────────────────────────────────────────────────
-- If the group has no active owner, make this account its owner
create function public.claim_ownership_if_none(p_group uuid, p_user uuid) returns void
language sql security definer set search_path = '' as $$
  update public.group_members set role = 'owner'
  where group_id = p_group and user_id = p_user and active
    and not exists (
      select 1 from public.group_members o
      where o.group_id = p_group and o.role = 'owner' and o.active and o.user_id is not null
    )
$$;
revoke all on function public.claim_ownership_if_none(uuid, uuid) from public, anon, authenticated;

create or replace function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if public.is_group_owner(p_group) and exists (
    select 1 from public.group_members
    where group_id = p_group and active and user_id is not null and user_id <> uid
  ) then
    raise exception 'Transfer ownership to someone else before leaving';
  end if;
  -- The last account holder can leave; whoever joins next becomes owner
  update public.group_members set active = false, role = 'member' where group_id = p_group and user_id = uid;
end $$;

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
    -- Left or was removed: joining brings back your old person
    'rejoining', exists (select 1 from public.group_members where group_id = g.id and user_id = auth.uid() and not active and not banned),
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
    insert into public.group_members (group_id, user_id, first_name, last_name)
    values (gid, uid, coalesce(nullif(trim(p.first_name), ''), 'Me'), coalesce(p.last_name, ''));
  end if;

  perform public.claim_ownership_if_none(gid, uid);
  return gid;
end $$;

create or replace function public.merge_members(p_from uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  gid uuid := public.member_group(p_from);
  f public.group_members;
  into_user uuid;
begin
  if p_from = p_into then raise exception 'Pick two different people'; end if;
  if gid is null or gid is distinct from public.member_group(p_into) then
    raise exception 'Both people must be in the same group';
  end if;
  if not public.is_group_owner(gid) then raise exception 'Only the group owner can merge people'; end if;

  select * into f from public.group_members where id = p_from;
  select user_id into into_user from public.group_members where id = p_into;
  if f.user_id is not null and into_user is not null then
    raise exception 'Both people have accounts, so they can''t be merged';
  end if;

  delete from public.claims c where c.member_id = p_from
    and exists (select 1 from public.claims d where d.item_id = c.item_id and d.member_id = p_into);
  update public.claims set member_id = p_into where member_id = p_from;

  delete from public.checkins c where c.member_id = p_from
    and exists (select 1 from public.checkins d where d.member_id = p_into and d.receipt_id = c.receipt_id);
  update public.checkins set member_id = p_into where member_id = p_from;

  update public.receipts set paid_by_member = p_into where paid_by_member = p_from;
  update public.receipts set member_ids = array(
      select m from unnest(array_replace(member_ids, p_from, p_into)) with ordinality u(m, o) group by m order by min(o)
    ) where p_from = any(member_ids);

  -- Payments between the two would become payments to yourself: mark them
  -- deleted and leave them on the old person; move everyone else's.
  update public.payments set deleted_at = now()
    where deleted_at is null
      and ((from_member = p_from and to_member = p_into) or (from_member = p_into and to_member = p_from));
  update public.payments set from_member = p_into where from_member = p_from and to_member <> p_into;
  update public.payments set to_member = p_into where to_member = p_from and from_member <> p_into;

  update public.group_members set user_id = null, active = false, role = 'member', banned = false where id = p_from;
  -- The account moves with its standing: in or out of the group, banned, owner
  if f.user_id is not null then
    update public.group_members set
      user_id = f.user_id, is_guest = false, active = f.active, banned = f.banned,
      role = case when f.role = 'owner' then 'owner' else role end
    where id = p_into;
  end if;
end $function$;

-- ── Deleting an account ───────────────────────────────────────
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

  -- Hand ownership of the groups that remain to an active member with an
  -- account (if there's none, whoever joins next becomes owner)
  update public.group_members heir set role = 'owner'
  from public.group_members mine
  where mine.user_id = me and mine.role = 'owner'
    and heir.id = (
      select m.id from public.group_members m
      where m.group_id = mine.group_id and m.user_id is not null and m.user_id <> me and m.active
      order by m.created_at
      limit 1
    );
  -- Out of the groups: their history stays, but nobody can join as them
  update public.group_members set role = 'member', is_guest = true, active = false where user_id = me;

  -- Removing the account clears created_by etc. everywhere; that's not
  -- anyone's edit, so it isn't logged
  perform set_config('app.skip_audit', 'on', true);
  delete from auth.users where id = me;
  perform set_config('app.skip_audit', 'off', true);
end;
$$;

-- ── Acting for people who are gone ────────────────────────────
-- Me, someone without an account (a guest), or someone no longer in the
-- group (so receipts they're on can still be finished)
create or replace function public.can_act_for(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members
    where id = mid and (user_id = (select auth.uid()) or user_id is null or not active)
  )
$$;

-- ── "Created by" only empties when the account is gone ────────
create or replace function public.stamp_created_by() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    if new.created_by is distinct from old.created_by and (
      new.created_by is not null
      or exists (select 1 from auth.users u where u.id = old.created_by)
    ) then
      new.created_by := old.created_by;
    end if;
    if tg_table_name = 'payments' then
      new.imported_from_settlement := old.imported_from_settlement;
    end if;
  end if;
  return new;
end $$;

-- ── Guest page data ───────────────────────────────────────────
create or replace function public.guest_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g public.group_members;
begin
  select * into g from public.guest_member(p_token);
  if g.id is null then return null; end if;

  return jsonb_build_object(
    'member', jsonb_build_object('id', g.id, 'first_name', g.first_name),
    'group', (select jsonb_build_object('id', gr.id, 'name', gr.name) from public.groups gr where gr.id = g.group_id),
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'first_name', m.first_name, 'last_name', m.last_name, 'created_at', m.created_at)), '[]')
      from public.group_members m where m.group_id = g.group_id
    ),
    'receipts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'store_name', r.store_name, 'receipt_date', r.receipt_date, 'created_at', r.created_at,
        'category', r.category, 'tip', r.tip, 'tax', r.tax, 'fees', r.fees,
        'paid_by_member', r.paid_by_member, 'member_ids', r.member_ids,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'price', i.price, 'always_split', i.always_split, 'meal_id', i.meal_id)
                    order by i.position nulls last, i.created_at), '[]')
                  from public.items i where i.receipt_id = r.id and i.deleted_at is null),
        'meals', (select coalesce(jsonb_agg(jsonb_build_object('id', ml.id, 'name', ml.name, 'fee', ml.fee) order by ml.created_at, ml.id), '[]')
                  from public.meals ml where ml.receipt_id = r.id and ml.deleted_at is null),
        'claims', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'item_id', c.item_id, 'member_id', c.member_id) order by c.id), '[]')
                   from public.claims c join public.items i on i.id = c.item_id
                   where i.receipt_id = r.id and i.deleted_at is null),
        'checkins', (select coalesce(jsonb_agg(k.member_id), '[]') from public.checkins k where k.receipt_id = r.id)
      ) order by r.receipt_date desc nulls last, r.created_at desc), '[]')
      from public.receipts r
      where r.group_id = g.group_id and r.deleted_at is null
        and (g.id = any(r.member_ids) or r.paid_by_member = g.id)
        and exists (select 1 from public.items i where i.receipt_id = r.id and i.deleted_at is null)
    ),
    -- Payments to or from the guest, so the page shows what's still owed
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'from_member', p.from_member, 'to_member', p.to_member,
        'amount', p.amount, 'receipt_id', p.receipt_id, 'paid_at', p.paid_at
      ) order by p.paid_at), '[]')
      from public.payments p
      where p.group_id = g.group_id and p.deleted_at is null and (p.from_member = g.id or p.to_member = g.id)
    )
  );
end $$;

-- ── Helpers: signed-in only ───────────────────────────────────
revoke execute on function
  public.is_group_member(uuid), public.is_group_owner(uuid), public.member_group(uuid),
  public.receipt_group(uuid), public.item_group(uuid), public.meal_group(uuid),
  public.members_in_group(uuid[], uuid), public.shares_group_with(uuid), public.new_invite_code()
from public, anon;
grant execute on function
  public.is_group_member(uuid), public.is_group_owner(uuid), public.member_group(uuid),
  public.receipt_group(uuid), public.item_group(uuid), public.meal_group(uuid),
  public.members_in_group(uuid[], uuid), public.shares_group_with(uuid), public.new_invite_code()
to authenticated, service_role;
