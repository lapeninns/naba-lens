import { expect, test } from "@playwright/test"

import { labelledPhoto, provisionManagerWorld } from "../helpers/manager-world"
import { psql, requireIsolatedStack } from "../helpers/stack"
import {
  acceptAsManager,
  as,
  closeAll,
  DESKTOP,
  evidence,
  expectNoSidewaysScroll,
  NARROW,
  PHONE,
  sql,
} from "./helpers"

/**
 * AC39 (spec §18, §22; FA-8, FA-30): every coverage number reproduces from
 * its slots. The expected numerator and denominator are counted here from the
 * one coverage function (private.coverage_slot_rows), independently of the
 * page, and must match the manager's metrics and its "How this is counted"
 * slot lists, the manager Overview and the admin Overview.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

type Counts = { covered: number; total: number }

function counts(venueId: string, category: string | null): Counts {
  const [covered, total] = psql(`select
      count(*) filter (where state = 'covered'),
      count(*) filter (where state not in ('not_here', 'inactive'))
    from private.coverage_slot_rows(${sql(venueId)}::uuid)
    ${category ? `where category = ${sql(category)}` : ""}`)
    .split("|")
    .map(Number)
  return { covered: covered!, total: total! }
}

const ofN = ({ covered, total }: Counts) => `${covered} of ${total}`

test("AC39: the coverage numbers on metrics, Overview and admin Overview reproduce from the counted slots", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  // One accepted dish, one waiting, the rest missing.
  const soup = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
  await acceptAsManager(w.mgrA, soup, w.itemsA.soup)
  await labelledPhoto(w.staffA2, w.venueA, [w.itemsA.salad])

  const food = counts(w.venueA.id, "food")
  const drinks = counts(w.venueA.id, "drinks")
  const all = counts(w.venueA.id, null)
  expect(food).toEqual({ covered: 1, total: 3 })
  expect(drinks).toEqual({ covered: 0, total: 1 })

  const mgr = await as(browser, w.mgrA, DESKTOP)
  await mgr.goto("/manager/metrics")
  const report = mgr.locator('[data-slot="metrics-report"]')
  const coverage = report.locator("section#coverage")
  await expect(coverage.locator('tr[data-category="food"]')).toContainText(
    ofN(food)
  )
  await expect(coverage.locator('tr[data-category="drinks"]')).toContainText(
    ofN(drinks)
  )
  // The count beside the "Photo coverage" title.
  await expect(
    coverage.locator(":scope > div").first().locator("span").first()
  ).toContainText(ofN(all))

  // How this is counted: the slots, by state, give the same numbers.
  const how = report.locator("section#how-counted")
  await expect(how.locator('[data-slot="reproduced"]')).toHaveText(
    `Counting the slots below gives ${all.covered} of ${all.total} covered.`
  )
  const listed = async (state: string) => {
    const group = how.locator(`details[data-state="${state}"]`)
    if ((await group.count()) === 0) return 0
    await group.locator("summary").click()
    return group.locator("li").count()
  }
  const covered = await listed("covered")
  let counted = 0
  for (const state of [
    "covered",
    "check_due",
    "pending",
    "replacement_needed",
    "missing",
  ])
    counted += await listed(state)
  expect({ covered, total: counted }).toEqual(all)
  await expect(how.locator('details[data-state="covered"] li')).toContainText([
    "Soup",
  ])
  await evidence(mgr, "ac39-how-counted")

  // Manager Overview: same n of N per category.
  await mgr.goto("/manager")
  const overview = mgr.locator('[data-slot="overview-coverage"]')
  await expect(overview.locator('li[data-category="food"]')).toContainText(
    ofN(food)
  )
  await expect(overview.locator('li[data-category="drinks"]')).toContainText(
    ofN(drinks)
  )

  // Admin Overview: the venue's row says the same.
  const admin = await as(browser, w.admin, DESKTOP)
  await admin.goto(`/admin/overview?venue=${w.venueA.id}`)
  const row = admin.locator(
    `[data-testid="overview-row"][data-venue="${w.venueA.id}"]`
  )
  await expect(
    row.getByRole("link", {
      name: `Food at ${w.venueA.name}: ${ofN(food)} covered`,
    })
  ).toBeVisible()
  await expect(
    row.getByRole("link", {
      name: `Drinks at ${w.venueA.name}: ${ofN(drinks)} covered`,
    })
  ).toBeVisible()
  await evidence(admin, "ac39-admin-overview")
})

test("AC39 layout: metrics and How this is counted read at 390 and 320 px", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const soup = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
  await acceptAsManager(w.mgrA, soup, w.itemsA.soup)
  const food = counts(w.venueA.id, "food")
  for (const [name, size] of [
    ["390", PHONE],
    ["320", NARROW],
  ] as const) {
    const mgr = await as(browser, w.mgrA, size)
    await mgr.goto("/manager/metrics")
    await expect(
      mgr.locator('section#coverage tr[data-category="food"]')
    ).toContainText(ofN(food))
    await expectNoSidewaysScroll(mgr, `metrics at ${name} px`)
    await evidence(mgr, `ac39-metrics-${name}`)
  }
})
