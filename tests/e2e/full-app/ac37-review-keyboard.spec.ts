import { expect, test, type Locator, type Page } from "@playwright/test"

import { labelledPhoto, provisionManagerWorld } from "../helpers/manager-world"
import { psql, requireIsolatedStack } from "../helpers/stack"
import { as, closeAll, DESKTOP, evidence, PHONE, sql } from "./helpers"

/**
 * AC37, review flows (spec §15, §22): review and its feedback work from the
 * keyboard, with names a screen reader announces. No pointer events: every
 * control is focused and pressed with the keyboard, and the test checks the
 * accessible names, roles and states it relies on.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

async function press(page: Page, target: Locator, key = "Enter") {
  // The page may still move focus once while it settles after loading.
  await expect(async () => {
    await target.focus()
    await expect(target).toBeFocused({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
  await page.keyboard.press(key)
}

const decided = (asset: string) =>
  psql(`select coalesce(string_agg(state || ':' || review_level, ','), '')
    from public.menu_item_photos where asset_id = ${sql(asset)}::uuid`)

test("AC37: a manager decides one photo from the keyboard and focus lands on the result", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])

  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto(`/manager/review/photo/${asset}`)
  const approve = mgr.getByRole("button", { name: "Approve for public use" })
  await expect(approve).toBeVisible()
  // Reached by Tab from the top of the page, not only by focus().
  await mgr.keyboard.press("Tab")
  let reached = false
  for (let i = 0; i < 60 && !reached; i++) {
    reached = await approve.evaluate((el) => el === document.activeElement)
    if (!reached) await mgr.keyboard.press("Tab")
  }
  expect(reached, "Approve for public use is reachable with Tab").toBe(true)
  await mgr.keyboard.press("Enter")
  await expect(mgr.getByText("Saved.")).toBeVisible()
  // Feedback is announced and focused, so the result is read out.
  const focusedText = await mgr.evaluate(
    () => document.activeElement?.textContent ?? ""
  )
  expect(focusedText).toContain("Saved.")
  expect(decided(asset)).toBe("accepted:public")
  await evidence(mgr, "ac37-keyboard-decision")
})

test("AC37: Decide several works from the keyboard and the confirmation shows exactly the chosen photos", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const soup = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
  const salad = await labelledPhoto(w.staffA2, w.venueA, [w.itemsA.salad])
  const lager = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.lager])

  const mgr = await as(browser, w.mgrA, DESKTOP)
  await mgr.goto("/manager/review?view=list")
  const toggle = mgr.locator("[data-batch-toggle]")
  await press(mgr, toggle)
  await expect(toggle).toHaveAttribute("aria-expanded", "true")

  const choose = mgr.getByRole("list", {
    name: "Choose photos to decide together",
  })
  const card = (item: string, who: string) =>
    choose.getByRole("checkbox", { name: `${item}, photo by ${who}` })
  for (const [item, who] of [
    ["Soup", w.staffA1.name],
    ["Salad", w.staffA2.name],
  ]) {
    await press(mgr, card(item!, who!), " ")
    await expect(card(item!, who!)).toHaveAttribute("aria-checked", "true")
  }
  await expect(card("Lager", w.staffA1.name)).toHaveAttribute(
    "aria-checked",
    "false"
  )
  await expect(mgr.getByText("2 photos chosen")).toBeVisible()

  await press(
    mgr,
    mgr.getByRole("button", { name: "Approve for public use (2)" })
  )
  const dialog = mgr.getByRole("dialog", {
    name: "Approve for public use: 2 photos",
  })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator("[data-batch-confirm] li")).toHaveCount(2)
  await expect(dialog.locator("[data-batch-confirm] img")).toHaveCount(2)
  await evidence(mgr, "ac37-batch-confirm")
  await press(mgr, dialog.locator("[data-batch-confirm-button]"))
  await expect(mgr.getByText("2 photos decided.")).toBeVisible()

  expect(decided(soup)).toBe("accepted:public")
  expect(decided(salad)).toBe("accepted:public")
  expect(decided(lager)).toBe("")
})
