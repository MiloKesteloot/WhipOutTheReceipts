import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const versionFile = join(__dirname, '../src/buildVersion.json')

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
