-- LOCAL ONLY: confirmed test accounts for the dev "Test accounts" panel
-- (double-click the version number on the sign-in page in `npm run dev`).
-- Password for all: test1234. Run via scripts/local-db-reset.sh, which
-- passes -v local_ok=1; without it this file refuses to do anything.
\if :{?local_ok}
\else
  \echo 'Refusing to seed: run through scripts/local-db-reset.sh (local database only).'
  \quit
\endif

do $$
declare
  acct record;
  uid uuid;
begin
  for acct in
    select * from (values
      ('milo@test.local', 'Milo', 'Kesteloot', 'Milo'),
      ('alex@test.local', 'Alex', 'Test', 'Alex'),
      ('newbie@test.local', 'Newbie', 'Test', null)
    ) as t(email, first_name, last_name, claim)
  loop
    select id into uid from auth.users where email = acct.email;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', acct.email,
        extensions.crypt('test1234', extensions.gen_salt('bf')), now(),
        '{"provider": "email", "providers": ["email"]}',
        jsonb_build_object('first_name', acct.first_name, 'last_name', acct.last_name),
        now(), now(), '', '', '', ''
      );
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, 'email',
              jsonb_build_object('sub', uid::text, 'email', acct.email, 'email_verified', true), now(), now(), now());
    end if;

    -- Link to the person with that first name in the original group. Local
    -- copies of production have real accounts linked; the test account takes over.
    if acct.claim is not null then
      update public.group_members
        set user_id = uid, last_name = acct.last_name, is_guest = false, active = true
        where first_name = acct.claim and user_id is distinct from uid
          and group_id = (select id from public.groups order by created_at limit 1);
    end if;
  end loop;
end $$;

-- A receipt Milo paid, mostly bought for Alex and Nicolas, so the Milo test
-- account is owed money as well as owing it (the copied history only has
-- Milo owing). Fixed ids, so re-running doesn't add it twice. Skipped if the
-- group doesn't have these people.
do $$
declare
  g uuid := (select id from public.groups order by created_at limit 1);
  milo uuid; alex uuid; nicolas uuid; milo_user uuid;
  r uuid := 'ad000000-0000-4000-8000-000000000001';
begin
  select id, user_id into milo, milo_user from public.group_members where group_id = g and first_name = 'Milo';
  select id into alex from public.group_members where group_id = g and first_name = 'Alex';
  select id into nicolas from public.group_members where group_id = g and first_name = 'Nicolas';
  if milo is null or alex is null or nicolas is null then return; end if;
  if exists (select 1 from public.receipts where id = r) then return; end if;

  insert into public.receipts (id, group_id, store_name, category, receipt_date, paid_by_member, member_ids, tax, created_by)
  values (r, g, 'Whole Foods', 'Groceries', current_date - 2, milo, array[milo, alex, nicolas], 3.12, milo_user);

  insert into public.items (id, receipt_id, name, price, always_split, position, created_by) values
    ('ad000000-0000-4000-8000-000000000011', r, 'Olive Oil', 12.99, false, 0, milo_user),
    ('ad000000-0000-4000-8000-000000000012', r, 'Coffee Beans', 15.49, false, 1, milo_user),
    ('ad000000-0000-4000-8000-000000000013', r, 'Salmon Fillets', 18.75, false, 2, milo_user),
    ('ad000000-0000-4000-8000-000000000014', r, 'Paper Towels', 9.99, true, 3, milo_user),
    ('ad000000-0000-4000-8000-000000000015', r, 'Sparkling Water', 6.49, false, 4, milo_user);

  insert into public.claims (item_id, member_id) values
    ('ad000000-0000-4000-8000-000000000011', alex),
    ('ad000000-0000-4000-8000-000000000012', alex),
    ('ad000000-0000-4000-8000-000000000013', nicolas),
    ('ad000000-0000-4000-8000-000000000014', milo),
    ('ad000000-0000-4000-8000-000000000014', alex),
    ('ad000000-0000-4000-8000-000000000014', nicolas),
    ('ad000000-0000-4000-8000-000000000015', milo);

  insert into public.checkins (receipt_id, member_id) values (r, milo), (r, alex), (r, nicolas);
end $$;
