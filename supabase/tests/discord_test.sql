-- Discord notifications (supabase/migrations/20261116000000_discord_notifications.sql):
-- who can see and change links, what gets queued, and the function's helpers.
-- Runs inside a transaction and rolls back, so it leaves no trace.
--   psql <local-db-url> -v ON_ERROR_STOP=1 -f supabase/tests/discord_test.sql
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

create function pg_temp.expect_error(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok - % (blocked: %)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (statement succeeded)', what;
end $$;

-- What's queued, as "Name:kind" (looked at as the database owner)
create function pg_temp.queued(since bigint) returns text language sql security definer as $$
  select coalesce(string_agg(p.first_name || ':' || o.kind, ',' order by p.first_name, o.kind), '')
  from notification_outbox o join profiles p on p.id = o.user_id
  where o.id > since and o.sent_at is null
$$;
create function pg_temp.mark() returns bigint language sql security definer as $$
  select coalesce(max(id), 0) from notification_outbox
$$;

-- ── Who's who ────────────────────────────────────────────────
select id as milo_user from auth.users where email = 'milo@test.local' \gset
select id as alex_user from auth.users where email = 'alex@test.local' \gset
select id as gid from groups where invite_code = '348U9RQ5' \gset
select id as milo from group_members where group_id = :'gid' and user_id = :'milo_user' \gset
select id as alex from group_members where group_id = :'gid' and user_id = :'alex_user' \gset
select id as clouey from group_members where group_id = :'gid' and first_name = 'Clouey' and user_id is null \gset
select pg_temp.check(:'milo' is not null and :'alex' is not null and :'clouey' is not null, 'test accounts and Clouey (a guest) are in the group');

-- Both connected (only the Edge Function can do this, as the service role)
insert into discord_links (user_id, discord_id, discord_username) values
  (:'milo_user', '1001', 'milo_d'), (:'alex_user', '1002', 'alex_d');

-- ── Your link is yours ───────────────────────────────────────
select pg_temp.act_as(:'milo_user');
select pg_temp.check((select count(*) from discord_links) = 1 and (select discord_username from discord_links) = 'milo_d',
  $m$you see your own link and nobody else's$m$);
update discord_links set notify_payment = true, remind_every_days = 3, remind_hour = 9, time_zone = 'Europe/Paris' where user_id = :'milo_user';
select pg_temp.check((select notify_payment and remind_every_days = 3 and remind_hour = 9 and time_zone = 'Europe/Paris' from discord_links),
  'you can change your own settings');
update discord_links set notify_payment = true where user_id = :'alex_user';
reset role;
select pg_temp.check(not (select notify_payment from discord_links where user_id = :'alex_user'), $m$you can't change someone else's$m$);
select pg_temp.act_as(:'milo_user');
select pg_temp.expect_error($$update discord_links set discord_id = '9999'$$, $m$you can't point your link at another Discord account$m$);
select pg_temp.expect_error($$update discord_links set broken_at = null, last_reminded_at = null$$, $m$you can't change what the bot keeps track of$m$);
select pg_temp.expect_error(format($$insert into discord_links (user_id, discord_id, discord_username) values (%L, '1', 'x')$$, :'milo_user'),
  $m$you can't make a link yourself (only connecting through Discord does)$m$);
select pg_temp.expect_error($$update discord_links set time_zone = 'Mars/Olympus'$$, 'an unknown time zone is refused');
select pg_temp.expect_error($$update discord_links set remind_every_days = 31$$, 'reminders at most every 30 days');
select pg_temp.expect_error($$update discord_links set remind_hour = 24$$, 'the reminder hour is 0 to 23');
select pg_temp.check((select detail from discord_links) = 'everything', 'messages include everything unless you choose less');
update discord_links set detail = 'none';
select pg_temp.check((select detail from discord_links) = 'none', 'you can choose how much messages include');
select pg_temp.expect_error($$update discord_links set detail = 'lots'$$, 'only everything, minimal or none');
update discord_links set detail = 'everything';
select pg_temp.expect_error('delete from discord_links', 'deleting goes through Disconnect (the function), not straight to the table');
reset role;
select pg_temp.check((select count(*) from discord_links) = 2, 'both links are still there');

select pg_temp.act_as(:'milo_user');
select pg_temp.expect_error('select * from notification_outbox', 'nobody signed in can read the outbox');
select pg_temp.expect_error('select discord_claim_due()', $m$nobody signed in can use the function's helpers$m$);
select pg_temp.expect_error('select * from discord_reminders_due()', $m$…or see who's due a reminder$m$);
select pg_temp.expect_error('select discord_wake()', '…or wake the function');
reset role;
update discord_links set notify_payment = false, remind_every_days = 1, remind_hour = 18, time_zone = 'America/Los_Angeles' where user_id = :'milo_user';

-- ── A new receipt ────────────────────────────────────────────
select pg_temp.mark() as m0 \gset
select pg_temp.act_as(:'milo_user');
select (save_receipt(:'gid', null, null, jsonb_build_object(
  'store_name', 'Discord Mart', 'paid_by_member', :'milo', 'tax', 1, 'tip', 0, 'fees', 0,
  'member_ids', jsonb_build_array(:'milo', :'alex', :'clouey'),
  'items', jsonb_build_array(
    jsonb_build_object('id', null, 'name', 'Eggs', 'price', 3.99, 'position', 0),
    jsonb_build_object('id', null, 'name', 'Milk', 'price', 5, 'position', 1)))
)->>'id')::uuid as rid \gset
select pg_temp.check(pg_temp.queued(:m0) = 'Alex:new_receipt',
  'a new receipt pings the others on it who connected Discord, not whoever added it (and not guests)');
reset role;
select pg_temp.check((select actor_member = :'milo' and receipt_id = :'rid' and send_after > now() + interval '50 seconds'
  from notification_outbox where id > :m0), 'it says who added it, and waits a minute before sending');

select pg_temp.mark() as m1 \gset
select pg_temp.act_as(:'milo_user');
select save_receipt(:'gid', null, null, jsonb_build_object(
  'store_name', 'Not Alex', 'paid_by_member', :'milo', 'member_ids', jsonb_build_array(:'milo', :'clouey'),
  'items', jsonb_build_array(jsonb_build_object('id', null, 'name', 'X', 'price', 1, 'position', 0))));
select pg_temp.check(pg_temp.queued(:m1) = '', 'nobody is pinged about a receipt they are not on');

select save_receipt(:'gid', null, null, jsonb_build_object(
  'store_name', 'Alex paid', 'paid_by_member', :'alex', 'member_ids', jsonb_build_array(:'milo', :'clouey'),
  'items', jsonb_build_array(jsonb_build_object('id', null, 'name', 'X', 'price', 1, 'position', 0))));
select pg_temp.check(pg_temp.queued(:m1) = 'Alex:new_receipt', 'the payer is pinged even when not on the member list');

select pg_temp.mark() as m2 \gset
select save_receipt(:'gid', null, null, jsonb_build_object(
  'store_name', 'Everyone', 'paid_by_member', :'milo', 'member_ids', '[]'::jsonb,
  'items', jsonb_build_array(jsonb_build_object('id', null, 'name', 'X', 'price', 1, 'position', 0))));
select pg_temp.check(pg_temp.queued(:m2) = 'Alex:new_receipt', 'an empty member list (everyone) pings everyone connected');

-- Not connected: nothing queued
reset role;
create temp table alex_link as select * from discord_links where user_id = :'alex_user';
delete from discord_links where user_id = :'alex_user';
select pg_temp.mark() as m3 \gset
select pg_temp.act_as(:'milo_user');
select save_receipt(:'gid', null, null, jsonb_build_object(
  'store_name', 'Unlinked', 'paid_by_member', :'milo', 'member_ids', '[]'::jsonb,
  'items', jsonb_build_array(jsonb_build_object('id', null, 'name', 'X', 'price', 1, 'position', 0))));
select pg_temp.check(pg_temp.queued(:m3) = '', 'people without Discord connected get nothing queued');
reset role;
insert into discord_links select * from alex_link;

-- ── Edits before you've opened it ────────────────────────────
reset role;
create function pg_temp.current(rid uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'store_name', r.store_name, 'paid_by_member', r.paid_by_member, 'category', r.category,
    'tip', r.tip, 'tax', r.tax, 'fees', r.fees, 'receipt_date', r.receipt_date, 'member_ids', to_jsonb(r.member_ids),
    'meals', '[]'::jsonb,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'price', i.price, 'always_split', i.always_split,
                                                           'position', i.position) order by i.position), '[]')
              from items i where i.receipt_id = r.id and i.deleted_at is null))
  from receipts r where r.id = rid
$$;
create function pg_temp.set_price(data jsonb, item text, price numeric) returns jsonb language sql as $$
  select jsonb_set(data, '{items}', (
    select jsonb_agg(case when e->>'name' = item then jsonb_set(e, '{price}', to_jsonb(price)) else e end order by ord)
    from jsonb_array_elements(data->'items') with ordinality as t(e, ord)))
$$;
create function pg_temp.save(rid uuid, data jsonb) returns jsonb language sql as $$
  select save_receipt((select group_id from receipts where id = rid), rid, (select version from receipts where id = rid), data)
$$;

-- Alex was pinged about the new receipt but hasn't opened it: edits
-- (an item added, a price up, then both undone) ping nobody. The first
-- ping still stands, and the receipt shows the latest when Alex opens it.
select pg_temp.mark() as m4a \gset
select pg_temp.act_as(:'milo_user');
select pg_temp.save(:'rid', jsonb_set(pg_temp.current(:'rid'), '{items}',
  pg_temp.current(:'rid')->'items' || jsonb_build_array(jsonb_build_object('id', null, 'name', 'Butter', 'price', 4, 'position', 5))));
select pg_temp.save(:'rid', pg_temp.set_price(pg_temp.current(:'rid'), 'Eggs', 5.99));
select pg_temp.check(pg_temp.queued(:m4a) = '', 'editing a receipt Alex has not opened yet sends Alex no second ping');
select pg_temp.save(:'rid', jsonb_set(pg_temp.set_price(pg_temp.current(:'rid'), 'Eggs', 3.99), '{items}',
  (select jsonb_agg(e) from jsonb_array_elements(pg_temp.set_price(pg_temp.current(:'rid'), 'Eggs', 3.99)->'items') e where e->>'name' <> 'Butter')));
reset role;

-- ── Items added after you checked in ─────────────────────────
-- Alex has the eggs and checks in
select pg_temp.act_as(:'alex_user');
insert into claims (item_id, member_id) select id, :'alex' from items where receipt_id = :'rid' and name = 'Eggs';
insert into checkins (receipt_id, member_id) values (:'rid', :'alex');

select pg_temp.mark() as m4 \gset
select pg_temp.act_as(:'milo_user');
select pg_temp.save(:'rid', jsonb_set(pg_temp.current(:'rid'), '{items}',
  pg_temp.current(:'rid')->'items' || jsonb_build_array(jsonb_build_object('id', null, 'name', 'Bread', 'price', 3, 'position', 2))));
select pg_temp.check(pg_temp.queued(:m4) = 'Alex:items_added', 'adding an item after Alex checked in pings Alex (asked to check in again)');

-- ── Prices ───────────────────────────────────────────────────
select pg_temp.mark() as m5 \gset
select pg_temp.save(:'rid', pg_temp.set_price(pg_temp.current(:'rid'), 'Eggs', 3.49));
select pg_temp.check(pg_temp.queued(:m5) = '', 'a price going down on something Alex checked off pings nobody');
select pg_temp.save(:'rid', pg_temp.set_price(pg_temp.current(:'rid'), 'Milk', 9));
select pg_temp.check(pg_temp.queued(:m5) = '', $m$a price going up on something Alex didn't check off pings nobody$m$);

-- Back to what Alex saw (the notice goes), then up
select pg_temp.save(:'rid', pg_temp.set_price(pg_temp.current(:'rid'), 'Eggs', 3.99));
select pg_temp.mark() as m6 \gset
select pg_temp.save(:'rid', pg_temp.set_price(pg_temp.current(:'rid'), 'Eggs', 4.99));
select pg_temp.check(pg_temp.queued(:m6) = 'Alex:price_up', 'a price going up on something Alex checked off pings Alex');
select pg_temp.save(:'rid', pg_temp.set_price(pg_temp.current(:'rid'), 'Eggs', 5.99));
select pg_temp.check(pg_temp.queued(:m6) = 'Alex:price_up', 'going up again before the ping went out is still one ping');
select pg_temp.save(:'rid', pg_temp.set_price(pg_temp.current(:'rid'), 'Eggs', 3.99));
select pg_temp.check(pg_temp.queued(:m6) = '', 'back to the price Alex saw: the ping is dropped (its notice is gone)');

-- ── Payments ─────────────────────────────────────────────────
select pg_temp.mark() as m7 \gset
insert into payments (group_id, from_member, to_member, amount) values (:'gid', :'milo', :'alex', 10);
select pg_temp.check(pg_temp.queued(:m7) = 'Alex:payment', 'a payment Milo records to Alex is queued for Alex (sent only if Alex turned payments on)');
select pg_temp.mark() as m8 \gset
select pg_temp.act_as(:'alex_user');
insert into payments (group_id, from_member, to_member, amount) values (:'gid', :'milo', :'alex', 5);
select pg_temp.check(pg_temp.queued(:m8) = '', 'a payment to Alex that Alex records pings nobody');
insert into payments (group_id, from_member, to_member, amount) values (:'gid', :'alex', :'milo', 5);
select pg_temp.check(pg_temp.queued(:m8) = 'Milo:payment', 'a payment Alex records to Milo is queued for Milo');

-- ── Sending (the function's side, as the service role) ───────
reset role;
set local role service_role;
select pg_temp.check((select count(*) from discord_claim_due()) = 0, 'nothing is sent before its minute is up');
reset role;
update notification_outbox set send_after = now() - interval '1 second' where sent_at is null;
set local role service_role;
create temp table claimed as select * from discord_claim_due();
select pg_temp.check((select count(*) from claimed) > 0 and (select bool_and(attempts = 1 and claimed_at is not null) from claimed),
  'due rows are handed out, marked as taken');
select pg_temp.check((select count(*) from discord_claim_due()) = 0, 'a row is only handed out once');
select discord_finish(array(select id from claimed where kind = 'new_receipt'));
select discord_finish(array(select id from claimed where kind = 'payment'), null, 'turned off');
select discord_finish(array(select id from claimed where kind not in ('new_receipt', 'payment')), 'Discord is down');
select pg_temp.check((select bool_and(sent_at is not null and skip_reason is null) from notification_outbox where id in (select id from claimed where kind = 'new_receipt')),
  'sent rows are done');
select pg_temp.check((select bool_and(sent_at is not null and skip_reason = 'turned off') from notification_outbox where id in (select id from claimed where kind = 'payment')),
  'skipped rows are done, with why');
select pg_temp.check((select bool_and(sent_at is null and last_error = 'Discord is down' and claimed_at is null and send_after > now())
  from notification_outbox where id in (select id from claimed where kind not in ('new_receipt', 'payment'))),
  'failed rows are tried again later');
reset role;

-- A run that died: its rows go out again after five minutes, at most five tries
update notification_outbox set claimed_at = now() - interval '6 minutes', send_after = now() - interval '1 minute'
  where id in (select id from claimed where kind not in ('new_receipt', 'payment'));
set local role service_role;
select pg_temp.check((select count(*) from discord_claim_due()) = (select count(*) from claimed where kind not in ('new_receipt', 'payment')),
  'rows taken by a run that never finished are handed out again');
reset role;
update notification_outbox set attempts = 5, claimed_at = null, send_after = now() - interval '1 minute' where sent_at is null;
set local role service_role;
select pg_temp.check((select count(*) from discord_claim_due()) = 0, 'after five tries a row is given up on');
reset role;

-- ── Reminders ────────────────────────────────────────────────
-- Make it Alex's reminder hour now, and the receipt two days old
update discord_links set remind_hour = extract(hour from now() at time zone 'America/Los_Angeles')::int,
  time_zone = 'America/Los_Angeles', last_reminded_at = null where user_id in (:'alex_user', :'milo_user');
update receipts set created_at = now() - interval '2 days' where id = :'rid';
delete from checkins where receipt_id = :'rid' and member_id = :'alex';

create function pg_temp.reminded(uid uuid, rid uuid) returns boolean language sql as $$
  select exists (select 1 from discord_reminders_due() d, jsonb_array_elements(d.receipts) r
                 where d.user_id = uid and (r->>'id')::uuid = rid)
$$;
select pg_temp.check(pg_temp.reminded(:'alex_user', :'rid'), $m$a receipt Alex hasn't checked in on is in Alex's reminder$m$);
select pg_temp.check((select (r->>'total')::numeric from discord_reminders_due() d, jsonb_array_elements(d.receipts) r
                      where d.user_id = :'alex_user' and (r->>'id')::uuid = :'rid') = 3.99 + 9 + 3 + 1, -- (milk went up to 9 above)
  'with its total (items + tax)');
insert into checkins (receipt_id, member_id) values (:'rid', :'alex');
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), 'once Alex checks in, it is not');
delete from checkins where receipt_id = :'rid' and member_id = :'alex';

update discord_links set last_reminded_at = now() - interval '3 hours' where user_id = :'alex_user';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), 'not again until the next day');
update discord_links set last_reminded_at = now() - interval '23 hours 30 minutes' where user_id = :'alex_user';
select pg_temp.check(pg_temp.reminded(:'alex_user', :'rid'), 'a day later (give or take a few minutes), again');
update discord_links set remind_every_days = 3 where user_id = :'alex_user';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), 'every 3 days: not after one');
update discord_links set remind_every_days = 0, last_reminded_at = null where user_id = :'alex_user';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), 'reminders off: never');
update discord_links set remind_every_days = 1, broken_at = now() where user_id = :'alex_user';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), $m$not when the bot can't DM them$m$);
update discord_links set broken_at = null,
  remind_hour = (extract(hour from now() at time zone 'America/Los_Angeles')::int + 12) % 24 where user_id = :'alex_user';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), $m$not outside Alex's reminder hour$m$);
