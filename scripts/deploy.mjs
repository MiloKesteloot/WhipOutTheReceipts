import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const versionFile = join(__dirname, '../src/buildVersion.json')

// Safety check: this app needs the accounts/groups database migrations.
// Refuse to deploy if the production database (from .env) doesn't have them yet,
// otherwise the live site would break for everyone.
const env = Object.fromEntries(readFileSync(join(__dirname, '../.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const check = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/groups?select=id&limit=1`, {
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY },
})
const body = await check.json().catch(() => ({}))
if (check.status === 404 || ['PGRST205', '42P01'].includes(body?.code)) {
  console.error('\n✗ Not deploying: the production database has not been migrated to accounts + groups yet.')
  console.error('  Run the cutover steps first (see supabase/CUTOVER.md).\n')
  process.exit(1)
}

// Same for item order (migration 20261018000000_item_position.sql): the editor
// saves it and receipts load sorted by it
const positionCheck = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/items?select=position&limit=1`, {
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY },
})
const positionBody = await positionCheck.json().catch(() => ({}))
if (positionBody?.code === '42703' || /position/.test(positionBody?.message || '')) {
  console.error('\n✗ Not deploying: the production database is missing items.position.')
  console.error('  Apply supabase/migrations/20261018000000_item_position.sql first.\n')
  process.exit(1)
}

const data = JSON.parse(readFileSync(versionFile, 'utf8'))
data.version += 1
writeFileSync(versionFile, JSON.stringify(data, null, 2) + '\n')

console.log(`\nBuilding and deploying version ${data.version}...\n`)

try {
  execSync('vite build && gh-pages -d dist', { stdio: 'inherit', shell: true })
  console.log(`\n✓ Deployed version ${data.version}\n`)
} catch {
  data.version -= 1
  writeFileSync(versionFile, JSON.stringify(data, null, 2) + '\n')
  console.error('\nDeploy failed. Version rolled back.\n')
  process.exit(1)
}
