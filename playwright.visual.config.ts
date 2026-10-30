import "./scripts/lib/server-runtime.mjs"

import { defineConfig, devices } from "@playwright/test"

import { firefoxLaunchOptions } from "./tests/e2e/helpers/firefox"
import { getLocalSupabaseEnv } from "./tests/support/local-supabase"

// The spec skips itself under the default e2e config (next dev, long run).
process.env.NABALENS_VISUAL = "1"

const PORT = Number(process.env.VISUAL_PORT ?? 3517)
const baseURL = `http://127.0.0.1:${PORT}`
const supabase = getLocalSupabaseEnv()

/**
 * Visual and accessibility pass (spec §4) against a PRODUCTION build. Run it via
 * `pnpm test:visual <workdir>` (tests/visual/run.mjs), which builds with the
 * isolated stack's keys first. Chromium covers every QA width inside the spec;
 * Firefox and WebKit cover desktop at 1280.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "visual.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
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
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 800 },
        // macOS blocks Playwright's Firefox from the default profile folder.
        launchOptions: firefoxLaunchOptions(),
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
      SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
})
