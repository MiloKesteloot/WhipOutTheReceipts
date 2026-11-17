-- ─────────────────────────────────────────────────────────────
--  Discord notifications: how much each message includes
--  (Settings → Discord notifications). supabase/functions/discord/messages.js
--  builds each level:
--    everything  a new receipt is a card listing its items
--    minimal     a new receipt is a compact card (store, total, payer, date)
--    none        every message is one line with a link
-- ─────────────────────────────────────────────────────────────

alter table public.discord_links
  add column detail text not null default 'everything' check (detail in ('everything', 'minimal', 'none'));

grant update (detail) on public.discord_links to authenticated;
