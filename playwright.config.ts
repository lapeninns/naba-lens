import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

import { defineConfig, devices } from "@playwright/test"

import { getLocalSupabaseEnv } from "./tests/support/local-supabase"

/**
 * End-to-end tests against a production build (`next build && next start`) and a
 * LOCAL Supabase stack. Auth emails are read from that stack's Mailpit inbox.
 *
 * Release suite (isolated stack, see tests/e2e/prepare-stack.mjs):
 *
 *   W=$(node tests/e2e/prepare-stack.mjs)
 *   supabase --workdir "$W" start
 *   E2E_SUPABASE_WORKDIR="$W" pnpm test:e2e
 *
 * Without E2E_SUPABASE_WORKDIR the default stack (`supabase status` in this
 * checkout) is used, and the release-gate specs that provision DEV FIXTURE
 * accounts refuse to run (they need an isolated stack).
 *
 * Set E2E_SKIP_BUILD=1 to reuse the last `.next` build (same stack only: the
 * public Supabase URL and key are inlined at build time).
 *
 * `retries: 0` and one worker on purpose: the local auth server is the
 * bottleneck, and a flaky test must be fixed, not retried.
 */

const PORT = Number(process.env.E2E_PORT ?? 3457)
const baseURL = `http://127.0.0.1:${PORT}`

const workdir = process.env.E2E_SUPABASE_WORKDIR
if (workdir && !process.env.E2E_STACK_RESOLVED) {
  const raw = execFileSync(
    "supabase",
    ["--workdir", resolve(workdir), "status", "-o", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  )
  const status = JSON.parse(
    raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
  )
  if (new URL(status.API_URL).port.startsWith("554")) {
    throw new Error("E2E_SUPABASE_WORKDIR must be an isolated stack, not 554xx")
  }
  // Workers re-evaluate this file; they inherit these and skip the lookup.
  Object.assign(process.env, {
    E2E_STACK_RESOLVED: "1",
    E2E_ISOLATED_STACK: "1",
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY ?? status.SECRET_KEY,
    MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL,
    E2E_DB_URL: status.DB_URL,
  })
}
const supabase = getLocalSupabaseEnv()

// Core journey on every engine; the rest of the release suite on Chromium.
const CORE = /@core/

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: ".artifacts/test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "firefox",
      grep: CORE,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // Playwright's WebKit engine on macOS: emulation, not an iPhone/Safari test.
      name: "webkit",
      grep: CORE,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // Mobile-emulated width (412 CSS px, touch) in Chromium: not a phone test.
      name: "mobile-chromium",
      grep: CORE,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `${process.env.E2E_SKIP_BUILD ? "" : "pnpm exec next build && "}pnpm exec next start --hostname 127.0.0.1 --port ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
      SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
})
