-- ─────────────────────────────────────────────────────────────
--  Payments as amounts. A payment is "X paid Y $Z", optionally
--  for a specific receipt. Balances = receipt debts − payments.
--  Replaces per-receipt settlements; existing settlements are
--  converted by scripts/migrate-settlements-to-payments.mjs and the
--  old table is kept as a read-only archive.
-- ─────────────────────────────────────────────────────────────
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  from_member  uuid not null references public.group_members(id),
  to_member    uuid not null references public.group_members(id),
  amount       numeric(10,2) not null check (amount > 0),
  -- What it was for (optional); applied to that receipt's debt first
  receipt_id   uuid references public.receipts(id),
  note         text,
  paid_at      timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  -- Set only by the one-time settlements import, so it can be re-run safely
  imported_from_settlement uuid unique,
  check (from_member <> to_member)
);
create index payments_group_id on public.payments (group_id);
create index payments_receipt_id on public.payments (receipt_id);

alter table public.payments enable row level security;
-- Supabase's default privileges grant everything on new tables; narrow them
revoke all on public.payments from anon, authenticated;
grant select, insert, update on public.payments to authenticated;

-- Anyone in the group can record or edit payments; no hard deletes
-- (deleting sets deleted_at), and every change is in the audit log.
create policy "payments read" on public.payments for select to authenticated
  using (public.is_group_member(group_id));
create policy "payments insert" on public.payments for insert to authenticated
  with check (public.is_group_member(group_id)
    and public.member_group(from_member) = group_id
    and public.member_group(to_member) = group_id
    and (receipt_id is null or public.receipt_group(receipt_id) = group_id)
    and imported_from_settlement is null);
create policy "payments update" on public.payments for update to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id)
    and public.member_group(from_member) = group_id
    and public.member_group(to_member) = group_id
    and (receipt_id is null or public.receipt_group(receipt_id) = group_id));

create trigger audit after insert or update or delete on public.payments
  for each row execute function public.audit_row();

-- Receipts that someone already marked as paid are clearly finished, so
-- everyone on them counts as checked in. Under the old rule their debts (and
-- payments) were ignored until then; with payments as amounts the payments
-- would count but the debts wouldn't, skewing balances.
insert into public.checkins (receipt_id, member_id)
select distinct r.id, m.id
from public.receipts r
cross join lateral unnest(r.member_ids) as m(id)
where exists (select 1 from public.settlements s where s.receipt_id = r.id)
  and not exists (select 1 from public.checkins c where c.receipt_id = r.id and c.member_id = m.id);

-- Old settlements become a read-only archive
drop policy "settlements all" on public.settlements;
create policy "settlements read" on public.settlements for select to authenticated
  using (public.is_group_member(group_id));
revoke insert, update, delete on public.settlements from authenticated;

-- merge_members: trips are gone; payments move along with everything else
create or replace function public.merge_members(p_from uuid, p_into uuid) returns void
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
end $$;
