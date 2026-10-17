#!/usr/bin/env bash
# Rebuild the LOCAL Supabase database from a production backup, then
# apply every migration after the baseline. Never touches production.
#
#   bash scripts/local-db-reset.sh [backup-dir]
#
# Options (environment variables):
#   LOCAL_DB_URL   database to rebuild (default: local Supabase on :54322)
#   APPLY_AFTER    only apply migrations newer than this version, for backups
#                  taken after some migrations already ran (default: baseline)
#
# Requires: Docker running, local Supabase started (npx supabase start).
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP="${1:-backups/2026-10-16-pre-auth}"
LOCAL="${LOCAL_DB_URL:-postgresql://postgres:postgres@host.docker.internal:54322/postgres}"
APPLY_AFTER="${APPLY_AFTER:-20261016000000}"
export MSYS_NO_PATHCONV=1

psql_local() {
  docker run --rm -i -v "$(pwd -W 2>/dev/null || pwd):/w" -w /w postgres:17-alpine \
    psql "$LOCAL" -q -v ON_ERROR_STOP=1 "$@"
}

echo "Wiping local public schema and test users..."
psql_local -c "drop schema public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; truncate auth.users cascade;"

echo "Loading backup from $BACKUP..."
psql_local -f "$BACKUP/schema.sql"
# Only public-schema data (skip storage/auth/etc.), with FK checks off while loading
TMP="$BACKUP/.public-data.tmp.sql"
awk '
  /^COPY "/ { skip = ($0 !~ /^COPY "public"\./) }
  /^SELECT pg_catalog.setval\(/ { if (index($0, "\"public\".") == 0) next }
  !skip { print }
  skip && /^\\\.$/ { skip = 0 }
' "$BACKUP/data.sql" > "$TMP"
psql_local -c "set session_replication_role = replica" -f "$TMP"
rm -f "$TMP"

for f in supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  [ "$v" \> "$APPLY_AFTER" ] || continue
  echo "Applying $f"
  psql_local -1 -f "$f"
done

# Record every migration as applied, or `supabase start` will try to re-run them
for f in supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  psql_local -c "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text); insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$(basename "$f" .sql | cut -d_ -f2-)') on conflict do nothing;"
done

# The signup trigger lives on auth.users, which backups of the public schema
# don't include; restore it when the function exists (post-accounts backups)
psql_local -c "do \$\$ begin
  if exists (select 1 from pg_proc where proname = 'handle_new_user')
     and not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end \$\$;"

echo "Seeding test accounts (milo@/alex@/newbie@test.local, password test1234)..."
psql_local -v local_ok=1 -f supabase/seed-test-users.sql

echo "Done."
