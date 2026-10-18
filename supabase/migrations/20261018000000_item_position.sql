-- ─────────────────────────────────────────────────────────────
--  Item order within a receipt, set by dragging in the editor.
--  Null for items saved before this; they sort after positioned
--  items by created_at, which matches the old order.
-- ─────────────────────────────────────────────────────────────
alter table public.items add column position integer;
