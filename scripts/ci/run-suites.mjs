import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const work = process.argv[2]
const status = JSON.parse(readFileSync(`${work}/status.json`, 'utf8'))
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY ?? status.PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
  MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL }
let failed = false
for (const args of [['test:integration'], ['test:lifecycle', work], ['test:security', work], ['exec', 'playwright', 'test', '--config', 'scripts/ci/playwright.config.ts']]) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit', env })
  console.log(`${args[0]}: ${result.status === 0 ? 'PASS' : 'FAIL'}`)
  failed ||= result.status !== 0
}
process.exit(failed ? 1 : 0)
