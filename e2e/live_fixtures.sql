-- Receipts the live-update browser tests (e2e/live.e2e.mjs) use, in the
-- original group of the UI-testing database: one per test, so they don't
-- disturb each other. Safe to run again: it replaces them.
do $$
declare
  g uuid := (select id from public.groups where invite_code = '348U9RQ5');
  -- The test accounts' people (by account: e2e/app.e2e.mjs adds a second Alex)
  milo uuid := (select id from public.group_members where group_id = g and user_id = (select id from auth.users where email = 'milo@test.local'));
  alex uuid := (select id from public.group_members where group_id = g and user_id = (select id from auth.users where email = 'alex@test.local'));
  clouey uuid := (select id from public.group_members where group_id = g and first_name = 'Clouey');
  r_check uuid := 'e2e10000-0000-4000-8000-000000000001';
  r_reopen uuid := 'e2e10000-0000-4000-8000-000000000002';
  r_edit uuid := 'e2e10000-0000-4000-8000-000000000003';
  r_unclaimed uuid := 'e2e10000-0000-4000-8000-000000000004';
  r_pay uuid := 'e2e10000-0000-4000-8000-000000000005';
  r_guest uuid := 'e2e10000-0000-4000-8000-000000000006';
  r_conflict uuid := 'e2e10000-0000-4000-8000-000000000007';
  r_deleted uuid := 'e2e10000-0000-4000-8000-000000000008';
  r_people uuid := 'e2e10000-0000-4000-8000-000000000009';
  g2 uuid := 'e2e10000-0000-4000-8000-0000000000f2';
  niko uuid := (select id from public.group_members where group_id = g and first_name = 'Niko');
  ids uuid[] := array[r_check, r_reopen, r_edit, r_unclaimed, r_pay, r_guest, r_conflict, r_deleted, r_people];
