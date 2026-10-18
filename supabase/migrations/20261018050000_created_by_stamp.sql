-- ─────────────────────────────────────────────────────────────
--  "Created by" (who entered something into the app) is always the
--  signed-in person: the database sets it on insert, whatever the app
--  sent, and it can't be changed to someone else afterwards. (Who
--  *paid* for a receipt, paid_by_member, is unaffected: anyone in the
--  group can be picked.)
--
--  - Server-side scripts (no signed-in user, e.g. the screenshot
--    seeder) can still set it, to back-date demo data.
--  - It can still become null: deleting an account clears it.
--  - Payments' imported_from_settlement is likewise fixed once set.
-- ─────────────────────────────────────────────────────────────
create function public.stamp_created_by() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    if new.created_by is not null and new.created_by is distinct from old.created_by then
      new.created_by := old.created_by;
    end if;
    if tg_table_name = 'payments' then
      new.imported_from_settlement := old.imported_from_settlement;
    end if;
  end if;
  return new;
end $$;

create trigger stamp_created_by before insert or update on public.receipts
  for each row execute function public.stamp_created_by();
create trigger stamp_created_by before insert or update on public.items
  for each row execute function public.stamp_created_by();
create trigger stamp_created_by before insert or update on public.meals
  for each row execute function public.stamp_created_by();
create trigger stamp_created_by before insert or update on public.payments
  for each row execute function public.stamp_created_by();
create trigger stamp_created_by before insert or update on public.groups
  for each row execute function public.stamp_created_by();
