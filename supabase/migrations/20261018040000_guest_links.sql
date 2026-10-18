-- ─────────────────────────────────────────────────────────────
--  Guest links. Someone without an account (a guest) gets a secret
--  link, /#/guest/<token>, that lets whoever has it check off items
--  for that person, with no login. Signed-out visitors still can't
--  read any table; the link page goes through the two functions below,
--  which check the token and only ever touch that one person's
--  receipts and check-offs.
--
--  - Any group member can make (or replace) a person's link.
--  - A link stops working if the person gets an account (claims their
--    name), leaves, or the link is replaced.
-- ─────────────────────────────────────────────────────────────

alter table public.group_members add column guest_token text unique;

-- Make a new link for someone without an account (replaces any old one)
create function public.guest_link_create(p_member uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  token text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  if not public.is_group_member(public.member_group(p_member)) then
    raise exception 'Not a member of this group';
  end if;
  if exists (select 1 from public.group_members where id = p_member and user_id is not null) then
    raise exception 'This person has an account, so they can sign in instead';
  end if;
  update public.group_members set guest_token = token where id = p_member;
  return token;
end $$;

-- The guest a token belongs to (still without an account and active)
create function public.guest_member(p_token text) returns public.group_members
language sql stable security definer set search_path = '' as $$
  select * from public.group_members
  where guest_token = p_token and length(p_token) >= 32 and user_id is null and active
$$;

-- Everything the link page needs: the guest, their group, and each
-- receipt they're on (not deleted, with items) with its items, meals,
-- everyone's check-offs and check-ins, and the names of the people on it
create function public.guest_view(p_token text) returns jsonb
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
        'paid_by_member', r.paid_by_member, 'member_ids', r.member_ids,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'price', i.price, 'always_split', i.always_split, 'meal_id', i.meal_id)
                    order by i.position nulls last, i.created_at), '[]')
                  from public.items i where i.receipt_id = r.id and i.deleted_at is null),
        'meals', (select coalesce(jsonb_agg(jsonb_build_object('id', ml.id, 'name', ml.name, 'fee', ml.fee) order by ml.created_at), '[]')
                  from public.meals ml where ml.receipt_id = r.id and ml.deleted_at is null),
        'claims', (select coalesce(jsonb_agg(jsonb_build_object('item_id', c.item_id, 'member_id', c.member_id)), '[]')
                   from public.claims c join public.items i on i.id = c.item_id
                   where i.receipt_id = r.id and i.deleted_at is null),
        'checkins', (select coalesce(jsonb_agg(k.member_id), '[]') from public.checkins k where k.receipt_id = r.id)
      ) order by r.receipt_date desc nulls last, r.created_at desc), '[]')
      from public.receipts r
      where r.group_id = g.group_id and r.deleted_at is null
        and (g.id = any(r.member_ids) or r.paid_by_member = g.id)
        and exists (select 1 from public.items i where i.receipt_id = r.id and i.deleted_at is null)
    )
  );
end $$;

-- Save the guest's check-offs on one receipt (exactly p_item_ids) and
-- check them in
create function public.guest_save_claims(p_token text, p_receipt uuid, p_item_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.group_members;
begin
  select * into g from public.guest_member(p_token);
  if g.id is null then raise exception 'This guest link is no longer valid'; end if;
  if not exists (
    select 1 from public.receipts r
    where r.id = p_receipt and r.group_id = g.group_id and r.deleted_at is null
      and (g.id = any(r.member_ids) or r.paid_by_member = g.id)
  ) then
    raise exception 'That receipt is not available on this link';
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

revoke all on function public.guest_link_create(uuid), public.guest_member(text),
  public.guest_view(text), public.guest_save_claims(text, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.guest_link_create(uuid) to authenticated;
-- The link works signed out (anon) and signed in
grant execute on function public.guest_view(text), public.guest_save_claims(text, uuid, uuid[]) to anon, authenticated;
