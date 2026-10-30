import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import type { LaunchOptions } from "@playwright/test"

/**
 * Firefox reads ~/Library/Application Support/Firefox at startup; on this macOS
 * that folder can be denied to Playwright's build ("Could not find profile
 * folder."). Give it a private app-data folder instead. Used by the `firefox`
 * project and by specs that launch Firefox themselves.
 */
export function firefoxLaunchOptions(): LaunchOptions {
  const appData = resolve(".artifacts/firefox-appdata")
  mkdirSync(appData, { recursive: true })
  return { env: { ...process.env, MOZ_APP_DATA: appData } }
}
