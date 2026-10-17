-- ─────────────────────────────────────────────────────────────
--  Accounts + groups, step 2 of 3: move the original shared data
--  (from before accounts existed) into a single group.
--  No-op on an empty database.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  gid uuid;
  roster jsonb;
begin
  if not exists (select 1 from public.receipts) and not exists (select 1 from public.trips) then
    return;
  end if;

  -- ── Remove test data ───────────────────────────────────────
  -- Receipts paid by a test user go entirely (items, claims, etc. cascade)
  delete from public.receipts where paid_by ilike 'test%';
  delete from public.claims where roommate ilike 'test%';
  delete from public.checkins where roommate ilike 'test%';
  delete from public.settlements where debtor ilike 'test%' or creditor ilike 'test%';
  update public.receipts set members = array(select m from unnest(members) m where m not ilike 'test%')
    where exists (select 1 from unnest(members) m where m ilike 'test%');
  update public.trips set members = array(select m from unnest(members) m where m not ilike 'test%')
    where exists (select 1 from unnest(members) m where m ilike 'test%');

  -- ── The group ──────────────────────────────────────────────
  insert into public.groups (name) values ('Our Apartment') returning id into gid;

  -- ── One person per distinct name (case-insensitive) ────────
  -- Display spelling: prefer the capitalized variant ("Alex" over "alex").
  -- Guests: anyone not marked core in the old apartment_members roster.
  select value into roster from public.app_settings where key = 'apartment_members';

  create temp table name_map (lname text primary key, member_id uuid not null) on commit drop;

  with all_names as (
    select trim(n) as n from (
      select paid_by as n from public.receipts
      union all select unnest(members) from public.receipts
      union all select unnest(members) from public.trips
      union all select roommate from public.claims
      union all select roommate from public.checkins
      union all select debtor from public.settlements
      union all select creditor from public.settlements
    ) s
    where trim(coalesce(n, '')) <> ''
  ),
  canon as (
    select lower(n) as lname,
           (array_agg(n order by (n = initcap(n)) desc, count_n desc, n))[1] as display
    from (select n, count(*) over (partition by n) as count_n from all_names) x
    group by lower(n)
  ),
  core as (
    select lower(trim(e->>'name')) as lname
    from jsonb_array_elements(coalesce(roster, '[]'::jsonb)) e
    where (e->>'isCore')::boolean
  ),
  inserted as (
    insert into public.group_members (group_id, first_name, role, is_guest)
    select gid,
           c.display,
           -- Milo created the app and becomes owner when he claims his person
           case when c.lname = 'milo' then 'owner' else 'member' end,
           c.lname not in (select lname from core)
    from canon c
    returning id, lower(first_name) as lname
  )
  insert into name_map (lname, member_id) select lname, id from inserted;

  -- ── Rewrite name columns as member ids ─────────────────────
  -- Arrays keep their original order, minus case-duplicates.
  update public.receipts r set
    group_id = gid,
    paid_by_member = (select member_id from name_map where lname = lower(trim(r.paid_by))),
    member_ids = array(
      select nm.member_id
      from unnest(r.members) with ordinality as u(m, ord)
      join name_map nm on nm.lname = lower(trim(u.m))
      group by nm.member_id
      order by min(u.ord)
    );

  update public.trips t set
    group_id = gid,
    member_ids = array(
      select nm.member_id
      from unnest(t.members) with ordinality as u(m, ord)
      join name_map nm on nm.lname = lower(trim(u.m))
      group by nm.member_id
      order by min(u.ord)
    );

  update public.claims c set member_id = nm.member_id
    from name_map nm where nm.lname = lower(trim(c.roommate));

  update public.checkins c set member_id = nm.member_id
    from name_map nm where nm.lname = lower(trim(c.roommate));

  update public.settlements s set
    group_id = gid,
    debtor_member = (select member_id from name_map where lname = lower(trim(s.debtor))),
    creditor_member = (select member_id from name_map where lname = lower(trim(s.creditor)));
end $$;
