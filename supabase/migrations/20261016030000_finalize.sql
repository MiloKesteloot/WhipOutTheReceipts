-- ─────────────────────────────────────────────────────────────
--  Accounts + groups, step 3 of 3: drop name-based columns,
--  lock down row-level security, add the audit log and the
--  group management functions.
-- ─────────────────────────────────────────────────────────────

-- ── Require the new columns, drop the old ones ───────────────
alter table public.receipts
  alter column group_id set not null,
  alter column paid_by_member set not null,
  drop column paid_by,
  drop column members;

alter table public.trips
  alter column group_id set not null,
  drop column members;

alter table public.claims
  alter column member_id set not null,
  drop column roommate,
  add constraint claims_item_member_key unique (item_id, member_id);

alter table public.checkins
  alter column member_id set not null,
  drop column roommate,
  add constraint checkins_receipt_trip_member_key unique nulls not distinct (receipt_id, trip_id, member_id);

alter table public.settlements
  alter column group_id set not null,
  alter column debtor_member set not null,
  alter column creditor_member set not null,
  drop column debtor,
  drop column creditor;

-- Roster moved to group_members; Gemini keys moved to user_secrets
drop table public.app_settings;

create index receipts_group_id on public.receipts (group_id);
create index trips_group_id on public.trips (group_id);
create index settlements_group_id on public.settlements (group_id);
create index items_receipt_id on public.items (receipt_id);
create index meals_receipt_id on public.meals (receipt_id);
create index claims_member_id on public.claims (member_id);

-- ── Helpers used by policies ─────────────────────────────────
-- security definer so they can look things up without recursing
-- through the RLS policies of the tables they read.
create function public.is_group_member(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid()) and active
  )
$$;

create function public.is_group_owner(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid()) and active and role = 'owner'
  )
$$;

