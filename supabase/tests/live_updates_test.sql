-- Live updates, receipt versions, save_receipt and notices
-- (supabase/migrations/20261023000000_live_updates.sql). Runs inside a
-- transaction and rolls back, so it leaves no trace.
--   psql <local-db-url> -v ON_ERROR_STOP=1 -f supabase/tests/live_updates_test.sql
-- Needs the UI-testing database (`npm run ui:reset`): it uses the test
-- accounts milo@test.local and alex@test.local in "The Coolest Apt".
-- Each check raises on failure; reaching "ALL CHECKS PASSED" means success.

begin;

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Expect a statement to error (optionally with a given SQLSTATE)
create function pg_temp.expect_error(stmt text, what text, code text default null) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if code is not null and sqlstate <> code then
      raise exception 'FAILED: % (wrong error %: %)', what, sqlstate, sqlerrm;
    end if;
    raise notice 'ok - % (blocked: %)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (statement succeeded)', what;
end $$;

-- ── Who's who ────────────────────────────────────────────────
select id as milo_user from auth.users where email = 'milo@test.local' \gset
select id as alex_user from auth.users where email = 'alex@test.local' \gset
select id as gid from groups where invite_code = '348U9RQ5' \gset
select id as milo from group_members where group_id = :'gid' and user_id = :'milo_user' \gset
select id as alex from group_members where group_id = :'gid' and user_id = :'alex_user' \gset
select id as clouey from group_members where group_id = :'gid' and first_name = 'Clouey' and user_id is null \gset
select pg_temp.check(:'milo' is not null and :'alex' is not null and :'clouey' is not null, 'test accounts and Clouey (a guest) are in the group');

-- A stranger with an account but no group
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger@example.com',
   '{"first_name": "Sam", "last_name": "Stranger"}');

-- ── Realtime ─────────────────────────────────────────────────
select pg_temp.check(
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('receipts', 'items', 'meals', 'claims', 'checkins', 'payments', 'item_dismissals',
                       'group_members', 'groups', 'receipt_notices')) = 10,
  'every table the app shows is published for live updates');
-- Any table the app reads should be in that list: a new one left out
-- would never update live, with no error anywhere
select pg_temp.check(not exists (
  select 1 from pg_tables t where t.schemaname = 'public'
    and t.tablename not in ('receipts', 'items', 'meals', 'claims', 'checkins', 'payments', 'item_dismissals',
                            'group_members', 'groups', 'receipt_notices',
                            -- not shown live: history is loaded on open; the rest aren't shown or are gone
                            'audit_log', 'profiles', 'user_secrets', 'settlements',
                            -- Discord: settings are loaded on open; the outbox is the bot's alone
                            'discord_links', 'notification_outbox')
), 'no table is missing from that decision (add new tables to the publication or to this list)');

-- ── Creating a receipt ───────────────────────────────────────
select pg_temp.act_as(:'milo_user');

select pg_temp.expect_error(format($$select save_receipt(%L, null, null, '{"store_name":"X","paid_by_member":"%s","member_ids":[],"items":[]}')$$, :'gid', :'milo'),
  'a receipt needs at least one item');
select pg_temp.expect_error(format($$select save_receipt(%L, null, null, '{"store_name":"X","paid_by_member":"%s","member_ids":[],"items":[{"name":" ","price":1}]}')$$, :'gid', :'milo'),
  'every item needs a name');
select pg_temp.expect_error(format($$select save_receipt(%L, null, null, '{"store_name":" ","paid_by_member":"%s","member_ids":[],"items":[{"name":"A","price":1}]}')$$, :'gid', :'milo'),
  'a receipt needs a store name');
select pg_temp.expect_error(format($$select save_receipt(%L, null, null, '{"store_name":"X","paid_by_member":"%s","member_ids":["00000000-0000-0000-0000-000000000099"],"items":[{"name":"A","price":1}]}')$$, :'gid', :'milo'),
  'people must be in the group');

