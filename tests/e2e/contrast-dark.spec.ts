import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import {
  adminPages,
  managerPages,
  provisionManagedWorld,
  staffPages,
  type ManagedWorld,
} from "./helpers/managed-world"
import { signedInPage } from "./helpers/world"

/**
 * Dark-theme colour contrast on the main staff, manager and admin pages. The
 * theme follows the system, so a dark colour scheme on the context is what a
 * user with a dark OS sees. Light is covered by responsive.spec.ts. Each
 * failure names the page, width, element and the colours axe measured. The
 * manager's month is prepared first so coverage, team, checklist and task
 * pages carry real chips; a visible closed chip is also measured on hover.
 */

const WIDTHS = [390, 1280] as const

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")
test.describe.configure({ mode: "serial" })

let m: ManagedWorld
let staff: Page
let manager: Page
let admin: Page
let hovered = 0

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000)
  m = await provisionManagedWorld("dark")

  const dark = { colorScheme: "dark" } as const
  staff = await signedInPage(browser, m.world.staffA, dark)
  manager = await signedInPage(browser, m.world.manager, dark)
  admin = await signedInPage(browser, m.world.admin, dark)
})

test.afterAll(async () => {
  await staff?.context().close()
  await manager?.context().close()
  await admin?.context().close()
})

function describeNodes(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]
) {
  return violations.flatMap((v) =>
    v.nodes.map((n) => {
      const data = n.any[0]?.data as
        | { fgColor?: string; bgColor?: string; contrastRatio?: number }
        | undefined
      return `${n.target.join(" ")} fg=${data?.fgColor} bg=${data?.bgColor} ratio=${data?.contrastRatio}`
    })
  )
}

async function contrast(page: Page, width: number, path: string) {
  await page.setViewportSize({ width, height: 900 })
  const res = await page.goto(path)
  expect(res?.status(), `${path} status`).toBeLessThan(400)
  await expect(page.locator("html")).toHaveClass(/\bdark\b/)
  await expect(page.locator("h1").first()).toBeVisible()
  // A route with loading.tsx shows its skeleton (which has an h1 of its own)
  // first and streams the page in behind it, in a hidden "S:" container that
  // React reveals up to ~300 ms after load. Measure the page, not the skeleton.
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0)
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running")
  )
  const result = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze()
  const checked = result.passes.flatMap((v) => v.nodes).length
  expect(checked, `${path}@${width}: axe measured no text`).toBeGreaterThan(5)
  // Text over images or gradients axe cannot resolve; counted, not failed.
  const incomplete = result.incomplete.flatMap((v) => v.nodes).length
  test.info().annotations.push({
    type: "axe-incomplete",
    description: `${path}@${width}: ${incomplete} incomplete, ${checked} passed`,
  })
  expect
    .soft(
      describeNodes(result.violations),
      `${path}@${width} dark colour contrast`
    )
    .toEqual([])

  const closed = page
    .locator('[data-slot="status-chip"][data-tone="closed"]')
    .filter({ visible: true })
    .first()
  if ((await closed.count()) === 0) return
  await closed.scrollIntoViewIfNeeded()
  await closed.hover()
  await closed.evaluate((el) => el.setAttribute("data-e2e-hovered", "1"))
  const onHover = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .include("[data-e2e-hovered]")
    .analyze()
  hovered++
  // The hovered chip was actually measured, not skipped.
  expect(
    [...onHover.passes, ...onHover.violations].flatMap((v) => v.nodes).length,
    `${path}@${width} closed chip on hover was measured`
  ).toBeGreaterThan(0)
  expect
    .soft(
      describeNodes(onHover.violations),
      `${path}@${width} closed chip on hover`
    )
    .toEqual([])
}

for (const width of WIDTHS) {
  test(`staff pages hold 4.5:1 in dark at ${width}px`, async () => {
    for (const path of staffPages(m)) await contrast(staff, width, path)
  })

  test(`manager pages hold 4.5:1 in dark at ${width}px`, async () => {
    for (const path of managerPages(m)) await contrast(manager, width, path)
  })

  test(`admin pages hold 4.5:1 in dark at ${width}px`, async () => {
    for (const path of adminPages(m)) await contrast(admin, width, path)
  })
}

test("closed chips measured on hover", () => {
  test.info().annotations.push({
    type: "closed-chip-hover",
    description: `${hovered} page states had a visible closed chip`,
  })
  expect(hovered).toBeGreaterThan(0)
})
