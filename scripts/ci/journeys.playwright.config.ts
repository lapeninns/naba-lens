import "../lib/server-runtime.mjs"

import { fileURLToPath } from "node:url"

import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from "@playwright/test"

import base from "../../playwright.config"
import { firefoxLaunchOptions } from "../../tests/e2e/helpers/firefox"

/**
 * Playwright config for `pnpm journeys run` (scripts/ci/journeys/run.mjs). The
 * runner builds the app for the chosen stack first, so the web server here only
 * starts it. Unlike the release config there is no `@core` filtering: a journey
 * runs exactly the spec and grep it declares, on the projects it declares.
 * Traces and videos stay off because they carry session cookies.
 */
const root = fileURLToPath(new URL("../../", import.meta.url))
const port = Number(process.env.E2E_PORT)
if (!port) throw new Error("E2E_PORT is set by the journey runner.")
const baseURL = `http://127.0.0.1:${port}`
const server = base.webServer as NonNullable<
  PlaywrightTestConfig["webServer"]
> & { command: string; env?: Record<string, string> }

export default defineConfig({
  ...base,
  testDir: `${root}tests`,
  testMatch: "**/*.spec.ts",
  outputDir:
    process.env.JOURNEY_OUTPUT_DIR ?? `${root}.artifacts/journeys/.playwright`,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.JOURNEY_RAW_JSON ??
          `${root}.artifacts/journeys/.report.json`,
      },
    ],
  ],
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
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
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 800 },
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
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    ...server,
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/login`,
    cwd: root,
    reuseExistingServer: false,
  },
})
