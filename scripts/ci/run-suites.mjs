import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { failureExcerpt, scrub } from './suite-report.mjs'
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
// Every credential-like value the stack reports (service, S3, JWT secrets), not a fixed list.
const secrets = [...Object.entries(status).filter(([k]) => /KEY|SECRET|TOKEN|PASSWORD/i.test(k)).map(([, v]) => v),
  env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_JWT_SECRET, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  process.env.CLEANUP_SECRET, process.env.SUPABASE_SECRET_KEY]
// The same directory local-ci.sh logs to, so lci keeps the raw suite logs
// with its run; hosted CI uploads only the scrubbed copies.
const logDir = process.env.CI_LOG_DIR || `${work}/logs`
mkdirSync(logDir, { recursive: true })
const playwright = ['exec', 'playwright', 'test', '--config', 'scripts/ci/playwright.config.ts']
if (env.CI_PLAYWRIGHT_SHARD) {
  if ((env.CI_BROWSER ?? 'chromium') !== 'chromium' || !/^[12]\/2$/.test(env.CI_PLAYWRIGHT_SHARD)) {
    throw new Error('CI_PLAYWRIGHT_SHARD must be 1/2 or 2/2 on Chromium')
  }
  playwright.push('--shard', env.CI_PLAYWRIGHT_SHARD)
}
// Output still streams to this process's stdout/stderr as it arrives; a copy
// goes to the suite's own log for the failure excerpt and retention.
function runSuite(args, file) {
  return new Promise((resolve) => {
    const out = createWriteStream(file)
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      out.end(() => resolve(result))
    }
    const child = spawn('pnpm', args, { stdio: ['inherit', 'pipe', 'pipe'], env })
    child.stdout.on('data', (c) => { process.stdout.write(c); out.write(c) })
    child.stderr.on('data', (c) => { process.stderr.write(c); out.write(c) })
    child.on('error', (error) => done({ code: null, signal: null, error }))
    child.on('close', (code, signal) => done({ code, signal }))
  })
}
const results = []
for (const args of [['test:integration'], ['test:lifecycle', work], ['test:security', work], playwright]) {
  const name = args[0] === 'exec' ? 'playwright' : args[0].replace(':', '-')
  const file = `${logDir}/suite-${name}.log`
  const r = await runSuite(args, file)
  const passed = r.code === 0
  const exit = r.error ? `spawn error ${r.error.code ?? r.error.message}` : r.signal ? `signal ${r.signal}` : `exit ${r.code}`
  console.log(`${args[0]}: ${passed ? 'PASS' : `FAIL (${exit})`}`)
  const raw = readFileSync(file, 'utf8')
  writeFileSync(file.replace(/\.log$/, '.scrubbed.log'), scrub(raw, secrets))
  results.push({ label: args[0], passed, exit, file, raw })
}
const failed = results.filter((r) => !r.passed)
// Printed last: local-ci.sh shows only the last 35 lines of this step's log.
// The table takes 6 lines and each failed suite a header line, so the
// excerpts share the remaining 28 lines.
console.log('\nrun-suites summary (each sub-suite\'s own result):')
for (const r of results) console.log(`  ${r.label.padEnd(17)} ${r.passed ? 'PASS' : 'FAIL'}  ${r.exit}`)
for (const r of failed) {
  console.log(`Failure excerpt, ${r.label} (scrubbed; full log ${r.file}):`)
  const lines = failureExcerpt(r.raw, { maxLines: Math.floor(28 / failed.length) - 1, secrets })
  for (const line of lines.length ? lines : ['(no failure lines found; see the suite log)']) console.log(`  ${line}`)
}
process.exit(failed.length ? 1 : 0)
