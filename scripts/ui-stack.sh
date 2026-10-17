#!/usr/bin/env bash
# A second, separate local Supabase for UI testing, so it never collides with
# the default one (ports 543xx, used by `npm run dev` / other tools).
#
#   npm run ui:start   start it (ports 544xx)
#   npm run ui:reset   load real data from a backup + test accounts (wipes it)
#   npm run ui:dev     dev server on http://localhost:5180 pointed at it
#   npm run ui:stop    stop it
#
# Its config lives in .supabase-ui/ (gitignored), generated from
# supabase/config.toml with shifted ports; migrations and email templates are
# re-copied on every start/reset so it always matches the repo.
set -euo pipefail
cd "$(dirname "$0")/.."

WORKDIR=".supabase-ui"
CLI="npx --yes supabase@2.121.0"
DB_URL="postgresql://postgres:postgres@host.docker.internal:54422/postgres"
DEFAULT_BACKUP="backups/2026-10-17-live"
DEFAULT_APPLY_AFTER="20261017020000"

sync_config() {
  mkdir -p "$WORKDIR/supabase"
  rm -rf "$WORKDIR/supabase/migrations" "$WORKDIR/supabase/templates"
  cp -r supabase/migrations supabase/templates "$WORKDIR/supabase/"
  sed -e 's/^project_id = .*/project_id = "WOTR-ui"/' \
      -e 's/= 54321$/= 54421/; s/= 54322$/= 54422/; s/= 54320$/= 54420/; s/= 54329$/= 54429/' \
      -e 's/= 54323$/= 54423/; s/= 54324$/= 54424/; s/= 54327$/= 54427/; s/= 8083$/= 8183/' \
      -e 's#localhost:5173#localhost:5180#g; s#127.0.0.1:5173#127.0.0.1:5180#g' \
      supabase/config.toml > "$WORKDIR/supabase/config.toml"
  # Analytics isn't needed and its container is flaky on Windows
  awk '/^\[analytics\]/{a=1} a && /^enabled = /{sub(/true/, "false"); a=0} {print}' \
    "$WORKDIR/supabase/config.toml" > "$WORKDIR/supabase/config.tmp" && mv "$WORKDIR/supabase/config.tmp" "$WORKDIR/supabase/config.toml"
}

case "${1:-}" in
  start)
    sync_config
    $CLI start --workdir "$WORKDIR"
    echo "UI-testing Supabase running: API http://127.0.0.1:54421, test inbox http://127.0.0.1:54424"
    ;;
  stop)
    $CLI stop --workdir "$WORKDIR"
    ;;
  reset)
    sync_config
    LOCAL_DB_URL="$DB_URL" APPLY_AFTER="${APPLY_AFTER:-$DEFAULT_APPLY_AFTER}" \
      bash scripts/local-db-reset.sh "${2:-$DEFAULT_BACKUP}"
    ;;
  dev)
    KEY=$($CLI status --workdir "$WORKDIR" -o env 2>/dev/null | grep -E '^ANON_KEY=' | cut -d= -f2- | tr -d '"')
    if [ -z "$KEY" ]; then echo "UI-testing Supabase isn't running. Run: npm run ui:start"; exit 1; fi
    # Use a settings file, not environment variables: when npm runs this
    # through WSL's bash, env vars don't reach the Windows vite process.
    # `--mode ui` loads .env.ui.local (gitignored) instead of .env.development.local.
    printf 'VITE_SUPABASE_URL=http://127.0.0.1:54421\nVITE_SUPABASE_ANON_KEY=%s\n' "$KEY" > .env.ui.local
    npx vite --port 5180 --strictPort --mode ui
    ;;
  *)
    echo "Usage: bash scripts/ui-stack.sh {start|stop|reset [backup-dir]|dev}"; exit 1 ;;
esac