select save_receipt(:'gid', null, null, jsonb_build_object(
  'store_name', '  Live Test Store ', 'paid_by_member', :'milo', 'category', 'Groceries',
  'tip', 0, 'tax', 1.5, 'fees', 0, 'receipt_date', '2026-10-23',
  'member_ids', jsonb_build_array(:'milo', :'alex', :'clouey'),
  'meals', jsonb_build_array(jsonb_build_object('id', null, 'key', 'm1', 'name', 'Dinner', 'fee', 2),
                             jsonb_build_object('id', null, 'key', 'm2', 'name', 'Dessert', 'fee', 0)),
  'items', jsonb_build_array(
    jsonb_build_object('id', null, 'name', 'Milk', 'price', 5.49, 'always_split', false, 'position', 0),
    jsonb_build_object('id', null, 'name', 'Bread', 'price', 3, 'always_split', false, 'position', 1),
    jsonb_build_object('id', null, 'name', 'Pasta', 'price', 8, 'always_split', false, 'meal_key', 'm1', 'position', 2),
    jsonb_build_object('id', null, 'name', 'Cake', 'price', 6, 'always_split', false, 'meal_key', 'm2', 'position', 3),
    jsonb_build_object('id', null, 'name', 'Napkins', 'price', 2, 'always_split', true, 'position', 4))
)) as created \gset
select (:'created'::jsonb->>'id')::uuid as rid \gset

select pg_temp.check((select store_name from receipts where id = :'rid') = 'Live Test Store', 'creates the receipt (store name trimmed)');
select pg_temp.check((select created_by from receipts where id = :'rid') = :'milo_user', 'the receipt is stamped as made by whoever saved it');
select pg_temp.check((select string_agg(name, ',' order by position) from items where receipt_id = :'rid') = 'Milk,Bread,Pasta,Cake,Napkins',
  'items keep their order');
select pg_temp.check((select string_agg(name, ',' order by created_at, id) from meals where receipt_id = :'rid') = 'Dinner,Dessert',
  'meals keep their order');
select pg_temp.check((select m.name from items i join meals m on m.id = i.meal_id where i.receipt_id = :'rid' and i.name = 'Pasta') = 'Dinner',
  'an item can go in a new meal (by its key)');
select pg_temp.check((:'created'::jsonb->>'version')::int = (select version from receipts where id = :'rid'), 'returns the current version');
select pg_temp.check((select count(*) from audit_log where row_id = :'rid' and action = 'insert') = 1, 'creating it is in its history');

-- Alex and Clouey check in; Alex has the milk and the cake, Clouey the bread
select pg_temp.act_as(:'alex_user');
insert into claims (item_id, member_id) select id, :'alex' from items where receipt_id = :'rid' and name in ('Milk', 'Cake');
insert into checkins (receipt_id, member_id) values (:'rid', :'alex');
select pg_temp.act_as(:'milo_user');
insert into claims (item_id, member_id) select id, :'clouey' from items where receipt_id = :'rid' and name = 'Bread';
insert into checkins (receipt_id, member_id) values (:'rid', :'clouey'), (:'rid', :'milo');

-- ── Versions ─────────────────────────────────────────────────
select version as v0 from receipts where id = :'rid' \gset
insert into claims (item_id, member_id) select id, :'milo' from items where receipt_id = :'rid' and name = 'Bread';
select pg_temp.check((select version from receipts where id = :'rid') = :v0, 'checking things off does not change the version');
update receipts set category = 'Household' where id = :'rid';
select pg_temp.check((select version from receipts where id = :'rid') = :v0 + 1, 'changing the receipt bumps the version');
update items set price = price where receipt_id = :'rid';
select pg_temp.check((select version from receipts where id = :'rid') = :v0 + 2, 'changing its items bumps it once per statement (not once per item)');
update meals set fee = fee where receipt_id = :'rid';
select pg_temp.check((select version from receipts where id = :'rid') = :v0 + 3, 'so does changing its meals');
select pg_temp.check(not exists (
  select 1 from audit_log where row_id = :'rid' and action = 'update'
    and (old_data - 'version') = (new_data - 'version')), 'version bumps are not in the history');
update receipts set category = 'Groceries' where id = :'rid';

