-- Receipts the browser tests (e2e/app.e2e.mjs) use, in the original group
-- of the UI-testing database. Safe to run again: it replaces them.
do $$
declare
  g uuid := (select id from public.groups where invite_code = '348U9RQ5');
  milo uuid := (select id from public.group_members where group_id = g and first_name = 'Milo');
  alex uuid := (select id from public.group_members where group_id = g and first_name = 'Alex');
  clouey uuid := (select id from public.group_members where group_id = g and first_name = 'Clouey');
  niko uuid := (select id from public.group_members where group_id = g and first_name = 'Niko');
  diner uuid := 'e2e00000-0000-4000-8000-000000000001';
  market uuid := 'e2e00000-0000-4000-8000-000000000002';
  corner uuid := 'e2e00000-0000-4000-8000-000000000003';
  pizza uuid := 'e2e00000-0000-4000-8000-0000000000a1';
  wings uuid := 'e2e00000-0000-4000-8000-0000000000a2';
begin
  perform set_config('app.skip_audit', 'on', true);
  delete from public.payments where receipt_id in (diner, market, corner);
  delete from public.checkins where receipt_id in (diner, market, corner);
  delete from public.claims where item_id in (select id from public.items where receipt_id in (diner, market, corner));
  delete from public.items where receipt_id in (diner, market, corner);
  delete from public.meals where receipt_id in (diner, market, corner);
  delete from public.receipts where id in (diner, market, corner);

  -- A restaurant bill, items typed in mixed order: a Pizza item, a drink
  -- with no meal, Wings, then another Pizza item. Waiting on Alex and Clouey.
  insert into public.receipts (id, group_id, store_name, category, receipt_date, paid_by_member, member_ids, tax)
    values (diner, g, 'E2E Diner', 'Dining', '2026-10-10', milo, array[milo, alex, clouey], 2);
  insert into public.meals (id, receipt_id, name, fee) values (pizza, diner, 'Pizza', 1), (wings, diner, 'Wings', 0);
  insert into public.items (receipt_id, name, price, meal_id, position) values
    (diner, 'Pizza slice', 6, pizza, 0),
    (diner, 'Soda', 2, null, 1),
    (diner, 'Wings basket', 9, wings, 2),
    (diner, 'Garlic knots', 4, pizza, 3);
  insert into public.claims (item_id, member_id) select id, milo from public.items where receipt_id = diner and name = 'Pizza slice';
  insert into public.checkins (receipt_id, member_id) values (diner, milo);

  -- Niko paid; Milo had the bread. Everyone has checked in. (Milo already
  -- owes Niko, so this debt stays open: with Alex it would net to paid.)
  insert into public.receipts (id, group_id, store_name, category, receipt_date, paid_by_member, member_ids)
    values (market, g, 'E2E Market', 'Groceries', '2026-10-11', niko, array[niko, milo]);
  insert into public.items (receipt_id, name, price, position) values (market, 'Bread', 4, 0);
  insert into public.claims (item_id, member_id) select id, milo from public.items where receipt_id = market;
  insert into public.checkins (receipt_id, member_id) values (market, niko), (market, milo);

  -- Milo paid; Alex had the snack. Everyone has checked in. (Deleted and
  -- restored by the tests.)
  insert into public.receipts (id, group_id, store_name, category, receipt_date, paid_by_member, member_ids)
    values (corner, g, 'E2E Corner', 'Groceries', '2026-10-12', milo, array[milo, alex]);
  insert into public.items (receipt_id, name, price, position) values (corner, 'Snack', 3, 0);
  insert into public.claims (item_id, member_id) select id, alex from public.items where receipt_id = corner;
  insert into public.checkins (receipt_id, member_id) values (corner, milo), (corner, alex);
  perform set_config('app.skip_audit', 'off', true);
end $$;
