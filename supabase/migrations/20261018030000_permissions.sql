-- ─────────────────────────────────────────────────────────────
--  Tighter permissions inside a group, and claimers on receipts.
--
--  - Check-offs (claims) and check-ins: you can only add or remove
--    them for yourself, or for someone without an account (guests),
--    not for another member who has their own login.
--  - Payments: you can only record, edit or remove payments that you
--    sent or received.
--  - Merging people: owner only (it can move someone's account onto
--    another person, taking on their history).
--  - Anyone who has checked items off a receipt is one of its members
--    (the app now adds them when they save). Existing receipts are
--    brought in line here, with a check-in for any claimer missing
--    one, so no one's balance changes.
-- ─────────────────────────────────────────────────────────────

-- Is this person me, or someone without an account (a guest)?
create function public.can_act_for(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members
    where id = mid and (user_id = (select auth.uid()) or user_id is null)
  )
$$;

-- Is this person me?
create function public.is_me(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where id = mid and user_id = (select auth.uid()))
$$;

-- Is this person on the receipt this item belongs to (a member or the payer)?
create function public.on_item_receipt(iid uuid, mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i join public.receipts r on r.id = i.receipt_id
    where i.id = iid and (mid = any(r.member_ids) or r.paid_by_member = mid)
  )
$$;

revoke all on function public.can_act_for(uuid), public.is_me(uuid), public.on_item_receipt(uuid, uuid) from public, anon;
grant execute on function public.can_act_for(uuid), public.is_me(uuid), public.on_item_receipt(uuid, uuid) to authenticated;

-- ── Claims ────────────────────────────────────────────────────
drop policy "claims all" on public.claims;
create policy "claims read" on public.claims for select to authenticated
  using (public.is_group_member(public.item_group(item_id)));
create policy "claims add" on public.claims for insert to authenticated
  with check (public.is_group_member(public.item_group(item_id))
    and public.member_group(member_id) = public.item_group(item_id)
    and public.can_act_for(member_id));
create policy "claims change" on public.claims for update to authenticated
  using (public.is_group_member(public.item_group(item_id)) and public.can_act_for(member_id))
  with check (public.is_group_member(public.item_group(item_id))
    and public.member_group(member_id) = public.item_group(item_id)
    and public.can_act_for(member_id));
-- Removing: your own or a guest's, or anyone's once they've been taken off
-- the receipt (the editor clears a removed person's check-offs)
create policy "claims remove" on public.claims for delete to authenticated
  using (public.is_group_member(public.item_group(item_id))
    and (public.can_act_for(member_id) or not public.on_item_receipt(item_id, member_id)));

-- ── Check-ins ─────────────────────────────────────────────────
drop policy "checkins all" on public.checkins;
create policy "checkins read" on public.checkins for select to authenticated
  using (public.is_group_member(public.receipt_group(receipt_id)));
create policy "checkins add" on public.checkins for insert to authenticated
  with check (public.is_group_member(public.receipt_group(receipt_id))
    and public.member_group(member_id) = public.receipt_group(receipt_id)
    and public.can_act_for(member_id));
create policy "checkins change" on public.checkins for update to authenticated
  using (public.is_group_member(public.receipt_group(receipt_id)) and public.can_act_for(member_id))
  with check (public.is_group_member(public.receipt_group(receipt_id))
    and public.member_group(member_id) = public.receipt_group(receipt_id)
    and public.can_act_for(member_id));
-- Removing check-ins: your own or a guest's, or anyone's on a receipt
-- whose items just changed (the editor asks everyone to look again)
create policy "checkins remove" on public.checkins for delete to authenticated
  using (public.is_group_member(public.receipt_group(receipt_id)));

-- ── Payments ──────────────────────────────────────────────────
drop policy "payments insert" on public.payments;
drop policy "payments update" on public.payments;
create policy "payments insert" on public.payments for insert to authenticated
  with check (public.is_group_member(group_id)
    and public.member_group(from_member) = group_id
    and public.member_group(to_member) = group_id
    and (receipt_id is null or public.receipt_group(receipt_id) = group_id)
    and imported_from_settlement is null
    and (public.is_me(from_member) or public.is_me(to_member)));
create policy "payments update" on public.payments for update to authenticated
  using (public.is_group_member(group_id) and (public.is_me(from_member) or public.is_me(to_member)))
  with check (public.is_group_member(group_id)
    and public.member_group(from_member) = group_id
    and public.member_group(to_member) = group_id
    and (receipt_id is null or public.receipt_group(receipt_id) = group_id)
    and (public.is_me(from_member) or public.is_me(to_member)));

-- ── Merging people: owner only ────────────────────────────────
create or replace function public.merge_members(p_from uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  gid uuid := public.member_group(p_from);
  from_user uuid;
  into_user uuid;
begin
  if p_from = p_into then raise exception 'Pick two different people'; end if;
  if gid is null or gid is distinct from public.member_group(p_into) then
    raise exception 'Both people must be in the same group';
  end if;
  if not public.is_group_owner(gid) then raise exception 'Only the group owner can merge people'; end if;

  select user_id into from_user from public.group_members where id = p_from;
  select user_id into into_user from public.group_members where id = p_into;
  if from_user is not null and into_user is not null then
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

  update public.group_members set user_id = null, active = false where id = p_from;
  if from_user is not null then
    update public.group_members set user_id = from_user, is_guest = false where id = p_into;
  end if;
end $function$;

-- ── Claimers are members (existing data) ──────────────────────
-- A data fix, not anyone's action, so it isn't logged as one
select set_config('app.skip_audit', 'on', true);

-- People who checked items off a receipt without being on it
create temporary table off_list on commit drop as
  select distinct i.receipt_id, c.member_id
  from public.claims c
  join public.items i on i.id = c.item_id and i.deleted_at is null
  join public.receipts r on r.id = i.receipt_id
  where coalesce(array_length(r.member_ids, 1), 0) > 0
    and not (c.member_id = any(r.member_ids));

update public.receipts r
set member_ids = r.member_ids || array(select o.member_id from off_list o where o.receipt_id = r.id order by o.member_id)
where r.id in (select receipt_id from off_list);

-- They weren't required to check in before; now they're members, so they
-- count as checked in (they did check items off), keeping balances as they were
insert into public.checkins (receipt_id, member_id)
select receipt_id, member_id from off_list
on conflict (receipt_id, member_id) do nothing;

select set_config('app.skip_audit', 'off', true);
