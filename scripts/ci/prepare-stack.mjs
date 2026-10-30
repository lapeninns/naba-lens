import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import net from 'node:net'
const work = process.argv[2]
cpSync('supabase', join(work, 'supabase'), { recursive: true, filter: p => !/[/\\]\.(temp|branches)([/\\]|$)/.test(p) })
const path = join(work, 'supabase/config.toml')
let config = readFileSync(path, 'utf8')
// Probe a whole block before starting; a race fails startup rather than reusing a stack.
const base = 58000 + Math.floor(Math.random() * 60) * 100
const ports = [...config.matchAll(/^\s*(?:\w+_)?port = (554\d\d)$/gm)].map(m => Number(m[1]) - 55400 + base)
for (const port of ports) await new Promise((resolve, reject) => {
  const server = net.createServer().once('error', reject)
  server.listen(port, '127.0.0.1', () => server.close(resolve))
})
config = config.replace(/^project_id = .*$/m, `project_id = "${basename(work).toLowerCase().replace(/[^a-z0-9-]/g, '-')}"`)
  .replace(/^(\s*(?:\w+_)?port = )554(\d\d)$/gm, (_, prefix, offset) => `${prefix}${base + Number(offset)}`)
// Auth links point at the e2e app server (as tests/e2e/prepare-stack.mjs does); every
// browser context shares one IP, so only this throwaway stack's per-IP sign-in and
// verification limits are raised. Invite-only sign-up settings are unchanged.
const site = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3457)}`
config = config.replace(/^site_url = ".*"$/m, `site_url = "${site}"`)
  .replace(/^additional_redirect_urls = .*$/m, `additional_redirect_urls = ["${site}/auth/callback", "${site}/auth/confirm"]`)
  .replace(/^sign_in_sign_ups = \d+$/m, 'sign_in_sign_ups = 300')
  .replace(/^token_verifications = \d+$/m, 'token_verifications = 300')
for (const section of ['studio', 'realtime', 'analytics', 'edge_runtime']) {
  config = config.replace(new RegExp(`(\\[${section}\\]\\s*\\n)enabled = true`), '$1enabled = false')
}
writeFileSync(path, config)
