#!/usr/bin/env bash
# Rebuild the LOCAL Supabase database from a production backup, then
# apply every migration after the baseline. Never touches production.
#
#   bash scripts/local-db-reset.sh [backup-dir]
#
# Requires: Docker running, local Supabase started (npx supabase start).
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP="${1:-backups/2026-10-16-pre-auth}"
LOCAL="postgresql://postgres:postgres@host.docker.internal:54322/postgres"
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
  case "$f" in *_baseline.sql) continue ;; esac
  echo "Applying $f"
  psql_local -1 -f "$f"
done

echo "Done."
