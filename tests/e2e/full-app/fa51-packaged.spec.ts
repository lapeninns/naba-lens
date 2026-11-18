import { expect, test, type Page } from "@playwright/test"

import { labelledPhoto, provisionManagerWorld } from "../helpers/manager-world"
import { psql, requireIsolatedStack } from "../helpers/stack"
import {
  acceptAsManager,
  as,
  closeAll,
  DESKTOP,
  evidence,
  expectNoSidewaysScroll,
  PHONE,
  sql,
} from "./helpers"

/**
 * FA-51 (spec §4.2; AC39): packaged drinks. A manager marks a drink
 * Packaged on its item page (one confirm, no reason); it stays listed for
 * staff, reads Optional and leaves every count. The expected numbers are
 * counted here from private.coverage_slot_rows, independently of the pages,
 * and must match metrics, How this is counted, the manager Overview and the
 * admin Overview. An admin then marks it Photo wanted on the venue's menus
 * page and it counts again.
 *
 * S5-R1 (review Y1, Y2): the older menu-photo screens follow the same rule.
 * The manager Overview's "Menu photos" heading and its "with no ready photo"
 * tally match the rule's dish rows; the manager Menu "Still needs a photo"
 * filter and staff Our menu "Still needs a photo" leave the lager out, and
 * their full lists show it as Optional.
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

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`

/** The rule's dish rows: covered, counted and empty (nothing waiting). */
function dishCounts(venueId: string) {
  const [covered, total, empty] = psql(`select
      count(*) filter (where state = 'covered'),
      count(*) filter (where state <> 'inactive'),
      count(*) filter (where state in ('missing', 'replacement_needed'))
    from private.coverage_slot_rows(${sql(venueId)}::uuid)
    where slot_kind = 'dish'`)
    .split("|")
    .map(Number)
  return { covered: covered!, total: total!, empty: empty! }
}

/** A dish's row on a menu list, found by its exact name. */
const dishRow = (page: Page, name: string) =>
  page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })

/** A place's "n empty of N": its empty slots and its total. */
async function placeCount(
  page: Page
): Promise<{ empty: number; total: number }> {
  const line = page.getByText(/^\d+ empty of \d+$/).first()
  await expect(line).toBeVisible()
  const m = /(\d+) empty of (\d+)/.exec((await line.textContent()) ?? "")!
  return { empty: Number(m[1]), total: Number(m[2]) }
}

