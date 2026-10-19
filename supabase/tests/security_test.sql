-- Security / RLS checks against a migrated database. Runs inside a
-- transaction and rolls back, so it leaves no trace.
--   psql <local-db-url> -v ON_ERROR_STOP=1 -f supabase/tests/security_test.sql
-- Needs a database loaded from a production backup (scripts/local-db-reset.sh,
-- or `npm run ui:reset`): it expects the original group with its 8 people,
-- including "Milo" and "Alex". It won't run on an empty database.
-- Each check raises on failure; reaching "ALL CHECKS PASSED" means success.

begin;

-- Test helpers (live only inside this transaction)
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

-- Expect a statement to error
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

-- ── Two users sign up ────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'milo@example.com',
   '{"first_name": "Milo", "last_name": "Kesteloot"}'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger@example.com',
   '{"full_name": "Sam Stranger"}');

select pg_temp.check((select first_name || ' ' || last_name from profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Milo Kesteloot',
  'email signup creates profile from first/last name');
select pg_temp.check((select first_name || '|' || last_name from profiles where id = '00000000-0000-0000-0000-00000000000b') = 'Sam|Stranger',
  'Google-style full_name is split into first/last');

-- Local copies may have test accounts linked; start from unclaimed people
update group_members set user_id = null where user_id is not null;
select invite_code as code, id as gid from groups order by created_at limit 1 \gset
select count(*) as receipt_count from receipts where group_id = :'gid' \gset
select id as milo_member from group_members where first_name = 'Milo' \gset

-- ── Signed-out visitor ───────────────────────────────────────
set local role anon;
select pg_temp.expect_error('select count(*) from receipts', 'signed-out visitor cannot read receipts');
select pg_temp.expect_error('select count(*) from group_members', 'signed-out visitor cannot read members');
select pg_temp.expect_error($$select join_group('x')$$, 'signed-out visitor cannot call join_group');
reset role;

-- ── Milo joins the original group as "Milo" ──────────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(count(*) = 0, 'before joining, Milo sees no receipts') from receipts;
select pg_temp.check((invite_preview(:'code')->'unclaimed') @> jsonb_build_array(jsonb_build_object('first_name', 'Milo')),
  'invite preview lists unclaimed "Milo"');
select pg_temp.check(join_group(lower(:'code'), :'milo_member') = :'gid', 'Milo claims his person (code is case-insensitive)');
select pg_temp.check((select user_id from group_members where id = :'milo_member') = '00000000-0000-0000-0000-00000000000a',
  'Milo is linked to the migrated person');
select pg_temp.check((select role from group_members where id = :'milo_member') = 'owner', 'Milo is the owner');
select pg_temp.check((select last_name from group_members where id = :'milo_member') = 'Kesteloot', 'claiming fills in last name from profile');
select pg_temp.check(count(*) = :receipt_count, 'Milo now sees all the group''s receipts') from receipts;
select pg_temp.check(count(*) = 8, 'Milo sees all 8 people') from group_members;

-- ── Stranger: isolated, own group ────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(count(*) = 0, 'stranger sees no receipts') from receipts;
select pg_temp.check(count(*) = 0, 'stranger sees no items') from items;
select pg_temp.check(count(*) = 0, 'stranger sees no claims') from claims;
select pg_temp.check(count(*) = 0, 'stranger sees no members') from group_members;
select pg_temp.check(count(*) = 0, 'stranger sees no groups') from groups;
select pg_temp.check(count(*) = 1, 'stranger sees only own profile') from profiles;
select create_group('Stranger House') as sgid \gset
select id as stranger_member from group_members where group_id = :'sgid' \gset
select pg_temp.check(count(*) = 1, 'stranger sees own new group') from groups;

select pg_temp.expect_error(format($$insert into receipts (group_id, store_name, paid_by_member) values (%L, 'Hack', %L)$$, :'gid', :'stranger_member'),
  'stranger cannot add receipt to Milo''s group');
select pg_temp.expect_error(format($$insert into receipts (group_id, store_name, paid_by_member) values (%L, 'Mixed', %L)$$, :'sgid', :'milo_member'),
  'cannot pay a receipt with someone from another group');
select pg_temp.expect_error(format($$insert into group_members (group_id, first_name) values (%L, 'Spy')$$, :'gid'),
  'stranger cannot add people to Milo''s group');
select pg_temp.expect_error(format($$insert into group_members (group_id, first_name, user_id) values (%L, 'Me2', %L)$$, :'sgid', '00000000-0000-0000-0000-00000000000b'),
  'cannot set user_id directly when adding a person');
select pg_temp.expect_error(format($$update group_members set role = 'owner' where id = %L$$, :'stranger_member'),
  'cannot change roles directly');
select pg_temp.expect_error(format($$select regenerate_invite(%L)$$, :'gid'), 'stranger cannot regenerate Milo''s invite');
update receipts set store_name = 'Hacked' where group_id = :'gid';
reset role;
select pg_temp.check(count(*) = 0, 'stranger update of Milo''s receipts changed nothing') from receipts where store_name = 'Hacked';

-- ── Milo cannot see the stranger's group ─────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(count(*) = 1, 'Milo sees only his own group') from groups;

-- ── Edits are audited; no hard deletes; log is read-only ─────
select id as rid from receipts order by receipt_date desc nulls last limit 1 \gset
insert into items (receipt_id, name, price) values (:'rid', 'Audit Test Bao', 4.99) returning id as iid \gset
insert into claims (item_id, member_id) values (:'iid', :'milo_member');
select pg_temp.check(count(*) = 1, 'item insert was logged with Milo as actor')
  from audit_log where table_name = 'items' and row_id = :'iid' and action = 'insert' and actor = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check(count(*) = 1, 'claim insert was logged')
  from audit_log where table_name = 'claims' and action = 'insert' and new_data->>'item_id' = :'iid';

delete from items where id = :'iid';
reset role;
select pg_temp.check(count(*) = 1, 'hard delete of an item does nothing (soft delete only)') from items where id = :'iid';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update items set deleted_at = now() where id = :'iid';
select pg_temp.check(count(*) = 1, 'soft delete is logged with old and new values')
  from audit_log where table_name = 'items' and row_id = :'iid' and action = 'update'
   and old_data->>'deleted_at' is null and new_data->>'deleted_at' is not null;

select pg_temp.expect_error($$insert into audit_log (table_name, action) values ('items', 'insert')$$, 'cannot write to the audit log');
select pg_temp.expect_error('delete from audit_log', 'cannot delete from the audit log');
select pg_temp.expect_error('update audit_log set actor = null', 'cannot edit the audit log');
reset role;
-- Only this test's rows (created_at = now() within this transaction): real
-- data has actor-less rows from guest links, which is expected
select pg_temp.check(count(*) >= 3 and count(*) filter (where actor is null and table_name in ('items', 'claims')) = 0,
  'audit log rows cannot be deleted or edited') from audit_log where created_at = now();

-- ── Claims must use people from the same group ───────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$insert into claims (item_id, member_id) values (%L, %L)$$, :'iid', :'stranger_member'),
  'cannot claim with a person from another group');

