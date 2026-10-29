import { defineConfig, devices } from "@playwright/test"

import { getLocalSupabaseEnv } from "./tests/support/local-supabase"

const PORT = Number(process.env.E2E_PORT ?? 3417)
const baseURL = `http://127.0.0.1:${PORT}`
const supabase = getLocalSupabaseEnv()

/**
 * End-to-end tests against `next dev` and the LOCAL Supabase stack. Supabase keys
 * come from `supabase status`, so no .env file is needed. Auth emails are read from
 * the local Mailpit inbox.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --hostname 127.0.0.1 --port ${PORT}`,
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