create function public.member_group(mid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select group_id from public.group_members where id = mid
$$;

create function public.receipt_group(rid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select group_id from public.receipts where id = rid
$$;

create function public.trip_group(tid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select group_id from public.trips where id = tid
$$;

create function public.item_group(iid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.group_id from public.items i join public.receipts r on r.id = i.receipt_id where i.id = iid
$$;

create function public.meal_group(mid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.group_id from public.meals m join public.receipts r on r.id = m.receipt_id where m.id = mid
$$;

-- Every id in the array belongs to the group (empty array is fine)
create function public.members_in_group(ids uuid[], gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from unnest(coalesce(ids, '{}')) as m(id)
    where not exists (select 1 from public.group_members g where g.id = m.id and g.group_id = gid)
  )
$$;

-- Users who share at least one active group with the caller
create function public.shares_group_with(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on a.group_id = b.group_id
    where a.user_id = (select auth.uid()) and a.active and b.user_id = uid
  )
$$;

-- ── Row-level security ───────────────────────────────────────
-- Drop the old wide-open anon policies
drop policy "anon all" on public.checkins;
drop policy "anon all" on public.claims;
drop policy "anon all" on public.items;
drop policy "anon all" on public.receipts;
drop policy "anon all" on public.settlements;
drop policy "anon all" on public.trips;
drop policy "anon delete meals" on public.meals;
drop policy "anon insert meals" on public.meals;
drop policy "anon read meals" on public.meals;
drop policy "anon update meals" on public.meals;

alter table public.profiles enable row level security;
alter table public.user_secrets enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- Signed-out visitors get nothing
revoke all on all tables in schema public from anon;
-- Supabase's default privileges grant everything on new tables;
-- these get narrower column-level grants below
revoke all on public.groups, public.group_members, public.profiles from authenticated;

grant select, insert, update, delete on
  public.receipts, public.trips, public.items, public.meals,
  public.claims, public.checkins, public.settlements,
  public.user_secrets
to authenticated;
grant select on public.groups, public.group_members, public.profiles to authenticated;
grant update (name) on public.groups to authenticated;
grant update (first_name, last_name) on public.profiles to authenticated;
grant insert (group_id, first_name, last_name, is_guest) on public.group_members to authenticated;
grant update (first_name, last_name, is_guest) on public.group_members to authenticated;

-- Profiles: yourself, and people you share a group with
create policy "profiles read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_group_with(id));
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own secrets" on public.user_secrets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Groups: members read; owner renames. Creating/joining goes through functions below.
create policy "groups read" on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy "groups rename" on public.groups for update to authenticated
  using (public.is_group_owner(id)) with check (public.is_group_owner(id));

-- Members: anyone in the group can add/edit guests and unclaimed people.
-- Linking accounts, roles and removal go through functions below.
create policy "members read" on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
create policy "members add unlinked" on public.group_members for insert to authenticated
  with check (public.is_group_member(group_id));
create policy "members edit unlinked" on public.group_members for update to authenticated
  using (public.is_group_member(group_id) and user_id is null)
  with check (public.is_group_member(group_id) and user_id is null);

-- Receipts / trips / items / meals: anyone in the group, but no hard deletes
-- (no delete policy). "Deleting" sets deleted_at.
create policy "receipts read" on public.receipts for select to authenticated
  using (public.is_group_member(group_id));
create policy "receipts insert" on public.receipts for insert to authenticated
  with check (public.is_group_member(group_id)
    and public.member_group(paid_by_member) = group_id
    and public.members_in_group(member_ids, group_id));
create policy "receipts update" on public.receipts for update to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id)
    and public.member_group(paid_by_member) = group_id
    and public.members_in_group(member_ids, group_id));

create policy "trips read" on public.trips for select to authenticated
  using (public.is_group_member(group_id));
create policy "trips insert" on public.trips for insert to authenticated
  with check (public.is_group_member(group_id) and public.members_in_group(member_ids, group_id));
create policy "trips update" on public.trips for update to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id) and public.members_in_group(member_ids, group_id));

create policy "items read" on public.items for select to authenticated
  using (public.is_group_member(public.receipt_group(receipt_id)));
create policy "items insert" on public.items for insert to authenticated
  with check (public.is_group_member(public.receipt_group(receipt_id))
    and (meal_id is null or public.meal_group(meal_id) = public.receipt_group(receipt_id)));
create policy "items update" on public.items for update to authenticated
  using (public.is_group_member(public.receipt_group(receipt_id)))
  with check (public.is_group_member(public.receipt_group(receipt_id))
    and (meal_id is null or public.meal_group(meal_id) = public.receipt_group(receipt_id)));

create policy "meals read" on public.meals for select to authenticated
  using (public.is_group_member(public.receipt_group(receipt_id)));
create policy "meals insert" on public.meals for insert to authenticated
  with check (public.is_group_member(public.receipt_group(receipt_id)));
create policy "meals update" on public.meals for update to authenticated
  using (public.is_group_member(public.receipt_group(receipt_id)))
  with check (public.is_group_member(public.receipt_group(receipt_id)));

-- Claims / checkins / settlements: real deletes are allowed (and logged)
create policy "claims all" on public.claims for all to authenticated
  using (public.is_group_member(public.item_group(item_id)))
  with check (public.is_group_member(public.item_group(item_id))
    and public.member_group(member_id) = public.item_group(item_id));

create policy "checkins all" on public.checkins for all to authenticated
  using (public.is_group_member(coalesce(public.receipt_group(receipt_id), public.trip_group(trip_id))))
  with check (public.is_group_member(coalesce(public.receipt_group(receipt_id), public.trip_group(trip_id)))
    and public.member_group(member_id) = coalesce(public.receipt_group(receipt_id), public.trip_group(trip_id)));

create policy "settlements all" on public.settlements for all to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id)
    and public.member_group(debtor_member) = group_id
    and public.member_group(creditor_member) = group_id
    and (receipt_id is null or public.receipt_group(receipt_id) = group_id)
    and (trip_id is null or public.trip_group(trip_id) = group_id));

-- ── Audit log ────────────────────────────────────────────────
-- Written only by triggers (security definer), never by clients.
-- Members can read their group's log; nobody can edit or delete it.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  group_id    uuid references public.groups(id) on delete cascade,
  table_name  text not null,
  row_id      uuid,
  action      text not null check (action in ('insert', 'update', 'delete')),
  actor       uuid,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_group_time on public.audit_log (group_id, created_at desc);
