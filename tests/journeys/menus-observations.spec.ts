import { readFileSync } from "node:fs"

import { expect, test } from "@playwright/test"

import {
  RAILWAY,
  attachShot,
  importRailwayDraft,
} from "../fixtures/menus/journey-helpers"
import { requireIsolatedStack } from "../e2e/helpers/stack"
import { provisionWorld, signedInPage } from "../e2e/helpers/world"

/**
 * Journeys for the observations O2–O5 of docs/qa/menus-qa-report.md §4
 * (O1 is in menus-label-conflict.spec.ts). Observations are design points,
 * not defects: a failure here reads "Observation reproduced" and the lead
 * decides. Each test asserts the behaviour the report suggests.
 */

const OBSERVED = "Observation reproduced (design observation, not a defect):"
const repo = (path: string) => new URL(`../../${path}`, import.meta.url)

test("menus.o2-narrow-draft-editor: at 360px section names are readable and the save bar is one row", async ({
  browser,
}, testInfo) => {
  requireIsolatedStack()
  test.setTimeout(180_000)
  const world = await provisionWorld()
  const page = await signedInPage(browser, world.adminA, {
    viewport: { width: 360, height: 780 },
  })
  await importRailwayDraft(page, world.venue1)
  const saveBar = page.getByRole("button", { name: "Save draft" })
  await expect(saveBar).toBeVisible()
  // Not vacuous: the editor lists sections to measure.
  const names = page.locator("h3 > button > span.truncate")
  expect(await names.count()).toBeGreaterThan(5)
  await attachShot(testInfo, "draft-editor-360", page)

  const clipped = await names.evaluateAll((els) =>
    els
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => el.textContent ?? "")
  )
  expect
    .soft(
      clipped,
      `${OBSERVED} section names clipped at 360px: ${clipped.join(", ")}`
    )
    .toEqual([])

  const tops = await Promise.all(
    ["Save draft", "Activate…", "Discard draft…"].map(async (name) => {
      const box = await page.getByRole("button", { name }).boundingBox()
      return Math.round(box!.y)
    })
  )
  expect
    .soft(
      Math.max(...tops) - Math.min(...tops),
      `${OBSERVED} the save bar buttons wrap onto ${new Set(tops).size} rows at 360px`
    )
    .toBeLessThanOrEqual(2)
})

test("menus.o3-usage-docs: the usage guides describe Menus, labelling and the library label filters", () => {
  const staff = readFileSync(repo("docs/usage-staff.md"), "utf8")
  const admin = readFileSync(repo("docs/usage-admin.md"), "utf8")
  expect(staff.length).toBeGreaterThan(0)
  expect(admin.length).toBeGreaterThan(0)
  for (const phrase of [
    "Add labels",
    "Label these files",
    "Item not on the menu?",
  ]) {
    expect(staff, `usage-staff.md mentions "${phrase}"`).toContain(phrase)
  }
  for (const phrase of [
    "More filters",
    "Edit labels",
    "Menus",
    "Activate",
    "Retire",
    "Archive",
  ]) {
    expect(admin, `usage-admin.md mentions "${phrase}"`).toContain(phrase)
  }
})

// A config decision: whether the phone project should also run the menus
// specs. The narrow check is that the staff labelling flow runs on it.
test("menus.o4-phone-project: the mobile-chromium project selects the staff labelling flow", () => {
  const config = readFileSync(repo("playwright.config.ts"), "utf8")
  const literal = config.match(/const PHONE =\s*\/(.+)\/\s*$/m)
  expect(literal, "PHONE regex found in playwright.config.ts").not.toBeNull()
  const phone = new RegExp(literal![1])
  expect(
    phone.test("mobile-chromium menus-labels.spec.ts staff labelling"),
    `${OBSERVED} the mobile-chromium grep does not select tests/e2e/menus-labels.spec.ts`
  ).toBe(true)
})

test("menus.o5-early-file-choice: a menu file chosen before the page hydrates is still previewed", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const world = await provisionWorld()
  const page = await signedInPage(browser, world.adminA)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route(/\/_next\/static\/.*\.js/, async (route) => {
    await gate
    await route.continue()
  })

  await page.goto(`/admin/menus/${world.venue1.id}`, { waitUntil: "commit" })
  const input = page.getByLabel("Menu file (JSON or CSV)")
  await expect(
    input,
    "the file input is in the server-rendered page"
  ).toBeAttached()
  await input.setInputFiles(RAILWAY)
  release()

  await expect(
    page.getByRole("heading", { level: 1, name: world.venue1.name })
  ).toBeVisible()
  const preview = page.getByRole("heading", { name: /^Preview:/ })
  const shown = await preview
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(
      () => true,
      () => false
    )
  await attachShot(testInfo, "after-hydration", page)
  expect(
    shown,
    `${OBSERVED} a file chosen before hydration is ignored (no preview appeared)`
  ).toBe(true)
})
