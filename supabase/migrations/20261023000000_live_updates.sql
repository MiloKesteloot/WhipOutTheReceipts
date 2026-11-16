-- ─────────────────────────────────────────────────────────────
--  Live updates
--
--  - Realtime: the tables the app shows are published, so open pages
--    hear about changes (with the same row permissions as reading them).
--  - receipts.version: goes up with any change to a receipt, its items
--    or its meals. Saving an edit says which version it started from;
--    if someone saved in between, nothing is written and the app merges
--    the two edits first (save_receipt raises RCPT1). Version bumps
--    aren't logged in the receipt's history.
--  - save_receipt: creating or editing a receipt in one transaction
--    (it used to be several requests, so a failure could half-save and
--    other people could see a half-saved receipt).
--  - Editing a receipt only asks people to check in again when items
--    are added (or newly split by everyone), and says why. A price
--    change on an item someone checked off tells them instead (Home
--    shows it). Removing items, renaming, tax/tip and meals don't
--    reopen anything.
--  - Guest links: the guest page gets each receipt's version, and
--    guest_save_claims refuses a save made from an out-of-date receipt.
-- ─────────────────────────────────────────────────────────────

-- ── Version ────────────────────────────────────────────────────
alter table public.receipts add column version integer not null default 1;

-- A change to the receipt row itself (anything but the version)
create function public.bump_receipt_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.version = old.version and (to_jsonb(new) - 'version') <> (to_jsonb(old) - 'version') then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger bump_version before update on public.receipts
  for each row execute function public.bump_receipt_version();

-- A change to its items or meals: once per statement, so saving many
-- items is one bump (and one live update) rather than one per row
create function public.bump_parent_receipt_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.receipts set version = version + 1 where id in (select distinct receipt_id from new_rows);
  elsif tg_op = 'DELETE' then
    update public.receipts set version = version + 1 where id in (select distinct receipt_id from old_rows);
  else
    update public.receipts set version = version + 1
    where id in (select receipt_id from new_rows union select receipt_id from old_rows);
  end if;
  return null;
end $$;

create trigger bump_receipt_on_insert after insert on public.items
  referencing new table as new_rows for each statement execute function public.bump_parent_receipt_version();
create trigger bump_receipt_on_update after update on public.items
  referencing old table as old_rows new table as new_rows for each statement execute function public.bump_parent_receipt_version();
create trigger bump_receipt_on_delete after delete on public.items
  referencing old table as old_rows for each statement execute function public.bump_parent_receipt_version();
create trigger bump_receipt_on_insert after insert on public.meals
  referencing new table as new_rows for each statement execute function public.bump_parent_receipt_version();
create trigger bump_receipt_on_update after update on public.meals
  referencing old table as old_rows new table as new_rows for each statement execute function public.bump_parent_receipt_version();
create trigger bump_receipt_on_delete after delete on public.meals
  referencing old table as old_rows for each statement execute function public.bump_parent_receipt_version();

-- History: a change to nothing but the version isn't an edit
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  gid uuid;
begin
  if current_setting('app.skip_audit', true) = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'version') = (to_jsonb(new) - 'version') then
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

-- ── Notices: why a receipt changed under you ───────────────────
--  added:  an item was added after you checked in (you check in again)
--  shared: an item became split by everyone after you checked in (same)
--  price:  an item you checked off changed price (Home asks if it's ok)
-- member_id is who it's for (a guest's are cleared when they save).
create table public.receipt_notices (
  id           uuid primary key default gen_random_uuid(),
  receipt_id   uuid not null references public.receipts(id) on delete cascade,
  member_id    uuid not null references public.group_members(id) on delete cascade,
  actor_member uuid references public.group_members(id) on delete set null,
  kind         text not null check (kind in ('added', 'shared', 'price')),
  item_id      uuid not null references public.items(id) on delete cascade,
  old_price    numeric(10,2),
  new_price    numeric(10,2),
  created_at   timestamptz not null default now(),
  seen_at      timestamptz
);
create index receipt_notices_member on public.receipt_notices (member_id) where seen_at is null;
create index receipt_notices_receipt on public.receipt_notices (receipt_id);
alter table public.receipt_notices enable row level security;

revoke all on public.receipt_notices from anon, authenticated;
grant select on public.receipt_notices to authenticated;
-- Yours, or a guest's you're checking off for
create policy "notices read" on public.receipt_notices for select to authenticated
  using (public.is_group_member(public.member_group(member_id)) and public.can_act_for(member_id));

