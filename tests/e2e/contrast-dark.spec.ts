import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import {
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { signedInPage } from "./helpers/world"

/**
 * Dark-theme colour contrast on the main staff and admin pages. The theme
 * follows the system, so a dark colour scheme on the context is what a user
 * with a dark OS sees. Light is covered by responsive.spec.ts. Each failure
 * names the page, width, element and the colours axe measured.
 */

const WIDTHS = [390, 1280] as const

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")
test.describe.configure({ mode: "serial" })

let world: CoverageWorld
let staff: Page
let admin: Page

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  world = await provisionCoverageWorld()
  await seedImages(world.staffA, world.venue1, 3, { prefix: "dark-a" })
  await seedImages(world.staffB, world.venue1, 2, { prefix: "dark-b" })
  staff = await signedInPage(browser, world.staffA, { colorScheme: "dark" })
  admin = await signedInPage(browser, world.admin, { colorScheme: "dark" })
})

test.afterAll(async () => {
  await staff?.context().close()
  await admin?.context().close()
})

async function contrast(page: Page, width: number, path: string) {
  await page.setViewportSize({ width, height: 900 })
  const res = await page.goto(path)
  expect(res?.status(), `${path} status`).toBeLessThan(400)
  await expect(page.locator("html")).toHaveClass(/\bdark\b/)
  await expect(page.locator("h1").first()).toBeVisible()
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running")
  )
  const result = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze()
  const checked = result.passes.flatMap((v) => v.nodes).length
  expect(checked, `${path}@${width}: axe measured no text`).toBeGreaterThan(5)
  const failures = result.violations.flatMap((v) =>
    v.nodes.map((n) => {
      const data = n.any[0]?.data as
        | { fgColor?: string; bgColor?: string; contrastRatio?: number }
        | undefined
      return `${n.target.join(" ")} fg=${data?.fgColor} bg=${data?.bgColor} ratio=${data?.contrastRatio}`
    })
  )
  expect.soft(failures, `${path}@${width} dark colour contrast`).toEqual([])
}

const STAFF_PAGES = () => [
  "/staff/tasks",
  "/staff/tasks/month",
  "/staff",
  "/staff/community",
  "/staff/people",
  `/staff/people/${world.staffB.id}`,
]

const ADMIN_PAGES = () => [
  "/admin",
  "/admin/staff",
  `/admin/staff/${world.staffA.id}`,
  "/admin/coverage",
  "/admin/coverage/managers",
  `/admin/coverage/${world.venue1.id}`,
  `/admin/coverage/${world.venue1.id}/team`,
  `/admin/coverage/${world.venue1.id}/checklist`,
  "/admin/menus",
  `/admin/menus/${world.venue1.id}`,
]

for (const width of WIDTHS) {
  test(`staff pages hold 4.5:1 in dark at ${width}px`, async () => {
    for (const path of STAFF_PAGES()) await contrast(staff, width, path)
  })

  test(`admin pages hold 4.5:1 in dark at ${width}px`, async () => {
    for (const path of ADMIN_PAGES()) await contrast(admin, width, path)
  })
}