-- ── Stranger joins Milo's group as a new person ──────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select join_group(%L, %L)$$, :'code', :'milo_member'), 'cannot claim an already-claimed person');
select pg_temp.check(join_group(:'code') = :'gid', 'stranger joins Milo''s group with the code');
select pg_temp.check(count(*) = :receipt_count, 'after joining, stranger sees the group''s receipts')
  from receipts where group_id = :'gid';
select pg_temp.check(count(*) = 1, 'Milo''s profile is now visible to the stranger')
  from profiles where id = '00000000-0000-0000-0000-00000000000a';

-- ── Payments ─────────────────────────────────────────────────
select id as alex_member from group_members where group_id = :'gid' and first_name = 'Alex' \gset
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into payments (group_id, from_member, to_member, amount) values (:'gid', :'milo_member', :'alex_member', 12.34) returning id as pay_id \gset
select pg_temp.check(count(*) = 1, 'payment insert was logged') from audit_log where table_name = 'payments' and row_id = :'pay_id';
select pg_temp.expect_error(format($$delete from payments where id = %L$$, :'pay_id'), 'payments cannot be hard-deleted');
update payments set deleted_at = now() where id = :'pay_id';
select pg_temp.check(count(*) = 1, 'payment soft delete is logged')
  from audit_log where table_name = 'payments' and row_id = :'pay_id' and action = 'update';
