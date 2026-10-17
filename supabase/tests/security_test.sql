-- Security / RLS checks against a migrated database. Runs inside a
-- transaction and rolls back, so it leaves no trace.
--   psql <local-db-url> -v ON_ERROR_STOP=1 -f supabase/tests/security_test.sql
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

select invite_code as code, id as gid from groups limit 1 \gset
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
select pg_temp.check(count(*) = 40, 'Milo now sees all 40 migrated receipts') from receipts;
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
select pg_temp.check(count(*) >= 3 and count(*) filter (where actor is null and table_name in ('items', 'claims')) = 0,
  'audit log rows cannot be deleted or edited') from audit_log;

-- ── Claims must use people from the same group ───────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$insert into claims (item_id, member_id) values (%L, %L)$$, :'iid', :'stranger_member'),
  'cannot claim with a person from another group');

-- ── Stranger joins Milo's group as a new person ──────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select join_group(%L, %L)$$, :'code', :'milo_member'), 'cannot claim an already-claimed person');
select pg_temp.check(join_group(:'code') = :'gid', 'stranger joins Milo''s group with the code');
select pg_temp.check(count(*) = 40, 'after joining, stranger sees the group''s receipts')
  from receipts where group_id = :'gid';
select pg_temp.check(count(*) = 1, 'Milo''s profile is now visible to the stranger')
  from profiles where id = '00000000-0000-0000-0000-00000000000a';

-- ── Owner rules ──────────────────────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$select leave_group(%L)$$, :'gid'), 'owner cannot leave without transferring ownership');
select id as sm2 from group_members where group_id = :'gid' and user_id = '00000000-0000-0000-0000-00000000000b' \gset
select remove_member(:'sm2');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(count(*) = 0, 'removed member loses access') from receipts where group_id = :'gid';

-- ── Profile name changes flow to group members ───────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update profiles set last_name = 'K' where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select last_name from group_members where id = :'milo_member') = 'K', 'profile rename syncs to group member');

-- ── Secrets are private ──────────────────────────────────────
insert into user_secrets (user_id, gemini_api_key) values ('00000000-0000-0000-0000-00000000000a', 'milo-secret');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(count(*) = 0, 'other users cannot read your Gemini key') from user_secrets;
select pg_temp.expect_error($$insert into user_secrets (user_id, gemini_api_key) values ('00000000-0000-0000-0000-00000000000a', 'x')$$,
  'cannot write someone else''s secrets');

reset role;
select 'ALL CHECKS PASSED' as result;
rollback;