-- Helpers are made by the database owner ("security definer" ones then
-- look past row permissions); the checks go on as Milo afterwards
reset role;
-- The edit helper: the receipt as it is now, with changes
create function pg_temp.current(rid uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'store_name', r.store_name, 'paid_by_member', r.paid_by_member, 'category', r.category,
    'tip', r.tip, 'tax', r.tax, 'fees', r.fees, 'receipt_date', r.receipt_date, 'member_ids', to_jsonb(r.member_ids),
    'meals', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'fee', m.fee) order by m.created_at, m.id), '[]')
              from meals m where m.receipt_id = r.id and m.deleted_at is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'price', i.price, 'always_split', i.always_split,
                                                           'meal', i.meal_id, 'position', i.position) order by i.position), '[]')
              from items i where i.receipt_id = r.id and i.deleted_at is null))
  from receipts r where r.id = rid
$$;
-- Set one field on the item with this name
create function pg_temp.set_item(data jsonb, item text, field text, value jsonb) returns jsonb language sql as $$
  select jsonb_set(data, '{items}', (
    select jsonb_agg(case when e->>'name' = item then jsonb_set(e, array[field], value) else e end order by ord)
    from jsonb_array_elements(data->'items') with ordinality as t(e, ord)))
$$;
create function pg_temp.save(rid uuid, data jsonb) returns jsonb language sql as $$
  select save_receipt((select group_id from receipts where id = rid), rid, (select version from receipts where id = rid), data)
$$;
-- (These two look as the database owner, past the row permissions)
create function pg_temp.checked_in(rid uuid) returns text language sql security definer as $$
  select coalesce(string_agg(g.first_name, ',' order by g.first_name), '') from checkins k join group_members g on g.id = k.member_id where k.receipt_id = rid
$$;
create function pg_temp.notices(rid uuid) returns text language sql security definer as $$
  select coalesce(string_agg(g.first_name || ':' || n.kind || ':' || i.name
    || coalesce(':' || n.old_price || '>' || n.new_price, ''), ',' order by g.first_name, n.kind, i.name), '')
  from receipt_notices n join group_members g on g.id = n.member_id join items i on i.id = n.item_id
  where n.receipt_id = rid and n.seen_at is null
$$;

select pg_temp.act_as(:'milo_user');
select pg_temp.check(pg_temp.checked_in(:'rid') = 'Alex,Clouey,Milo', 'everyone has checked in');

-- ── Out of date ──────────────────────────────────────────────
select version as v1 from receipts where id = :'rid' \gset
select pg_temp.expect_error(format('select save_receipt(%L, %L, %s, %L)', :'gid', :'rid', :v1 - 1,
    pg_temp.set_item(pg_temp.current(:'rid'), 'Milk', 'name', '"Oat milk"')),
  'saving from an older version is refused (someone saved in between)', 'RCPT1');
select pg_temp.check((select count(*) from items where receipt_id = :'rid' and name = 'Oat milk') = 0, '…and nothing was written');
select pg_temp.check((select version from receipts where id = :'rid') = :v1, '…and the version did not move');

-- ── Edits that don't reopen the receipt ──────────────────────
select pg_temp.save(:'rid', pg_temp.set_item(pg_temp.current(:'rid'), 'Bread', 'name', '"Sourdough"'));
select pg_temp.check(pg_temp.checked_in(:'rid') = 'Alex,Clouey,Milo' and pg_temp.notices(:'rid') = '', 'renaming an item does not ask anyone to check in again');
select pg_temp.check(exists (select 1 from audit_log where row_id = (select id from items where receipt_id = :'rid' and name = 'Sourdough')
  and action = 'update' and old_data->>'name' = 'Bread'), 'the rename is in the history');

select pg_temp.save(:'rid', jsonb_set(jsonb_set(pg_temp.current(:'rid'), '{tax}', '3'), '{tip}', '4'));
select pg_temp.check(pg_temp.checked_in(:'rid') = 'Alex,Clouey,Milo' and pg_temp.notices(:'rid') = '', 'changing tax and tip does not either');

select pg_temp.save(:'rid', pg_temp.set_item(pg_temp.current(:'rid'), 'Milk', 'meal', to_jsonb((select id from meals where receipt_id = :'rid' and name = 'Dinner'))));
select pg_temp.check((select m.name from items i join meals m on m.id = i.meal_id where i.receipt_id = :'rid' and i.name = 'Milk') = 'Dinner',
  'an item can be moved into a meal');