update discord_links set remind_hour = extract(hour from now() at time zone 'America/Los_Angeles')::int where user_id = :'alex_user';

update receipts set created_at = now() - interval '2 hours' where id = :'rid';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), 'not on its first day (the new-receipt ping covers that)');
update receipts set created_at = now() - interval '61 days' where id = :'rid';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), 'not after 60 days (old ones are history)');
update receipts set created_at = now() - interval '2 days', deleted_at = now() where id = :'rid';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), 'not once deleted');
update receipts set deleted_at = null, member_ids = array[:'milo', :'clouey']::uuid[] where id = :'rid';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), 'not once Alex is off it');
update receipts set member_ids = array[:'milo', :'alex', :'clouey']::uuid[] where id = :'rid';
update group_members set active = false where id = :'alex';
select pg_temp.check(not pg_temp.reminded(:'alex_user', :'rid'), 'not once Alex left the group');
update group_members set active = true where id = :'alex';
select pg_temp.check(pg_temp.reminded(:'alex_user', :'rid'), '(and back again)');

-- ── Waking the function ──────────────────────────────────────
-- Without its address in Vault (a local database), nothing is called
select discord_wake();
select pg_temp.check(true, 'waking without the function set up does nothing and does not fail');
select pg_temp.check(exists (select 1 from cron.job where jobname = 'discord-wake' and schedule = '* * * * *'),
  'pg_cron wakes it every minute');

-- ── Deleting an account ──────────────────────────────────────
select pg_temp.check(
  (select confdeltype from pg_constraint where conname = 'discord_links_user_id_fkey') = 'c'
  and (select confdeltype from pg_constraint where conname = 'notification_outbox_user_id_fkey') = 'c',
  'deleting an account deletes its Discord link and anything queued for it');

select 'ALL CHECKS PASSED' as result;
rollback;