select pg_temp.expect_error(format($$insert into payments (group_id, from_member, to_member, amount, imported_from_settlement) values (%L, %L, %L, 1, gen_random_uuid())$$, :'gid', :'milo_member', :'alex_member'),
  'cannot fake an imported payment');
select pg_temp.expect_error(format($$insert into payments (group_id, from_member, to_member, amount) values (%L, %L, %L, 1)$$, :'gid', :'milo_member', :'milo_member'),
  'cannot pay yourself');
select pg_temp.expect_error(format($$insert into payments (group_id, from_member, to_member, amount) values (%L, %L, %L, -5)$$, :'gid', :'milo_member', :'alex_member'),
  'payment amount must be positive');
select pg_temp.expect_error($$insert into settlements (group_id, debtor_member, creditor_member) select group_id, debtor_member, creditor_member from settlements limit 1$$,
  'old settlements are read-only');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$insert into payments (group_id, from_member, to_member, amount) values (%L, %L, %L, 5)$$, :'gid', :'stranger_member', :'alex_member'),
  'a payment cannot involve someone from another group');

-- ── Owner rules ──────────────────────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$select leave_group(%L)$$, :'gid'), 'owner cannot leave without transferring ownership');
select id as sm2 from group_members where group_id = :'gid' and user_id = '00000000-0000-0000-0000-00000000000b' \gset
select remove_member(:'sm2');
select invite_code as gcode from groups where id = :'gid' \gset
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(count(*) = 0, 'removed member loses access') from receipts where group_id = :'gid';
select join_group(:'gcode');
select pg_temp.check(count(*) > 0, 'removed member can rejoin with the invite') from receipts where group_id = :'gid';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select remove_member(:'sm2', true);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select join_group(%L)$$, :'gcode'), 'banned member cannot rejoin with the invite');
select pg_temp.expect_error(format($$select unban_member(%L)$$, :'sm2'), 'banned member cannot unban themselves');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select unban_member(:'sm2');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select join_group(:'gcode');
select pg_temp.check(count(*) > 0, 'unbanned member can rejoin with the invite') from receipts where group_id = :'gid';

-- ── Profile name changes flow to group members ───────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update profiles set last_name = 'K' where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select last_name from group_members where id = :'milo_member') = 'K', 'profile rename syncs to group member');

-- ── Review fixes (20261018070000_hardening) ──────────────────
set local role anon;
select pg_temp.expect_error(format($$select member_group(%L)$$, :'milo_member'), 'signed-out visitor cannot call policy helpers');
reset role;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'casey@example.com',
   '{"first_name": "Casey", "last_name": "Cole"}');

-- Guest links die once the person has an account, even if it's unlinked later
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select invite_code as scode from groups where id = :'sgid' \gset
insert into group_members (group_id, first_name) values (:'sgid', 'Gus') returning id as gus \gset
select guest_link_create(:'gus') as gtoken \gset
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select join_group(:'scode', :'gus');
reset role;
select pg_temp.check((select guest_token from group_members where id = :'gus') is null, 'a guest link is cleared once the person has an account');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select unlink_member(:'gus');
select pg_temp.check(guest_view(:'gtoken') is null, 'an old guest link stays dead after the account is unlinked');

