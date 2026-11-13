import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import base from '../../playwright.config'
import { fileURLToPath } from 'node:url'
const browserName = (process.env.CI_BROWSER ?? 'chromium') as 'chromium' | 'firefox' | 'webkit'
if (!['chromium', 'firefox', 'webkit'].includes(browserName)) throw new Error('Invalid CI_BROWSER')
// The root config's projects, unchanged (device settings, @core filters, Firefox
// app-data fix), narrowed to the engine this CI job installed: chromium runs the
// desktop suite and the phone-width project, firefox/webkit the @core journey;
// webkit also the WebKit-emulation phone project (capture journal only).
const engineOf = (name?: string) =>
  name === 'mobile-chromium' ? 'chromium' : name === 'webkit-phone' ? 'webkit' : name
const projects = (base.projects ?? [])
  .filter(p => engineOf(p.name) === browserName)
  .map(p => p.name === 'webkit' && process.env.CI_WEBKIT_HEADED === '1'
    ? { ...p, use: { ...p.use, headless: false } }
    : p)
if (projects.length === 0) throw new Error(`No root Playwright project for ${browserName}`)
export default defineConfig({
  ...base,
  webServer: { ...(base.webServer as NonNullable<PlaywrightTestConfig['webServer']> & { command: string }), cwd: fileURLToPath(new URL('../../', import.meta.url)) },
  testDir: '../../tests/e2e',
  outputDir: '../../test-results',
  projects,
})