begin
  perform set_config('app.skip_audit', 'on', true);
  -- Receipts earlier runs made in the app ("Live New Store" and the like),
  -- and everything in Alex's second group
  ids := ids || array(select id from public.receipts where (group_id = g and store_name like 'Live %') or group_id = g2);
  -- Their history from earlier runs (same ids each time)
  delete from public.audit_log where row_id = any(ids)
    or (new_data->>'receipt_id')::uuid = any(ids) or (old_data->>'receipt_id')::uuid = any(ids)
    or row_id in (select id from public.items where receipt_id = any(ids));
  delete from public.receipt_notices where receipt_id = any(ids);
  delete from public.payments where receipt_id = any(ids);
  delete from public.payments where group_id = g and note = 'Live test';
  delete from public.checkins where receipt_id = any(ids);
  delete from public.item_dismissals where item_id in (select id from public.items where receipt_id = any(ids));
  delete from public.claims where item_id in (select id from public.items where receipt_id = any(ids));
  delete from public.items where receipt_id = any(ids);
  delete from public.meals where receipt_id = any(ids);
  delete from public.receipts where id = any(ids);
  -- Alex back in the group (the last test takes him out and puts him back)
  update public.group_members set active = true where id = alex;

  -- Check-offs: nobody has checked in yet
  insert into public.receipts (id, group_id, store_name, receipt_date, paid_by_member, member_ids)
    values (r_check, g, 'Live Check', '2026-10-20', milo, array[milo, alex]);
  insert into public.items (receipt_id, name, price, position) values
    (r_check, 'Apples', 3, 0), (r_check, 'Bananas', 2, 1), (r_check, 'Cherries', 5, 2);

  -- Reopening: both checked in; Alex has the milk
  insert into public.receipts (id, group_id, store_name, receipt_date, paid_by_member, member_ids, tax)
    values (r_reopen, g, 'Live Reopen', '2026-10-19', milo, array[milo, alex], 1);
  insert into public.items (receipt_id, name, price, position) values
    (r_reopen, 'Milk', 5.49, 0), (r_reopen, 'Bread', 3, 1), (r_reopen, 'Butter', 4, 2);
  insert into public.claims (item_id, member_id) select id, alex from public.items where receipt_id = r_reopen and name = 'Milk';
  insert into public.claims (item_id, member_id) select id, milo from public.items where receipt_id = r_reopen and name in ('Bread', 'Butter');
  insert into public.checkins (receipt_id, member_id) values (r_reopen, milo), (r_reopen, alex);

  -- Editing at the same time
  insert into public.receipts (id, group_id, store_name, receipt_date, paid_by_member, member_ids)
    values (r_edit, g, 'Live Edit', '2026-10-18', milo, array[milo, alex]);
  insert into public.items (receipt_id, name, price, position) values
    (r_edit, 'Oranges', 4, 0), (r_edit, 'Pears', 6, 1);
  insert into public.receipts (id, group_id, store_name, receipt_date, paid_by_member, member_ids)
    values (r_conflict, g, 'Live Conflict', '2026-10-17', milo, array[milo, alex]);
  insert into public.items (receipt_id, name, price, position) values
    (r_conflict, 'Grapes', 4, 0), (r_conflict, 'Kiwis', 6, 1);
  insert into public.receipts (id, group_id, store_name, receipt_date, paid_by_member, member_ids)
    values (r_deleted, g, 'Live Deleted', '2026-10-16', milo, array[milo, alex]);
  insert into public.items (receipt_id, name, price, position) values (r_deleted, 'Lemons', 2, 0);

  -- Finished, with an item nobody claimed
  insert into public.receipts (id, group_id, store_name, receipt_date, paid_by_member, member_ids, splits_unclaimed)
    values (r_unclaimed, g, 'Live Unclaimed', '2026-10-21', milo, array[milo, alex], true);
  insert into public.items (receipt_id, name, price, position) values
    (r_unclaimed, 'Mystery Jam', 7, 0), (r_unclaimed, 'Toast', 2, 1);
  insert into public.claims (item_id, member_id) select id, milo from public.items where receipt_id = r_unclaimed and name = 'Toast';
  insert into public.checkins (receipt_id, member_id) values (r_unclaimed, milo), (r_unclaimed, alex);

  -- Alex owes Milo $11 for the pizza
  insert into public.receipts (id, group_id, store_name, receipt_date, paid_by_member, member_ids)
    values (r_pay, g, 'Live Pay', '2026-10-15', milo, array[milo, alex]);
  insert into public.items (receipt_id, name, price, position) values (r_pay, 'Big Pizza', 11, 0);
  insert into public.claims (item_id, member_id) select id, alex from public.items where receipt_id = r_pay;
  insert into public.checkins (receipt_id, member_id) values (r_pay, milo), (r_pay, alex);

  -- Clouey (a guest) checks off by link
  insert into public.receipts (id, group_id, store_name, receipt_date, paid_by_member, member_ids)
    values (r_guest, g, 'Live Guest', '2026-10-14', milo, array[milo, clouey]);
  insert into public.items (receipt_id, name, price, position) values (r_guest, 'Soup', 6, 0), (r_guest, 'Salad', 5, 1);
  update public.group_members set guest_token = 'e2e0live0guest0token0000000000000000' where id = clouey;

  -- Taking someone off a receipt: Alex has the tea
  insert into public.receipts (id, group_id, store_name, receipt_date, paid_by_member, member_ids)
    values (r_people, g, 'Live People', '2026-10-13', milo, array[milo, alex, niko]);
  insert into public.items (receipt_id, name, price, position) values (r_people, 'Tea', 3, 0), (r_people, 'Coffee', 4, 1);
  insert into public.claims (item_id, member_id) select id, alex from public.items where receipt_id = r_people and name = 'Tea';
  insert into public.checkins (receipt_id, member_id) values (r_people, alex);

  -- Alex's second group, from an earlier run (the test makes it when it
  -- needs it: with it there, Alex's app would open it first)
  delete from public.group_members where group_id = g2;
  delete from public.groups where id = g2;
  delete from public.audit_log where group_id = g2;
  perform set_config('app.skip_audit', 'off', true);
end $$;
