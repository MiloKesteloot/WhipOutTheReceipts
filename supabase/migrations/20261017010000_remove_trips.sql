-- ─────────────────────────────────────────────────────────────
--  Remove trips. They were the original way to bundle receipts;
--  groups replaced them and nothing in the app creates them anymore.
--  Their receipts already have dates and people, so they simply
--  become normal receipts.
-- ─────────────────────────────────────────────────────────────

-- Trip-level check-ins become check-ins on each of that trip's receipts
insert into public.checkins (receipt_id, member_id)
select r.id, c.member_id
from public.checkins c
join public.receipts r on r.trip_id = c.trip_id
where c.receipt_id is null
  and not exists (select 1 from public.checkins x where x.receipt_id = r.id and x.member_id = c.member_id)
group by r.id, c.member_id;
delete from public.checkins where receipt_id is null;

-- Any trip receipt missing a date or people takes them from its trip
update public.receipts r set
  receipt_date = coalesce(r.receipt_date, t.trip_date, t.created_at::date),
  member_ids = case when cardinality(r.member_ids) = 0 then t.member_ids else r.member_ids end
from public.trips t
where r.trip_id = t.id;

-- Policies that mention trips are rebuilt without them
drop policy "checkins all" on public.checkins;
drop policy "settlements all" on public.settlements;

alter table public.checkins
  drop column trip_id,
  alter column receipt_id set not null,
  add constraint checkins_receipt_member_key unique (receipt_id, member_id);
alter table public.settlements drop column trip_id;
alter table public.receipts drop column trip_id;
drop table public.trips;

create policy "checkins all" on public.checkins for all to authenticated
  using (public.is_group_member(public.receipt_group(receipt_id)))
  with check (public.is_group_member(public.receipt_group(receipt_id))
    and public.member_group(member_id) = public.receipt_group(receipt_id));

create policy "settlements all" on public.settlements for all to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id)
    and public.member_group(debtor_member) = group_id
    and public.member_group(creditor_member) = group_id
    and (receipt_id is null or public.receipt_group(receipt_id) = group_id));

-- Audit trigger: checkins now always belong to a receipt. Also adds a
-- session switch so one-time data imports don't flood the history.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  gid uuid;
begin
  if current_setting('app.skip_audit', true) = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return null;
  end if;

  gid := case tg_table_name
    when 'groups'   then (j->>'id')::uuid
    when 'items'    then public.receipt_group((j->>'receipt_id')::uuid)
    when 'meals'    then public.receipt_group((j->>'receipt_id')::uuid)
    when 'claims'   then public.item_group((j->>'item_id')::uuid)
    when 'checkins' then public.receipt_group((j->>'receipt_id')::uuid)
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

drop function public.trip_group(uuid);
