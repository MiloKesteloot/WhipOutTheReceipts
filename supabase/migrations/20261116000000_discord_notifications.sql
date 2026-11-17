-- ─────────────────────────────────────────────────────────────
--  Discord notifications: DMs from the OurReceipts bot.
--
--  - discord_links: who connected Discord (through the `discord` Edge
--    Function's login, which is the only thing that writes a link) and
--    what they want to hear about. You read and change your own
--    settings; nobody else sees your link.
--  - notification_outbox: what to send. Triggers queue a row per person
--    when something happens; the Edge Function sends them. Saving a
--    receipt never waits on Discord (or fails because of it).
--    Rows wait a minute before sending, so a receipt deleted or fixed
--    right away doesn't ping anyone, and are checked again when sent
--    (still on the receipt, still not deleted, still wanted).
--  - Events: a new receipt you're on; items added after you checked in
--    (you're asked to check in again); a price went UP on something you
--    checked off (going down isn't worth a ping); a payment to you (off
--    unless you turn it on). Reminders about receipts still waiting on
--    you aren't queued: the function works them out each hour.
--  - pg_cron calls the function every minute while anything is due, and
--    on the hour for reminders. Its address and shared secret live in
--    Vault (set once per database, see supabase/DISCORD.md); without
--    them nothing is called, so a local database without Discord set
--    up just queues rows.
--  - Guests (no account) can't connect Discord.
-- ─────────────────────────────────────────────────────────────

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ── Links ──────────────────────────────────────────────────────
create table public.discord_links (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  discord_id         text not null unique,
  discord_username   text not null,
  notify_new_receipt boolean not null default true,
  notify_items_added boolean not null default true,
  notify_price_up    boolean not null default true,
  notify_payment     boolean not null default false,
  -- Reminders about receipts you haven't checked off: every N days (0 = off),
  -- at this hour in your time zone
  remind_every_days  integer not null default 1 check (remind_every_days between 0 and 30),
  remind_hour        integer not null default 18 check (remind_hour between 0 and 23),
  time_zone          text not null default 'America/Los_Angeles'
                     -- an unknown zone makes this raise, so it's refused
                     check (('2000-01-01'::timestamptz at time zone time_zone) is not null),
  last_reminded_at   timestamptz,
  -- DMs to you are failing (you left the server or blocked DMs). Settings
  -- says so; connecting again clears it.
  broken_at          timestamptz,
  linked_at          timestamptz not null default now()
);
alter table public.discord_links enable row level security;
revoke all on public.discord_links from anon, authenticated;
grant select on public.discord_links to authenticated;
grant update (notify_new_receipt, notify_items_added, notify_price_up, notify_payment,
              remind_every_days, remind_hour, time_zone) on public.discord_links to authenticated;
create policy "discord link own read" on public.discord_links for select to authenticated
  using (user_id = (select auth.uid()));
create policy "discord link own update" on public.discord_links for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── Outbox ─────────────────────────────────────────────────────
create table public.notification_outbox (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('new_receipt', 'items_added', 'price_up', 'payment')),
  receipt_id   uuid references public.receipts(id) on delete cascade,
  -- The notice behind it: gone (item removed, price back to what it was)
  -- means there's nothing to say, so the row goes too
  notice_id    uuid references public.receipt_notices(id) on delete cascade,
  payment_id   uuid references public.payments(id) on delete cascade,
  actor_member uuid references public.group_members(id) on delete set null,
  created_at   timestamptz not null default now(),
  send_after   timestamptz not null default now() + interval '1 minute',
  claimed_at   timestamptz,
  sent_at      timestamptz,
  -- Sent, or decided not to (skip_reason): either way it's done
  skip_reason  text,
  attempts     integer not null default 0,
  last_error   text
);
create index notification_outbox_due on public.notification_outbox (send_after) where sent_at is null;
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;
-- No policies: only the Edge Function (service role) touches it

-- The group member who did something, from the signed-in user
create function public.actor_member_in(gid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.group_members where group_id = gid and user_id = (select auth.uid())
$$;
revoke all on function public.actor_member_in(uuid) from public, anon, authenticated;

-- A new receipt: everyone on it (or everyone, for an empty list) plus the
-- payer, who has Discord connected, except whoever added it
create function public.queue_new_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.group_id is null or new.deleted_at is not null then return null; end if;
  insert into public.notification_outbox (user_id, kind, receipt_id, actor_member)
  select gm.user_id, 'new_receipt', new.id, public.actor_member_in(new.group_id)
  from public.group_members gm
  join public.discord_links d on d.user_id = gm.user_id
  where gm.group_id = new.group_id and gm.active and not gm.is_guest
    and gm.user_id is distinct from coalesce(new.created_by, (select auth.uid()))
    and (cardinality(new.member_ids) = 0 or gm.id = any(new.member_ids) or gm.id = new.paid_by_member);
  return null;
end $$;
create trigger queue_discord after insert on public.receipts
  for each row execute function public.queue_new_receipt();

-- Items added (or newly split by everyone) after you checked in, and
-- prices that went up on something you checked off
create function public.queue_receipt_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if new.seen_at is not null then return null; end if;
  if new.kind = 'price' and not (new.new_price > new.old_price) then return null; end if;
  -- An update only matters when the price went up again
  if tg_op = 'UPDATE' and not (new.kind = 'price' and new.new_price > old.new_price) then return null; end if;
  select gm.user_id into uid from public.group_members gm
  join public.discord_links d on d.user_id = gm.user_id
  where gm.id = new.member_id and gm.active and not gm.is_guest;
  if uid is null then return null; end if;
  -- A price notice raised again before the first ping went: one ping
  if tg_op = 'UPDATE' and exists (select 1 from public.notification_outbox
                                  where notice_id = new.id and sent_at is null) then
    return null;
  end if;
  insert into public.notification_outbox (user_id, kind, receipt_id, notice_id, actor_member)
  values (uid, case new.kind when 'price' then 'price_up' else 'items_added' end,
          new.receipt_id, new.id, new.actor_member);
  return null;
end $$;
create trigger queue_discord after insert or update on public.receipt_notices
  for each row execute function public.queue_receipt_notice();

-- A payment to you that someone else recorded
create function public.queue_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null or new.imported_from_settlement is not null then return null; end if;
  insert into public.notification_outbox (user_id, kind, payment_id, receipt_id, actor_member)
  select gm.user_id, 'payment', new.id, new.receipt_id, public.actor_member_in(new.group_id)
  from public.group_members gm
  join public.discord_links d on d.user_id = gm.user_id
  where gm.id = new.to_member and gm.active and not gm.is_guest
    and gm.user_id is distinct from coalesce(new.created_by, (select auth.uid()));
  return null;
end $$;
create trigger queue_discord after insert on public.payments
  for each row execute function public.queue_payment();

revoke all on function public.queue_new_receipt(), public.queue_receipt_notice(), public.queue_payment()
  from public, anon, authenticated;

-- ── For the Edge Function (service role only) ──────────────────
-- Take the due rows to send (each row once, even with two runs at once).
-- A row claimed but never finished (the function died) is retried after
-- five minutes; after five tries it's given up on.
create function public.discord_claim_due(p_limit integer default 100) returns setof public.notification_outbox
language sql security definer set search_path = '' as $$
  update public.notification_outbox o set claimed_at = now(), attempts = o.attempts + 1
  where o.id in (
    select id from public.notification_outbox
    where sent_at is null and send_after <= now() and attempts < 5
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by id
    limit p_limit
    for update skip locked
  )
  returning o.*
$$;

-- Done (p_error null): sent, or skipped with a reason. Failed: try again
-- later (1, 5, 15, 60 minutes).
create function public.discord_finish(p_ids bigint[], p_error text default null, p_skip text default null) returns void
language sql security definer set search_path = '' as $$
  update public.notification_outbox set
    sent_at = case when p_error is null then now() end,
    skip_reason = p_skip,
    last_error = p_error,
    claimed_at = null,
    send_after = case when p_error is null then send_after
                      else now() + (array[1, 5, 15, 60, 60])[least(attempts, 5)] * interval '1 minute' end
  where id = any(p_ids)
$$;

-- People whose reminder is due now, with the receipts waiting on them.
-- Waiting on you: you're on it (or everyone is), you haven't checked in,
-- it's at least a day old (the "new receipt" ping covers the first day)
-- and at most 60 days old (older ones are history, not a to-do), and it
-- isn't deleted. Due: past your reminder
-- hour today (within 3 hours, so a late run doesn't remind at midnight),
-- and your last reminder was at least N days ago (less an hour of slack).
create function public.discord_reminders_due() returns table (user_id uuid, discord_id text, receipts jsonb)
language sql stable security definer set search_path = '' as $$
  select d.user_id, d.discord_id, jsonb_agg(jsonb_build_object(
      'id', r.id, 'store_name', r.store_name, 'receipt_date', r.receipt_date,
      'created_at', r.created_at, 'group_name', g.name,
      'total', coalesce((select sum(i.price) from public.items i where i.receipt_id = r.id and i.deleted_at is null), 0)
               + r.tax + r.tip + r.fees
    ) order by r.created_at)
  from public.discord_links d
  join public.group_members gm on gm.user_id = d.user_id and gm.active and not gm.is_guest
  join public.groups g on g.id = gm.group_id
  join public.receipts r on r.group_id = gm.group_id and r.deleted_at is null
  where d.remind_every_days > 0 and d.broken_at is null
    and extract(hour from now() at time zone d.time_zone) between d.remind_hour and d.remind_hour + 2
    and (d.last_reminded_at is null
         or d.last_reminded_at <= now() - (d.remind_every_days * interval '1 day' - interval '1 hour'))
    -- (an empty list means everyone, but not people who joined after it)
    and (gm.id = any(r.member_ids) or (cardinality(r.member_ids) = 0 and r.created_at >= gm.created_at))
    and r.created_at <= now() - interval '1 day'
    and r.created_at >= now() - interval '60 days'
    and not exists (select 1 from public.checkins k where k.receipt_id = r.id and k.member_id = gm.id)
  group by d.user_id, d.discord_id
$$;

revoke all on function public.discord_claim_due(integer), public.discord_finish(bigint[], text, text),
  public.discord_reminders_due() from public, anon, authenticated;
grant execute on function public.discord_claim_due(integer), public.discord_finish(bigint[], text, text),
  public.discord_reminders_due() to service_role;

-- ── Waking the function ────────────────────────────────────────
-- Every minute: call it if something is due, or on the hour (reminders).
-- Also tidies up: sent rows older than 30 days go.
create function public.discord_wake() returns void
language plpgsql security definer set search_path = '' as $$
declare
  fn_url text;
  secret text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'discord_function_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'discord_cron_secret';
  if fn_url is null or secret is null then return; end if;

  delete from public.notification_outbox
  where (sent_at < now() - interval '30 days') or (attempts >= 5 and created_at < now() - interval '30 days');

  if extract(minute from now()) = 0 or exists (
    select 1 from public.notification_outbox
    where sent_at is null and send_after <= now() and attempts < 5
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
  ) then
    perform net.http_post(
      url := fn_url || '/send',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      body := jsonb_build_object('reminders', extract(minute from now()) = 0)
    );
  end if;
end $$;
revoke all on function public.discord_wake() from public, anon, authenticated;

select cron.schedule('discord-wake', '* * * * *', 'select public.discord_wake()');