create index audit_log_row on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
create policy "audit read" on public.audit_log for select to authenticated
  using (public.is_group_member(group_id));

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  gid uuid;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return null;
  end if;

  gid := case tg_table_name
    when 'groups'        then (j->>'id')::uuid
    when 'items'         then public.receipt_group((j->>'receipt_id')::uuid)
    when 'meals'         then public.receipt_group((j->>'receipt_id')::uuid)
    when 'claims'        then public.item_group((j->>'item_id')::uuid)
    when 'checkins'      then coalesce(public.receipt_group((j->>'receipt_id')::uuid), public.trip_group((j->>'trip_id')::uuid))
    else (j->>'group_id')::uuid
  end;

  insert into public.audit_log (group_id, table_name, row_id, action, actor, old_data, new_data)
  values (
    gid,
    tg_table_name,
    (j->>'id')::uuid,
    lower(tg_op),
    auth.uid(),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end $$;

create trigger audit after insert or update or delete on public.groups        for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.group_members for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.receipts      for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.trips         for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.items         for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.meals         for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.claims        for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.checkins      for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.settlements   for each row execute function public.audit_row();

-- ── Group management functions (called via supabase.rpc) ─────
create function public.create_group(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  insert into public.groups (name, created_by) values (trim(p_name), uid) returning id into gid;
  insert into public.group_members (group_id, user_id, first_name, last_name, role)
    select gid, p.id, coalesce(nullif(trim(p.first_name), ''), 'Me'), p.last_name, 'owner'
    from public.profiles p where p.id = uid;
  return gid;
end $$;

-- What the join page shows before you join
create function public.invite_preview(p_code text) returns jsonb
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
    'unclaimed', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'first_name', m.first_name, 'last_name', m.last_name, 'is_guest', m.is_guest)
                       order by m.is_guest, m.first_name)
      from public.group_members m
      where m.group_id = g.id and m.user_id is null and m.active
    ), '[]'::jsonb)
  );
end $$;

-- Join with an invite code, optionally as an existing unclaimed person
create function public.join_group(p_code text, p_claim_member uuid default null) returns uuid
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

  -- Already in (or previously left): just reactivate
  if exists (select 1 from public.group_members where group_id = gid and user_id = uid) then
    update public.group_members set active = true where group_id = gid and user_id = uid;
    return gid;
  end if;

  if p_claim_member is not null then
    update public.group_members set
      user_id = uid,
      first_name = coalesce(nullif(trim(p.first_name), ''), first_name),
      last_name = coalesce(nullif(trim(p.last_name), ''), last_name),
      is_guest = false,
      active = true
    where id = p_claim_member and group_id = gid and user_id is null;
    if not found then raise exception 'That person has already been claimed'; end if;
  else
    insert into public.group_members (group_id, user_id, first_name, last_name)
    values (gid, uid, coalesce(nullif(trim(p.first_name), ''), 'Me'), coalesce(p.last_name, ''));
  end if;
  return gid;
end $$;

create function public.regenerate_invite(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  code text;
begin
  if not public.is_group_owner(p_group) then raise exception 'Only the group owner can do that'; end if;
  update public.groups set invite_code = public.new_invite_code() where id = p_group returning invite_code into code;
  return code;
end $$;

create function public.leave_group(p_group uuid) returns void
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
  update public.group_members set active = false where group_id = p_group and user_id = uid;
end $$;

-- Owner: deactivate someone (their history stays)
create function public.remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := public.member_group(p_member);
begin
  if not public.is_group_owner(gid) then raise exception 'Only the group owner can do that'; end if;
  if exists (select 1 from public.group_members where id = p_member and user_id = auth.uid()) then
    raise exception 'Use leave group to remove yourself';
  end if;
  update public.group_members set active = false where id = p_member;
end $$;

-- Owner: re-add someone who was removed or left
create function public.restore_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_owner(public.member_group(p_member)) then raise exception 'Only the group owner can do that'; end if;
  update public.group_members set active = true where id = p_member;
end $$;

-- Owner: unlink an account from a person (e.g. someone claimed the wrong name)
create function public.unlink_member(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_owner(public.member_group(p_member)) then raise exception 'Only the group owner can do that'; end if;
  if exists (select 1 from public.group_members where id = p_member and user_id = auth.uid()) then
    raise exception 'You cannot unlink yourself';
  end if;
  update public.group_members set user_id = null where id = p_member;
end $$;

create function public.transfer_ownership(p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := public.member_group(p_member);
begin
  if not public.is_group_owner(gid) then raise exception 'Only the group owner can do that'; end if;
  if not exists (select 1 from public.group_members where id = p_member and user_id is not null and active) then
    raise exception 'Ownership can only go to an active member with an account';
  end if;
  update public.group_members set role = 'member' where group_id = gid and user_id = auth.uid();
  update public.group_members set role = 'owner' where id = p_member;
end $$;

-- Only signed-in users can call these
revoke execute on function
  public.create_group(text), public.invite_preview(text), public.join_group(text, uuid),
  public.regenerate_invite(uuid), public.leave_group(uuid), public.remove_member(uuid),
  public.restore_member(uuid), public.unlink_member(uuid), public.transfer_ownership(uuid)
from public, anon;
grant execute on function
  public.create_group(text), public.invite_preview(text), public.join_group(text, uuid),
  public.regenerate_invite(uuid), public.leave_group(uuid), public.remove_member(uuid),
  public.restore_member(uuid), public.unlink_member(uuid), public.transfer_ownership(uuid)
to authenticated;
