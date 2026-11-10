// The two B02-06 interruption charters (charters.playwright.ts) on Playwright
// itself, because they need what the standalone e2e browser fixture has no
// method for: BrowserContext.setOffline, Page.close and BrowserContext.newPage
// (README.md, "Charters"). The coordinator runs them after the e2e suites,
// inside the same lock, against the same running app and per-run world:
//
//   $B02_CHECKOUT/node_modules/.bin/playwright test --config charters.config.ts
//
// The config declares no server of its own: run.mjs's `next start` on spare6
// is the app under test, and starting another would test something else. Playwright is the
// candidate checkout's installed @playwright/test, resolved from B02_CHECKOUT,
// never a copy in $HOME or a second installation; the CLI must be that same
// package so the test file and the runner share one instance. Fixed loopback
// target and run id as e2e.config.ts; nothing secret is written.
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, isAbsolute, join, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { runId, target, VIEWPORT } from "./fixture"

type PlaywrightTest = typeof import("@playwright/test")

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The candidate's @playwright/test, required from B02_CHECKOUT's own
 * node_modules. Refuses a resolution outside that checkout, and (in the
 * runner's main process) a CLI that is not the same installation.
 */
export function candidatePlaywright(env = process.env): PlaywrightTest {
  const checkout = env.B02_CHECKOUT
  if (!checkout || !isAbsolute(checkout)) throw new Error("B02_CHECKOUT must be the candidate checkout's absolute path.")
  const root = realpathSync(checkout)
  const require = createRequire(join(root, "package.json"))
  const entry = realpathSync(require.resolve("@playwright/test"))
  const modules = join(root, "node_modules") + sep
  if (!entry.startsWith(modules)) throw new Error("@playwright/test did not resolve inside B02_CHECKOUT's node_modules.")
  // Workers and helper processes load this file too, from Playwright's own
  // process entry; only a process started by a Playwright CLI is checked.
  const cli = process.argv[1] ? realpathSync(process.argv[1]) : ""
  if (env.TEST_WORKER_INDEX === undefined && basename(cli) === "cli.js") {
    if (dirname(cli) !== dirname(entry)) {
      throw new Error("Run the charters with B02_CHECKOUT's own playwright CLI (node_modules/.bin/playwright).")
    }
  }
  return require(entry) as PlaywrightTest
}

/**
 * The run id, by the fixture's own guard (RUN_ID: one plain segment, no
 * dots), so the charters, the e2e suites and world() accept exactly the same
 * runs and write under one .results/<run>/.
 */
export function charterRunId(): string {
  return runId()
}

/** The two charter titles: run.mjs checks exactly these passed, once each. */
export const CHARTERS = [
  "B02-06-A: an upload interrupted by closing its page is offered again on Me and finishes as one asset",
  "B02-06-B: a reason typed offline stays on this device only, survives leaving, and is saved and sent once back online",
] as const

const { defineConfig } = candidatePlaywright()
const { app } = target()
const run = charterRunId()
const out = join(HERE, ".results", run, "charters")

export default defineConfig({
  testDir: HERE,
  testMatch: "charters.playwright.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  // The same per-run paths run.mjs passes (--output, PLAYWRIGHT_JSON_OUTPUT_FILE),
  // so a bare CLI call writes where the wrapper's receipt check reads.
  outputDir: join(out, "test-results"),
  // Private like the e2e reports (run.mjs sets umask 077): identities only, no
  // cookies or keys, and no trace or video, which would hold the session.
  // The JSON report is this run's receipt; run.mjs checks it names exactly CHARTERS.
  reporter: [["list"], ["json", { outputFile: join(out, "report.json") }]],
  use: {
    baseURL: app,
    browserName: "chromium",
    viewport: VIEWPORT.desktop,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium-desktop" }],
})