select pg_temp.check(pg_temp.checked_in(:'rid') = 'Alex,Clouey,Milo' and pg_temp.notices(:'rid') = '', 'moving items between meals does not either');
select pg_temp.check((select count(*) from claims c join items i on i.id = c.item_id where i.receipt_id = :'rid' and i.name = 'Milk' and c.member_id = :'alex') = 1,
  'check-offs stay on an item that moved');

select pg_temp.save(:'rid', jsonb_set(pg_temp.current(:'rid'), '{store_name}', '"Renamed Store"'));
select pg_temp.check(pg_temp.checked_in(:'rid') = 'Alex,Clouey,Milo', 'renaming the store does not either');

-- ── Price changes tell whoever checked the item off ──────────
select pg_temp.save(:'rid', pg_temp.set_item(pg_temp.current(:'rid'), 'Milk', 'price', '4.99'));
select pg_temp.check(pg_temp.checked_in(:'rid') = 'Alex,Clouey,Milo', 'a price change does not reopen the receipt');
select pg_temp.check(pg_temp.notices(:'rid') = 'Alex:price:Milk:5.49>4.99', 'Alex (who has the milk) is told its price changed, Milo (who changed it) is not');
reset role;
select pg_temp.check((select actor_member from receipt_notices where receipt_id = :'rid' and kind = 'price') = :'milo', 'the notice says who changed it');
select pg_temp.act_as(:'milo_user');
select pg_temp.save(:'rid', pg_temp.set_item(pg_temp.current(:'rid'), 'Milk', 'price', '4.79'));
select pg_temp.check(pg_temp.notices(:'rid') = 'Alex:price:Milk:5.49>4.79', 'changing it again updates the same notice (still from what Alex saw)');
select pg_temp.save(:'rid', pg_temp.set_item(pg_temp.current(:'rid'), 'Milk', 'price', '5.49'));
select pg_temp.check(pg_temp.notices(:'rid') = '', 'changing it back to what Alex saw drops the notice');
select pg_temp.save(:'rid', pg_temp.set_item(pg_temp.current(:'rid'), 'Sourdough', 'price', '3.5'));
select pg_temp.check(pg_temp.notices(:'rid') = 'Clouey:price:Sourdough:3.00>3.50', 'a guest who checked it off gets one too (Milo, who also has it, changed it)');

-- Who can see and dismiss notices
select pg_temp.save(:'rid', pg_temp.set_item(pg_temp.current(:'rid'), 'Cake', 'price', '7'));
reset role;
select id as alex_notice from receipt_notices where receipt_id = :'rid' and member_id = :'alex' and seen_at is null \gset
select pg_temp.act_as(:'milo_user');
select pg_temp.check((select count(*) from receipt_notices where id = :'alex_notice') = 0, 'Milo cannot see Alex''s notices (Alex has an account)');
select pg_temp.check((select count(*) from receipt_notices where receipt_id = :'rid' and member_id = :'clouey') = 1, 'Milo can see a guest''s (he checks off for them)');
select mark_notices_seen(array[:'alex_notice']::uuid[]);
reset role;
select pg_temp.check((select seen_at from receipt_notices where id = :'alex_notice') is null, 'Milo cannot dismiss Alex''s notice');
select pg_temp.act_as(:'alex_user');
select pg_temp.check((select count(*) from receipt_notices where id = :'alex_notice') = 1, 'Alex sees his own notice');
select pg_temp.expect_error(format('update receipt_notices set seen_at = now() where id = %L', :'alex_notice'), 'notices can only be dismissed through mark_notices_seen');
select mark_notices_seen(array[:'alex_notice']::uuid[]);
reset role;
select pg_temp.check((select seen_at from receipt_notices where id = :'alex_notice') is not null, 'Alex can dismiss his own notice');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check((select count(*) from receipt_notices) = 0, 'someone outside the group sees no notices');
select pg_temp.expect_error(format('select save_receipt(%L, %L, 1, %L)', :'gid', :'rid', '{}'), 'someone outside the group cannot save a receipt in it');
set local role anon;
select pg_temp.expect_error(format('select save_receipt(%L, null, null, %L)', :'gid', '{}'), 'a signed-out visitor cannot save receipts');
select pg_temp.expect_error('select mark_notices_seen(null)', 'a signed-out visitor cannot dismiss notices');
reset role;
select pg_temp.act_as(:'milo_user');

