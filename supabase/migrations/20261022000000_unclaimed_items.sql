-- ─────────────────────────────────────────────────────────────
--  Unclaimed items
--
--  - receipts.splits_unclaimed: whether an item nobody claims is split
--    between everyone on the receipt (with its tax/tip share), or left
--    on the payer as before. New receipts split. Receipts from before
--    the split (UNCLAIMED_SPLIT_FROM in src/lib/splitLogic.js) keep the
--    payer paying, so balances people settled don't change, except two
--    receipts that were still waiting on check-ins when it came in.
--  - item_dismissals: "Not mine" on an unclaimed item. Home shows each
--    unclaimed item on a finished receipt to everyone on it until it's
--    claimed or they say it's not theirs; who said so is shown to the
--    others, so whoever bought it gets asked.
-- ─────────────────────────────────────────────────────────────

alter table public.receipts add column splits_unclaimed boolean not null default true;

-- A data fix, not anyone's edit, so it isn't logged as one
select set_config('app.skip_audit', 'on', true);
update public.receipts set splits_unclaimed = false where created_at < '2026-10-22T00:35:29Z';
-- Still open (waiting on check-ins) when the split came in: Safeway Oct 12
-- and Oct 4 in The Coolest Apt
update public.receipts set splits_unclaimed = true
  where id in ('751082fc-eaba-46ee-8bc4-f1e9499b7a1c', '5b847d27-ff74-4c69-9951-6a3f09d16316');
select set_config('app.skip_audit', 'off', true);

-- ── "Not mine" ─────────────────────────────────────────────────
create table public.item_dismissals (
  item_id    uuid not null references public.items(id) on delete cascade,
  member_id  uuid not null references public.group_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, member_id)
);
alter table public.item_dismissals enable row level security;

revoke all on public.item_dismissals from anon, authenticated;
grant select, insert, delete on public.item_dismissals to authenticated;

create policy "dismissals read" on public.item_dismissals for select to authenticated
  using (public.is_group_member(public.item_group(item_id)));
-- For yourself, or someone without an account (like check-offs)
create policy "dismissals add" on public.item_dismissals for insert to authenticated
  with check (public.is_group_member(public.item_group(item_id))
    and public.member_group(member_id) = public.item_group(item_id)
    and public.can_act_for(member_id));
create policy "dismissals remove" on public.item_dismissals for delete to authenticated
  using (public.is_group_member(public.item_group(item_id)) and public.can_act_for(member_id));

-- ── Guest links ────────────────────────────────────────────────
-- Same as before, plus each receipt's splits_unclaimed and dismissals
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
        'paid_by_member', r.paid_by_member, 'member_ids', r.member_ids, 'splits_unclaimed', r.splits_unclaimed,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'price', i.price, 'always_split', i.always_split, 'meal_id', i.meal_id)
                    order by i.position nulls last, i.created_at), '[]')
                  from public.items i where i.receipt_id = r.id and i.deleted_at is null),
        'meals', (select coalesce(jsonb_agg(jsonb_build_object('id', ml.id, 'name', ml.name, 'fee', ml.fee) order by ml.created_at, ml.id), '[]')
                  from public.meals ml where ml.receipt_id = r.id and ml.deleted_at is null),
        'claims', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'item_id', c.item_id, 'member_id', c.member_id) order by c.id), '[]')
                   from public.claims c join public.items i on i.id = c.item_id
                   where i.receipt_id = r.id and i.deleted_at is null),
        'dismissals', (select coalesce(jsonb_agg(jsonb_build_object('item_id', d.item_id, 'member_id', d.member_id)), '[]')
                       from public.item_dismissals d join public.items i on i.id = d.item_id
                       where i.receipt_id = r.id and i.deleted_at is null),
        'checkins', (select coalesce(jsonb_agg(k.member_id), '[]') from public.checkins k where k.receipt_id = r.id)
      ) order by r.receipt_date desc nulls last, r.created_at desc), '[]')
      from public.receipts r
      where r.group_id = g.group_id and r.deleted_at is null
        and (g.id = any(r.member_ids) or r.paid_by_member = g.id)
        and exists (select 1 from public.items i where i.receipt_id = r.id and i.deleted_at is null)
    ),
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

-- "Not mine" from a guest link, on an item of a receipt the guest is on
create function public.guest_dismiss_item(p_token text, p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.group_members;
begin
  select * into g from public.guest_member(p_token);
  if g.id is null then raise exception 'This guest link is no longer valid'; end if;
  if not exists (
    select 1 from public.items i join public.receipts r on r.id = i.receipt_id
    where i.id = p_item and i.deleted_at is null and r.deleted_at is null and r.group_id = g.group_id
      and (g.id = any(r.member_ids) or r.paid_by_member = g.id)
  ) then
    raise exception 'That item is not available on this link';
  end if;
  insert into public.item_dismissals (item_id, member_id) values (p_item, g.id)
  on conflict (item_id, member_id) do nothing;
end $$;

revoke all on function public.guest_dismiss_item(text, uuid) from public, anon, authenticated;
grant execute on function public.guest_dismiss_item(text, uuid) to anon, authenticated;

-- ── Merging people moves their "Not mine"s too ─────────────────
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

  delete from public.item_dismissals x where x.member_id = p_from
    and exists (select 1 from public.item_dismissals y where y.member_id = p_into and y.item_id = x.item_id);
  update public.item_dismissals set member_id = p_into where member_id = p_from;

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
