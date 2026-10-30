import { defineConfig } from '@playwright/test'
import base from '../../playwright.config'
const browserName = (process.env.CI_BROWSER ?? 'chromium') as 'chromium' | 'firefox' | 'webkit'
if (!['chromium', 'firefox', 'webkit'].includes(browserName)) throw new Error('Invalid CI_BROWSER')
export default defineConfig({
  ...base,
  testDir: '../../tests/e2e',
  outputDir: '../../test-results',
  projects: [
    { name: `${browserName}-desktop`, use: { browserName, viewport: { width: 1280, height: 800 } } },
    { name: `${browserName}-phone`, use: { browserName, viewport: { width: 393, height: 851 } } },
  ],
})