-- ── Removing items doesn't reopen it ─────────────────────────
select pg_temp.save(:'rid', jsonb_set(pg_temp.current(:'rid'), '{items}',
  (select jsonb_agg(e) from jsonb_array_elements(pg_temp.current(:'rid')->'items') e where e->>'name' <> 'Sourdough')));
select pg_temp.check((select deleted_at from items where receipt_id = :'rid' and name = 'Sourdough') is not null, 'a removed item is removed (kept, marked deleted)');
select pg_temp.check(pg_temp.checked_in(:'rid') = 'Alex,Clouey,Milo', 'removing an item does not ask anyone to check in again');
select pg_temp.check(pg_temp.notices(:'rid') = '', 'its unread price notice goes with it');

-- ── Adding an item reopens it, and says why ──────────────────
select pg_temp.save(:'rid', jsonb_set(pg_temp.current(:'rid'), '{items}',
  pg_temp.current(:'rid')->'items' || jsonb_build_array(jsonb_build_object('id', null, 'name', 'Eggs', 'price', 4, 'always_split', false, 'position', 9))));
select pg_temp.check(pg_temp.checked_in(:'rid') = 'Milo', 'adding an item asks everyone but the editor to check in again');
select pg_temp.check(pg_temp.notices(:'rid') = 'Alex:added:Eggs,Clouey:added:Eggs', '…and tells them which item was added');
select pg_temp.act_as(:'alex_user');
insert into checkins (receipt_id, member_id) values (:'rid', :'alex');
reset role;
select pg_temp.check((select count(*) from receipt_notices where receipt_id = :'rid' and member_id = :'alex' and kind = 'added' and seen_at is null) = 0,
  'checking in again clears "added" for that person');
select pg_temp.check((select count(*) from receipt_notices where receipt_id = :'rid' and member_id = :'clouey' and kind = 'added' and seen_at is null) = 1,
  '…but not for anyone else');

-- Making an item split by everyone reopens it too
select pg_temp.act_as(:'milo_user');
select pg_temp.save(:'rid', pg_temp.set_item(pg_temp.current(:'rid'), 'Cake', 'always_split', 'true'));
select pg_temp.check(pg_temp.checked_in(:'rid') = 'Milo', 'making an item split by everyone asks everyone to check in again');
select pg_temp.check(pg_temp.notices(:'rid') like '%Alex:shared:Cake%', '…and says which item');

-- An item someone else removed in the meantime comes back as a new item (keep mine)
select id as cake_id from items where receipt_id = :'rid' and name = 'Cake' \gset
select pg_temp.current(:'rid') as stale_copy \gset
update items set deleted_at = now() where id = :'cake_id';
select save_receipt(:'gid', :'rid', (select version from receipts where id = :'rid'), :'stale_copy'::jsonb);
select pg_temp.check((select count(*) from items where receipt_id = :'rid' and name = 'Cake' and deleted_at is null and id <> :'cake_id') = 1,
  'saving an item that was removed meanwhile adds it back as a new item');

-- A meal from another receipt can't be used
select (save_receipt(:'gid', null, null, jsonb_build_object('store_name', 'Other', 'paid_by_member', :'milo', 'receipt_date', '2026-10-20',
  'member_ids', '[]'::jsonb, 'meals', jsonb_build_array(jsonb_build_object('key', 'k', 'name', 'Theirs', 'fee', 0)),
  'items', jsonb_build_array(jsonb_build_object('name', 'X', 'price', 1, 'meal_key', 'k', 'position', 0))))->>'id')::uuid as other_rid \gset
select pg_temp.save(:'rid', pg_temp.set_item(pg_temp.current(:'rid'), 'Eggs', 'meal', to_jsonb((select id from meals where receipt_id = :'other_rid'))));
select pg_temp.check((select meal_id from items where receipt_id = :'rid' and name = 'Eggs' and deleted_at is null) is null, 'an item can''t be put in another receipt''s meal');
select pg_temp.check((select category from receipts where id = :'other_rid') = 'Groceries', 'a receipt saved without a category gets the usual one');

