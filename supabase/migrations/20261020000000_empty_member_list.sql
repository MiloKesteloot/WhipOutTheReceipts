-- ─────────────────────────────────────────────────────────────
--  A receipt with no member list is everyone's (the app counts it
--  for everyone in the group). on_item_receipt treated it as only
--  the payer's, so "claims remove" let any member delete anyone's
--  check-offs on such a receipt, including people with an account.
-- ─────────────────────────────────────────────────────────────

create or replace function public.on_item_receipt(iid uuid, mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i join public.receipts r on r.id = i.receipt_id
    where i.id = iid
      and (coalesce(array_length(r.member_ids, 1), 0) = 0 or mid = any(r.member_ids) or r.paid_by_member = mid)
  )
$$;