-- "Looks good" on a notice (or opening the receipt it's about)
create function public.mark_notices_seen(p_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.receipt_notices set seen_at = now()
  where id = any(coalesce(p_ids, '{}')) and seen_at is null
    and public.is_group_member(public.member_group(member_id)) and public.can_act_for(member_id)
$$;
revoke all on function public.mark_notices_seen(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_notices_seen(uuid[]) to authenticated;

-- Checking in again answers "an item was added": those notices are done
create function public.clear_added_notices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.receipt_notices set seen_at = now()
  where receipt_id = new.receipt_id and member_id = new.member_id
    and kind in ('added', 'shared') and seen_at is null;
  return null;
end $$;
create trigger clear_added_notices after insert on public.checkins
  for each row execute function public.clear_added_notices();

-- ── Saving a receipt ───────────────────────────────────────────
-- p_receipt null creates one. p_data is the whole receipt as it should be:
--   { store_name, paid_by_member, category, tip, tax, fees, receipt_date,
--     member_ids: [...],
--     meals: [{ id (null if new), key, name, fee }],
--     items: [{ id (null if new), name, price, always_split,
--               meal (an existing meal's id) or meal_key (a new one's key), position }] }
-- Meals and items it leaves out are removed. Returns { id, version }.
create function public.save_receipt(p_group uuid, p_receipt uuid, p_version integer, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid;
  r public.receipts;
  rid uuid;
  paid uuid := (p_data->>'paid_by_member')::uuid;
  mids uuid[] := array(select jsonb_array_elements_text(coalesce(p_data->'member_ids', '[]'))::uuid);
  meal_ids jsonb := '{}';
  m record;
  new_id uuid;
  old_items jsonb;
  added uuid[];
  shared uuid[];
  reopen boolean;
begin
  if not public.is_group_member(p_group) then
    raise exception 'You are not in this group';
  end if;
  select id into me from public.group_members where group_id = p_group and user_id = (select auth.uid()) and active;
  if paid is null or public.member_group(paid) is distinct from p_group or not public.members_in_group(mids, p_group) then
    raise exception 'Those people are not in this group';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_data->'items', '[]')) as x(name text, price numeric)
    where coalesce(trim(x.name), '') = '' or x.price is null
  ) then
    raise exception 'Every item needs a name and a price';
  end if;
  if coalesce(trim(p_data->>'store_name'), '') = '' then
    raise exception 'Add the store name';
  end if;
  if jsonb_array_length(coalesce(p_data->'items', '[]')) = 0 then
    raise exception 'Add at least one item';
  end if;

  if p_receipt is null then
    insert into public.receipts (group_id, store_name, paid_by_member, category, tip, tax, fees, receipt_date, member_ids)
    values (p_group, trim(p_data->>'store_name'), paid, coalesce(p_data->>'category', 'Groceries'),
      coalesce((p_data->>'tip')::numeric, 0), coalesce((p_data->>'tax')::numeric, 0), coalesce((p_data->>'fees')::numeric, 0),
      (p_data->>'receipt_date')::date, mids)
    returning * into r;
  else
    select * into r from public.receipts where id = p_receipt for update;
    if r.id is null or r.group_id <> p_group then
      raise exception 'Receipt not found';
    end if;
    if r.deleted_at is not null then
      raise exception using errcode = 'RCPT2', message = 'This receipt was deleted';
    end if;
    if r.version <> p_version then
      raise exception using errcode = 'RCPT1', message = 'Someone else changed this receipt';
    end if;
    update public.receipts set
      store_name = trim(p_data->>'store_name'), paid_by_member = paid, category = coalesce(p_data->>'category', r.category),
      tip = coalesce((p_data->>'tip')::numeric, 0), tax = coalesce((p_data->>'tax')::numeric, 0),
      fees = coalesce((p_data->>'fees')::numeric, 0), receipt_date = (p_data->>'receipt_date')::date, member_ids = mids
    where id = r.id;
  end if;
  rid := r.id;

  select coalesce(jsonb_object_agg(id, jsonb_build_object('price', price, 'always_split', always_split)), '{}')
  into old_items from public.items where receipt_id = rid and deleted_at is null;

  -- Meals: update, remove, then add (one at a time, so they keep their order)
  update public.meals ml set name = trim(x.name), fee = coalesce(x.fee, 0)
  from jsonb_to_recordset(coalesce(p_data->'meals', '[]')) as x(id uuid, name text, fee numeric)
  where ml.id = x.id and ml.receipt_id = rid and ml.deleted_at is null
    and (ml.name, ml.fee) is distinct from (trim(x.name), coalesce(x.fee, 0));
  update public.meals set deleted_at = now()
  where receipt_id = rid and deleted_at is null and id not in (
    select x.id from jsonb_to_recordset(coalesce(p_data->'meals', '[]')) as x(id uuid) where x.id is not null);
  for m in select * from jsonb_to_recordset(coalesce(p_data->'meals', '[]')) as x(id uuid, key text, name text, fee numeric) loop
    if m.id is null then
      insert into public.meals (receipt_id, name, fee, created_at)
      values (rid, trim(m.name), coalesce(m.fee, 0), clock_timestamp()) returning id into new_id;
      meal_ids := meal_ids || jsonb_build_object(m.key, new_id);
    end if;
  end loop;

  -- Items: update, add, remove. A meal must be one of this receipt's.
  update public.items i set name = trim(x.name), price = x.price, always_split = coalesce(x.always_split, false),
    meal_id = coalesce((select ml.id from public.meals ml where ml.id = x.meal and ml.receipt_id = rid and ml.deleted_at is null),
                       (meal_ids->>x.meal_key)::uuid),
    position = x.position
  from jsonb_to_recordset(coalesce(p_data->'items', '[]'))
    as x(id uuid, name text, price numeric, always_split boolean, meal uuid, meal_key text, position integer)
  where i.id = x.id and i.receipt_id = rid and i.deleted_at is null
    and (i.name, i.price, i.always_split, i.meal_id, i.position) is distinct from (
      trim(x.name), x.price, coalesce(x.always_split, false),
      coalesce((select ml.id from public.meals ml where ml.id = x.meal and ml.receipt_id = rid and ml.deleted_at is null),
               (meal_ids->>x.meal_key)::uuid),
      x.position);

  with ins as (
    insert into public.items (receipt_id, name, price, always_split, meal_id, position)
    select rid, trim(x.name), x.price, coalesce(x.always_split, false),
      coalesce((select ml.id from public.meals ml where ml.id = x.meal and ml.receipt_id = rid and ml.deleted_at is null),
               (meal_ids->>x.meal_key)::uuid),
      x.position
    from jsonb_to_recordset(coalesce(p_data->'items', '[]'))
      as x(id uuid, name text, price numeric, always_split boolean, meal uuid, meal_key text, position integer)
    where x.id is null or not (old_items ? x.id::text)
    returning id
  )
  select coalesce(array_agg(id), '{}') into added from ins;

  -- Removed items take their unread notices with them
  with removed as (
    update public.items set deleted_at = now()
    where receipt_id = rid and deleted_at is null and not (id = any(added)) and id not in (
      select x.id from jsonb_to_recordset(coalesce(p_data->'items', '[]')) as x(id uuid) where x.id is not null)
    returning id
  )
  delete from public.receipt_notices where seen_at is null and item_id in (select id from removed);

  if p_receipt is not null then
    -- People taken off the receipt: their check-offs and check-in go too.
    -- An empty list means everyone is on it, so nobody is taken off.
    if cardinality(mids) > 0 then
      delete from public.claims c using public.items i
      where i.id = c.item_id and i.receipt_id = rid and c.member_id <> all(mids || paid);
      delete from public.checkins where receipt_id = rid and member_id <> all(mids || paid);
    end if;

    -- Newly split by everyone
    select coalesce(array_agg(i.id), '{}') into shared from public.items i
    where i.receipt_id = rid and i.deleted_at is null and i.always_split
      and old_items ? i.id::text and not (old_items->i.id::text->>'always_split')::boolean;

    -- Added or newly shared: everyone else who had checked in does it again, and is told why
    reopen := cardinality(added) > 0 or cardinality(shared) > 0;
    if reopen then
      insert into public.receipt_notices (receipt_id, member_id, actor_member, kind, item_id)
      select rid, k.member_id, me, kind, item_id
      from public.checkins k
      cross join lateral (
        select 'added' as kind, unnest(added) as item_id
        union all select 'shared', unnest(shared)
      ) what
      where k.receipt_id = rid and k.member_id is distinct from me;
      delete from public.checkins where receipt_id = rid and member_id is distinct from me;
    end if;

    -- Price changes on items people checked off: tell them (one notice per
    -- person and item, kept up to date; gone if it's back to what they saw)
    for m in
      select i.id as item_id, (old_items->i.id::text->>'price')::numeric as old_price, i.price as new_price
      from public.items i
      where i.receipt_id = rid and i.deleted_at is null and old_items ? i.id::text
        and (old_items->i.id::text->>'price')::numeric <> i.price
    loop
      update public.receipt_notices n set new_price = m.new_price, actor_member = me, created_at = now()
      where n.item_id = m.item_id and n.kind = 'price' and n.seen_at is null
        and n.member_id in (select c.member_id from public.claims c where c.item_id = m.item_id and c.member_id is distinct from me);
      insert into public.receipt_notices (receipt_id, member_id, actor_member, kind, item_id, old_price, new_price)
      select rid, c.member_id, me, 'price', m.item_id, m.old_price, m.new_price
      from public.claims c
      where c.item_id = m.item_id and c.member_id is distinct from me
        and not exists (select 1 from public.receipt_notices n
                        where n.item_id = m.item_id and n.member_id = c.member_id and n.kind = 'price' and n.seen_at is null);
      delete from public.receipt_notices
      where item_id = m.item_id and kind = 'price' and seen_at is null and old_price = new_price;
    end loop;
  end if;

  return jsonb_build_object('id', rid, 'version', (select version from public.receipts where id = rid));
end $$;

revoke all on function public.save_receipt(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_receipt(uuid, uuid, integer, jsonb) to authenticated;

-- ── Guest links ────────────────────────────────────────────────
-- Same as before, plus each receipt's version and the items added since
-- the guest checked in (the page asks about each before saving)
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
        'version', r.version,
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
        'checkins', (select coalesce(jsonb_agg(k.member_id), '[]') from public.checkins k where k.receipt_id = r.id),
        'added_items', (select coalesce(jsonb_agg(distinct n.item_id), '[]') from public.receipt_notices n
                        where n.receipt_id = r.id and n.member_id = g.id and n.kind = 'added' and n.seen_at is null)
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

-- Same as before, plus p_version: a save made from an out-of-date copy of
-- the receipt is refused (RCPT1), so the page can show what changed first.
-- (Without it, as from a page loaded before this, it saves as before.)
drop function public.guest_save_claims(text, uuid, uuid[]);
create function public.guest_save_claims(p_token text, p_receipt uuid, p_item_ids uuid[], p_version integer default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.group_members;
  v integer;
begin
  select * into g from public.guest_member(p_token);
  if g.id is null then raise exception 'This guest link is no longer valid'; end if;
  select r.version into v from public.receipts r
  where r.id = p_receipt and r.group_id = g.group_id and r.deleted_at is null
    and (g.id = any(r.member_ids) or r.paid_by_member = g.id)
  for update;
  if v is null then
    raise exception 'That receipt is not available on this link';
  end if;
  if p_version is not null and v <> p_version then
    raise exception using errcode = 'RCPT1', message = 'This receipt changed since you opened it';
  end if;

  delete from public.claims c
  using public.items i
  where i.id = c.item_id and i.receipt_id = p_receipt and c.member_id = g.id
    and not (c.item_id = any(coalesce(p_item_ids, '{}')));

  insert into public.claims (item_id, member_id)
  select i.id, g.id from public.items i
  where i.receipt_id = p_receipt and i.deleted_at is null and i.id = any(coalesce(p_item_ids, '{}'))
  on conflict (item_id, member_id) do nothing;

  insert into public.checkins (receipt_id, member_id) values (p_receipt, g.id)
  on conflict (receipt_id, member_id) do nothing;
end $$;

revoke all on function public.guest_save_claims(text, uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.guest_save_claims(text, uuid, uuid[], integer) to anon, authenticated;

-- ── Your own membership ────────────────────────────────────────
-- You can always read your own row in a group, even once you're removed:
-- that's how the change that removes you reaches your open app (live
-- updates only send rows you can read), so it can say you're no longer in
-- the group. Nothing else about the group becomes readable.
create policy "members read own" on public.group_members for select to authenticated
  using (user_id = (select auth.uid()));

-- ── Realtime ───────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.receipts, public.items, public.meals, public.claims, public.checkins,
  public.payments, public.item_dismissals, public.group_members, public.groups,
  public.receipt_notices;