-- Taking someone off the receipt clears their check-offs and check-in
insert into checkins (receipt_id, member_id) values (:'rid', :'clouey') on conflict do nothing;
select pg_temp.save(:'rid', jsonb_set(pg_temp.current(:'rid'), '{member_ids}', jsonb_build_array(:'milo', :'alex')));
select pg_temp.check(not exists (select 1 from claims c join items i on i.id = c.item_id where i.receipt_id = :'rid' and c.member_id = :'clouey'),
  'taking someone off the receipt clears their check-offs');
select pg_temp.check(pg_temp.checked_in(:'rid') not like '%Clouey%', '…and their check-in');

-- ── Guest links ──────────────────────────────────────────────
select pg_temp.save(:'rid', jsonb_set(pg_temp.current(:'rid'), '{member_ids}', jsonb_build_array(:'milo', :'alex', :'clouey')));
select guest_link_create(:'clouey') as token \gset
select pg_temp.save(:'rid', jsonb_set(pg_temp.current(:'rid'), '{items}',
  pg_temp.current(:'rid')->'items' || jsonb_build_array(jsonb_build_object('id', null, 'name', 'Juice', 'price', 3, 'always_split', false, 'position', 10))));
select version as cur_v from receipts where id = :'rid' \gset
set local role anon;
select (select r from jsonb_array_elements(guest_view(:'token')->'receipts') r where r->>'id' = :'rid') as gv \gset
select pg_temp.check((:'gv'::jsonb->>'version')::int = :cur_v, 'the guest page gets each receipt''s version');
select pg_temp.expect_error(format('select guest_save_claims(%L, %L, %L, %s)', :'token', :'rid', '{}', (:'gv'::jsonb->>'version')::int - 1),
  'a guest saving from an out-of-date receipt is refused', 'RCPT1');
select guest_save_claims(:'token', :'rid', array[]::uuid[], (:'gv'::jsonb->>'version')::int);
select guest_save_claims(:'token', :'rid', array[]::uuid[]);
reset role;
select pg_temp.check((select count(*) from checkins where receipt_id = :'rid' and member_id = :'clouey') = 1, 'a guest saving the current version checks in (and so does one without a version)');

-- Added items show on the guest page until they check in
select pg_temp.act_as(:'milo_user');
select pg_temp.save(:'rid', jsonb_set(pg_temp.current(:'rid'), '{items}',
  pg_temp.current(:'rid')->'items' || jsonb_build_array(jsonb_build_object('id', null, 'name', 'Chips', 'price', 2, 'always_split', false, 'position', 11))));
select id as chips from items where receipt_id = :'rid' and name = 'Chips' \gset
set local role anon;
select pg_temp.check((select (r->'added_items') @> to_jsonb(array[:'chips'::uuid])
  from jsonb_array_elements(guest_view(:'token')->'receipts') r where r->>'id' = :'rid'), 'the guest page lists items added since they checked in');
select guest_save_claims(:'token', :'rid', array[]::uuid[]);
select pg_temp.check((select jsonb_array_length(r->'added_items') from jsonb_array_elements(guest_view(:'token')->'receipts') r where r->>'id' = :'rid') = 0,
  '…until they check in again');
reset role;

-- ── Removed from the group ───────────────────────────────────
update group_members set active = false where id = :'alex';
select pg_temp.act_as(:'alex_user');
select pg_temp.check((select count(*) from group_members) = 1 and (select id from group_members) = :'alex',
  'someone removed from the group can read only their own row (so the removal reaches their open app)');
select pg_temp.check((select count(*) from receipts where group_id = :'gid') = 0, '…and none of the group''s receipts');
select pg_temp.check((select count(*) from groups where id = :'gid') = 0, '…nor the group itself');
reset role;
update group_members set active = true where id = :'alex';

-- ── Deleted receipts ─────────────────────────────────────────
select pg_temp.act_as(:'milo_user');
update receipts set deleted_at = now() where id = :'rid';
select pg_temp.expect_error(format('select save_receipt(%L, %L, %s, %L)', :'gid', :'rid', (select version from receipts where id = :'rid'), pg_temp.current(:'rid')),
  'a deleted receipt can''t be saved over', 'RCPT2');
reset role;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
