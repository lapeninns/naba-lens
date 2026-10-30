import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const work = process.argv[2]
const status = JSON.parse(readFileSync(`${work}/status.json`, 'utf8'))
if (!status.DB_URL || !status.JWT_SECRET) {
  throw new Error('Isolated stack status must include DB_URL and JWT_SECRET')
}
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY ?? status.PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
  // Integration auth helpers must query the same isolated stack as the API.
  // Without both values they fall back to the checkout's default stack.
  SUPABASE_DB_URL: status.DB_URL,
  SUPABASE_JWT_SECRET: status.JWT_SECRET,
  MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL,
  // Playwright's resolver: isolated-stack checks, E2E_DB_URL for fixtures.
  E2E_SUPABASE_WORKDIR: work }
let failed = false
for (const args of [['test:integration'], ['test:lifecycle', work], ['test:security', work], ['exec', 'playwright', 'test', '--config', 'scripts/ci/playwright.config.ts']]) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit', env })
  console.log(`${args[0]}: ${result.status === 0 ? 'PASS' : 'FAIL'}`)
  failed ||= result.status !== 0
}
process.exit(failed ? 1 : 0)