test("FA-51: a packaged drink without Photo wanted reads Optional and leaves every count (AC39)", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const soup = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
  await acceptAsManager(w.mgrA, soup, w.itemsA.soup)
  const before = counts(w.venueA.id, null)
  expect(counts(w.venueA.id, "drinks")).toEqual({ covered: 0, total: 1 })

  // Staff, phone: the lager is an ordinary empty slot first.
  const staff = await as(browser, w.staffA1, PHONE)
  await staff.goto("/staff/album/unplaced")
  const lagerTile = staff.locator(
    `[data-slot="slot-tile"][aria-label^="Lager:"]`
  )
  await expect(lagerTile).toHaveAttribute("aria-label", "Lager: needed")
  const placeBefore = await placeCount(staff)

  // Manager, phone: Packaged on the item page, one confirm, no reason.
  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto(`/manager/menu/${w.itemsA.lager}`)
  const control = mgr.locator('[data-slot="packaging-control"]')
  await expect(control.getByTestId("packaging-state")).toHaveText(
    "Counts in coverage."
  )
  await control.getByRole("switch", { name: /Packaged/ }).click()
  const dialog = mgr.getByRole("alertdialog")
  await expect(dialog).toContainText("Mark Lager as packaged?")
  await expect(dialog.getByRole("textbox")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Mark as packaged" }).click()
  await expect(control.getByTestId("packaging-state")).toHaveText(
    "Packaged. Optional: not counted in coverage."
  )
  await expectNoSidewaysScroll(mgr, "item page at 390 px")
  await evidence(mgr, "fa51-manager-item-390")

  // Counted independently: the lager left the total, nothing else moved.
  const drinks = counts(w.venueA.id, "drinks")
  const food = counts(w.venueA.id, "food")
  const all = counts(w.venueA.id, null)
  expect(drinks).toEqual({ covered: 0, total: 0 })
  expect(all).toEqual({ covered: before.covered, total: before.total - 1 })

  // Staff, phone: still listed, reads Optional, out of the album count.
  await staff.reload()
  await expect(lagerTile).toHaveAttribute("aria-label", "Lager: optional")
  await expect(lagerTile).toContainText("Optional")
  await expect(lagerTile).toHaveAttribute("data-optional", "true")
  expect(await placeCount(staff)).toEqual({
    empty: placeBefore.empty - 1,
    total: placeBefore.total - 1,
  })
  await expectNoSidewaysScroll(staff, "album at 390 px")
  await evidence(staff, "fa51-staff-album-390")
  await lagerTile.click()
  await expect(staff.locator('[data-slot="slot-optional"]')).toHaveText(
    "Optional: a photo is welcome, but none is needed."
  )
  await expect(
    staff.getByRole("button", { name: "Add a photo for this slot" })
  ).toBeVisible()
  await evidence(staff, "fa51-staff-slot-390")

  // Staff, phone: Our menu lists the lager as Optional, never as a gap (Y2).
  await staff.goto("/staff/menu")
  await expect(dishRow(staff, "Lager")).toContainText("Optional")
  await expect(dishRow(staff, "Lager")).not.toContainText("Still needs a photo")
  await expectNoSidewaysScroll(staff, "our menu at 390 px")
  await evidence(staff, "fa51-staff-our-menu-390")
  await staff.goto("/staff/menu?filter=gaps")
  await expect(dishRow(staff, "Salad")).toBeVisible()
  await expect(dishRow(staff, "Lager")).toHaveCount(0)

  // Manager, desktop: metrics and How this is counted say the same.
  const desk = await as(browser, w.mgrA, DESKTOP)
  await desk.goto("/manager/metrics")
  const report = desk.locator('[data-slot="metrics-report"]')
  const coverage = report.locator("section#coverage")
  await expect(coverage.locator('tr[data-category="food"]')).toContainText(
    ofN(food)
  )
  await expect(
    coverage.locator(":scope > div").first().locator("span").first()
  ).toContainText(ofN(all))
  const how = report.locator("section#how-counted")
  await expect(how.locator('[data-slot="reproduced"]')).toHaveText(
    `Counting the slots below gives ${all.covered} of ${all.total} covered.`
  )
  const optional = how.locator('details[data-state="inactive"]')
  await optional.locator("summary").click()
  await expect(optional).toContainText("No photo needed")
  await expect(optional.locator("li")).toContainText(["Lager"])
  await evidence(desk, "fa51-how-counted-1280")

  // Manager Overview and admin Overview: the same n of N.
  await desk.goto("/manager")
  const overview = desk.locator('[data-slot="overview-coverage"]')
  await expect(overview.locator('li[data-category="food"]')).toContainText(
    ofN(food)
  )
  // Y1: the Overview's own Menu photos heading and tally read the rule too.
  const dishes = dishCounts(w.venueA.id)
  await expect(
    desk.getByRole("heading", {
      name: `Menu photos · ${dishes.covered} of ${items(dishes.total)} covered`,
    })
  ).toBeVisible()
  await expect(
    desk.getByText(`${items(dishes.empty)} with no ready photo`)
  ).toBeVisible()
  await evidence(desk, "fa51-manager-overview-1280")

  // Y2: Menu's "Still needs a photo" leaves it out; the full list says Optional.
  await desk.goto("/manager/menu?status=needs_photo")
  await expect(dishRow(desk, "Salad")).toBeVisible()
  await expect(dishRow(desk, "Lager")).toHaveCount(0)
  await desk.goto("/manager/menu")
  await expect(dishRow(desk, "Lager")).toContainText("Optional")
  await expect(dishRow(desk, "Lager")).not.toContainText("Still needs a photo")
  await expectNoSidewaysScroll(desk, "manager menu at 1280 px")
  await evidence(desk, "fa51-manager-menu-1280")
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

  // Admin, desktop: Photo wanted on the venue's menus page counts it again.
  await admin.goto(`/admin/menus/${w.venueA.id}`)
  const lagerRow = admin.locator(
    `[data-slot="packaging-row"][data-item="${w.itemsA.lager}"]`
  )
  await expect(lagerRow).toContainText(
    "Packaged. Optional: not counted in coverage."
  )
  await lagerRow.getByRole("switch", { name: /Photo wanted/ }).click()
  const ask = admin.getByRole("alertdialog")
  await expect(ask).toContainText("Ask for a photo of Lager?")
  await ask.getByRole("button", { name: "Ask for a photo" }).click()
  await expect(lagerRow).toContainText(
    "Packaged. A photo is wanted, so it counts in coverage."
  )
  await expectNoSidewaysScroll(admin, "admin menus at 1280 px")
  await evidence(admin, "fa51-admin-menus-1280")
  expect(counts(w.venueA.id, "drinks")).toEqual({ covered: 0, total: 1 })
  expect(counts(w.venueA.id, null)).toEqual(before)

  await staff.goto("/staff/album/unplaced")
  await expect(lagerTile).toHaveAttribute("aria-label", "Lager: needed")
  expect(await placeCount(staff)).toEqual(placeBefore)
})

test("FA-51 layout: the admin's packaged list reads at 390 px", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const admin = await as(browser, w.admin, PHONE)
  await admin.goto(`/admin/menus/${w.venueA.id}`)
  const lagerRow = admin.locator(
    `[data-slot="packaging-row"][data-item="${w.itemsA.lager}"]`
  )
  await expect(lagerRow).toContainText("Counts in coverage.")
  await expectNoSidewaysScroll(admin, "admin menus at 390 px")
  await evidence(admin, "fa51-admin-menus-390")
})
