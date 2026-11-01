import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import {
  attachShot,
  importRailwayDraft,
} from "../fixtures/menus/journey-helpers"
import { requireIsolatedStack } from "../e2e/helpers/stack"
import { provisionWorld, signedInPage, type World } from "../e2e/helpers/world"

/**
 * Journey menus.d2-archive-button-name (MENUS-D2, docs/qa/menus-qa-report.md §4):
 * the draft editor's Archive / Unarchive buttons must have an accessible name
 * that starts with their visible text (WCAG 2.5.3 Label in Name). Asserts the
 * correct behaviour, so it fails while the defect exists.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())

const WIDTHS = [360, 390, 768, 1280] as const
let world: World
let draftPath = ""

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  world = await provisionWorld()
  const admin = await signedInPage(browser, world.adminA)
  await importRailwayDraft(admin, world.venue1)
  draftPath = new URL(admin.url()).pathname
  await admin.context().close()
})

async function openMomo(page: Page) {
  await page.goto(draftPath)
  await page.getByRole("searchbox", { name: "Search items" }).fill("Momo")
  await page
    .getByRole("button", { name: /^Momo Veg · Chicken/, expanded: false })
    .click()
}

/** The control exists, and its visible text leads its accessible name (2.5.3). */
async function expectNameStartsWithText(page: Page, visibleText: string) {
  const button = page.locator("button", { hasText: visibleText })
  await expect(button).toHaveCount(1)
  const name = await button.evaluate(
    (el) => el.getAttribute("aria-label") ?? el.textContent ?? ""
  )
  expect(name.toLowerCase().startsWith(visibleText.toLowerCase()), name).toBe(
    true
  )
  const result = await new AxeBuilder({ page })
    .withRules(["label-content-name-mismatch"])
    .analyze()
  expect(
    result.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")))
  ).toEqual([])
}

for (const width of WIDTHS) {
  test(`menus.d2-archive-button-name: Archive item at ${width}px`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000)
    const page = await signedInPage(browser, world.adminA, {
      viewport: { width, height: width < 500 ? 800 : 900 },
    })
    await openMomo(page)
    await expectNameStartsWithText(page, "Archive item")
    if (width === 360) await attachShot(testInfo, "archive-item-360", page)
    await page.context().close()
  })
}

test("menus.d2-archive-button-name: Unarchive item after archiving", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const page = await signedInPage(browser, world.adminA)
  await openMomo(page)
  await page.locator("button", { hasText: "Archive item" }).click()
  const dialog = page.getByRole("alertdialog")
  await dialog.getByRole("button", { name: "Archive item" }).click()
  await expect(dialog).toBeHidden()
  await expectNameStartsWithText(page, "Unarchive item")
  await attachShot(testInfo, "unarchive-item", page)
  await page.context().close()
})