-- Merging the owner's own person into a guest keeps the group owned
insert into group_members (group_id, first_name) values (:'sgid', 'Bee') returning id as bee \gset
select merge_members(:'stranger_member', :'bee');
reset role;
select pg_temp.check((select role = 'owner' and active and user_id = '00000000-0000-0000-0000-00000000000b' from group_members where id = :'bee'),
  'merging the owner into a guest moves the owner role with the account');
select pg_temp.check((select role = 'member' and user_id is null from group_members where id = :'stranger_member'),
  'the merged-away person is no longer an owner');

-- The last account holder can leave; the next person to join becomes owner
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select leave_group(:'sgid');
select pg_temp.check((invite_preview(:'scode')->>'rejoining')::boolean, 'the join page knows someone who left is rejoining');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
-- Casey's unlinked person (named Casey Cole) is still there: joining as someone
-- new would clash, so Casey claims it, like "I'm Casey" on the join page
select pg_temp.check(invite_preview(:'scode')->'name_clash'->>'kind' = 'same_name', 'rejoining under your old unlinked name is a clash');
select join_group(:'scode', :'gus');
reset role;
select id as casey from group_members where group_id = :'sgid' and user_id = '00000000-0000-0000-0000-00000000000c' \gset
select pg_temp.check((select role from group_members where id = :'casey') = 'owner', 'a group left without an owner gets the next person who joins as owner');

-- Receipts with someone who left can still be finished
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
insert into receipts (group_id, store_name, paid_by_member, member_ids, receipt_date)
  values (:'sgid', 'Corner store', :'casey', array[:'casey', :'bee']::uuid[], current_date) returning id as test_receipt \gset
insert into items (receipt_id, name, price) values (:'test_receipt', 'Milk', 4);
insert into checkins (receipt_id, member_id) values (:'test_receipt', :'bee');
select pg_temp.check(count(*) = 1, 'anyone can check in for someone who left the group')
  from checkins where receipt_id = :'test_receipt' and member_id = :'bee';
update receipts set created_by = null where id = :'test_receipt';
reset role;
select pg_temp.check((select created_by from receipts where id = :'test_receipt') = '00000000-0000-0000-0000-00000000000c',
  'created_by cannot be cleared by an edit');

-- Deleting an account
select count(*) as audit_before from audit_log where table_name in ('receipts', 'items') \gset
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select delete_my_account();
reset role;
select pg_temp.check((select created_by from receipts where id = :'test_receipt') is null, 'deleting an account clears created_by');
select pg_temp.check(count(*) = :audit_before, 'deleting an account isn''t logged as edits to everything it created')
  from audit_log where table_name in ('receipts', 'items');
select pg_temp.check((select not active from group_members where id = :'casey'), 'a deleted account''s person leaves the group, so nobody can claim it');

-- ── Joining needs a name the group can tell apart (20261018080000) ──
-- (Milo's member is "Milo K" by now: see the profile rename check above)
reset role;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'milo2@example.com',
   '{"first_name": "milo"}');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.check(invite_preview(:'code')->'name_clash'->>'kind' = 'needs_last', 'joining with a taken first name and no last name asks for one');
select pg_temp.expect_error(format($$select join_group(%L)$$, :'code'), 'join_group refuses a name the group can''t tell apart');
update profiles set last_name = 'k' where id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check(invite_preview(:'code')->'name_clash'->>'kind' = 'same_name', 'the exact same full name is also refused');
update profiles set last_name = 'Moore' where id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check(invite_preview(:'code')->'name_clash' = 'null'::jsonb, 'a different last name is enough');
select pg_temp.check(join_group(:'code') = :'gid', 'and then joining works');

-- ── Secrets are private ──────────────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into user_secrets (user_id, gemini_api_key) values ('00000000-0000-0000-0000-00000000000a', 'milo-secret');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(count(*) = 0, 'other users cannot read your Gemini key') from user_secrets;
select pg_temp.expect_error($$insert into user_secrets (user_id, gemini_api_key) values ('00000000-0000-0000-0000-00000000000a', 'x')$$,
  'cannot write someone else''s secrets');

reset role;
select 'ALL CHECKS PASSED' as result;
rollback;
