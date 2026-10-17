-- Merge one person into another within a group (e.g. a typo'd guest name).
-- Moves all their history to p_into and deactivates p_from. Every change
-- goes through the audit triggers like any other edit.
create function public.merge_members(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := public.member_group(p_from);
  from_user uuid;
  into_user uuid;
begin
  if p_from = p_into then raise exception 'Pick two different people'; end if;
  if gid is null or gid is distinct from public.member_group(p_into) then
    raise exception 'Both people must be in the same group';
  end if;
  if not public.is_group_member(gid) then raise exception 'Not a member of this group'; end if;

  select user_id into from_user from public.group_members where id = p_from;
  select user_id into into_user from public.group_members where id = p_into;
  if from_user is not null and into_user is not null then
    raise exception 'Both people have accounts, so they can''t be merged';
  end if;

  -- Claims / checkins: drop rows that would duplicate, then move the rest
  delete from public.claims c where c.member_id = p_from
    and exists (select 1 from public.claims d where d.item_id = c.item_id and d.member_id = p_into);
  update public.claims set member_id = p_into where member_id = p_from;

  delete from public.checkins c where c.member_id = p_from
    and exists (select 1 from public.checkins d where d.member_id = p_into
                and d.receipt_id is not distinct from c.receipt_id and d.trip_id is not distinct from c.trip_id);
  update public.checkins set member_id = p_into where member_id = p_from;

  update public.receipts set paid_by_member = p_into where paid_by_member = p_from;
  update public.receipts set member_ids = array(
      select m from unnest(array_replace(member_ids, p_from, p_into)) with ordinality u(m, o) group by m order by min(o)
    ) where p_from = any(member_ids);
  update public.trips set member_ids = array(
      select m from unnest(array_replace(member_ids, p_from, p_into)) with ordinality u(m, o) group by m order by min(o)
    ) where p_from = any(member_ids);

  update public.settlements set debtor_member = p_into where debtor_member = p_from;
  update public.settlements set creditor_member = p_into where creditor_member = p_from;
  delete from public.settlements where debtor_member = creditor_member and group_id = gid;

  -- An account follows the merge so the person keeps their login
  update public.group_members set user_id = null, active = false where id = p_from;
  if from_user is not null then
    update public.group_members set user_id = from_user, is_guest = false where id = p_into;
  end if;
end $$;

revoke execute on function public.merge_members(uuid, uuid) from public, anon;
grant execute on function public.merge_members(uuid, uuid) to authenticated;
