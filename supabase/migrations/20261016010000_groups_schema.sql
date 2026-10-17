-- ─────────────────────────────────────────────────────────────
--  Accounts + groups, step 1 of 3: additive schema.
--  New tables and new nullable columns only; old name-based
--  columns stay until 20261016030000_finalize.sql drops them.
-- ─────────────────────────────────────────────────────────────

-- ── Profiles (one per auth user) ─────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  first_name  text not null default '',
  last_name   text not null default '',
  created_at  timestamptz not null default now()
);

-- Per-user secrets, readable only by their owner (see finalize RLS)
create table public.user_secrets (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  gemini_api_key  text,
  updated_at      timestamptz not null default now()
);

-- ── Groups ───────────────────────────────────────────────────
-- 8 chars, no look-alike characters (0/O, 1/I/L)
create function public.new_invite_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), ''
  )
  from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) as i
$$;

create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  invite_code  text not null unique default public.new_invite_code(),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- A "person" in a group. user_id is null for guests and for people
-- who haven't signed up / claimed themselves yet. Never hard-deleted:
-- leaving or removal sets active = false so history still adds up.
create table public.group_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  first_name  text not null check (length(trim(first_name)) > 0),
  last_name   text not null default '',
  role        text not null default 'member' check (role in ('owner', 'member')),
  is_guest    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index group_members_one_per_user on public.group_members (group_id, user_id) where user_id is not null;
create index group_members_user_id on public.group_members (user_id);

-- ── New columns on existing tables ───────────────────────────
alter table public.receipts
  add column group_id        uuid references public.groups(id) on delete cascade,
  add column paid_by_member  uuid references public.group_members(id),
  add column member_ids      uuid[] not null default '{}',
  add column created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  add column deleted_at      timestamptz;

alter table public.trips
  add column group_id    uuid references public.groups(id) on delete cascade,
  add column member_ids  uuid[] not null default '{}',
  add column created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  add column deleted_at  timestamptz;

alter table public.items
  add column created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  add column deleted_at  timestamptz;

alter table public.meals
  add column created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  add column deleted_at  timestamptz;

alter table public.claims
  add column member_id  uuid references public.group_members(id);

-- checkins had no primary key; the audit log needs a row id
alter table public.checkins
  add column id         uuid not null default gen_random_uuid() primary key,
  add column member_id  uuid references public.group_members(id);

alter table public.settlements
  add column group_id         uuid references public.groups(id) on delete cascade,
  add column debtor_member    uuid references public.group_members(id),
  add column creditor_member  uuid references public.group_members(id);

-- ── Profile creation on signup ───────────────────────────────
-- Email signups pass first_name/last_name in user metadata;
-- Google provides given_name/family_name (or a full name).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text := trim(coalesce(meta->>'full_name', meta->>'name', ''));
begin
  insert into public.profiles (id, first_name, last_name) values (
    new.id,
    coalesce(nullif(trim(meta->>'first_name'), ''), nullif(trim(meta->>'given_name'), ''), split_part(full_name, ' ', 1)),
    coalesce(nullif(trim(meta->>'last_name'), ''), nullif(trim(meta->>'family_name'), ''), trim(regexp_replace(full_name, '^\S+', '')))
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep linked group_members names in sync with the profile
create function public.sync_profile_names() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name then
    update public.group_members
      set first_name = new.first_name, last_name = new.last_name
      where user_id = new.id and length(trim(new.first_name)) > 0;
  end if;
  return new;
end $$;

create trigger on_profile_names_changed
  after update on public.profiles
  for each row execute function public.sync_profile_names();
