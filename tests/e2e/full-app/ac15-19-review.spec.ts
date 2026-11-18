import { expect, test, type Page } from "@playwright/test"

import {
  convertToManager,
  labelledPhoto,
  photoRow,
  provisionManagerWorld,
} from "../helpers/manager-world"
import { psql, requireIsolatedStack } from "../helpers/stack"
import {
  as,
  closeAll,
  DESKTOP,
  evidence,
  expectNoSidewaysScroll,
  NARROW,
  PHONE,
  SIZES,
  sql,
} from "./helpers"

/**
 * AC15 to AC19 (spec §7 M2, §22): the manager's photo detail
 * (/manager/review/photo/[assetId], S2-REVIEW). Staff photos are seeded with
 * real derivatives and labelled by the uploader's own session; every decision
 * is made on the page. The database is read only to check what a page did.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

const action = (page: Page, name: string) =>
  page.locator(`[data-review-action="${name}"]`).filter({ visible: true })

const detail = (assetId: string) => `/manager/review/photo/${assetId}`

const slotState = (venueId: string, itemId: string) =>
  psql(`select state from private.coverage_slot_rows(${sql(venueId)}::uuid)
    where slot_id = ${sql(itemId)}::uuid`)

const assetsBy = (uploaderId: string) =>
  psql(
    `select count(*) from public.media_assets where uploader_id = ${sql(uploaderId)}::uuid`
  )

const CONFLICT = "Someone else decided this photo first"

for (const [size, options] of SIZES) {
  test(`AC15 (${size}): the manager fixes a wrong staff label without asking for another upload`, async ({
    browser,
  }) => {
    const w = await provisionManagerWorld()
    // The photo shows the pie; the staff member labelled it Soup.
    const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
    const before = assetsBy(w.staffA1.id)

    const mgr = await as(browser, w.mgrA, options)
    await mgr.goto(detail(asset))
    await expect(
      mgr.getByRole("heading", { level: 1, name: "Photo review" })
    ).toBeVisible()
    await action(mgr, "fix-label").first().click()
    const dialog = mgr.getByRole("dialog", { name: "Fix label" })
    await dialog.getByRole("searchbox", { name: "Search the menu" }).fill("Pie")
    await dialog.getByRole("radio", { name: /^Pie/ }).check()
    await dialog
      .getByRole("textbox", { name: "Why is the staff label wrong?" })
      .fill("It is the pie, not the soup")
    await dialog.getByRole("button", { name: "Accept for Pie" }).click()
    await expect(mgr.getByText("Saved.")).toBeVisible()
    await evidence(mgr, `ac15-fixed-${size.replace(" ", "-")}`)

    // Accepted under the right dish, recorded as a correction of the label.
    expect(photoRow(asset)).toBe(
      `${w.itemsA.pie}:accepted:reviewer:${w.itemsA.soup}`
    )
    // No new upload was needed.
    expect(assetsBy(w.staffA1.id)).toBe(before)

    // The contributor is told, with nothing to do.
    const staff = await as(browser, w.staffA1, PHONE)
    await staff.goto("/staff/notifications")
    await expect(staff.getByText("Label corrected: Pie")).toBeVisible()
    await expect(
      staff.getByText("You labelled it Soup. Nothing to do.")
    ).toBeVisible()
  })
}

test("AC16: Keep as reference stores the photo but the dish's public-photo slot stays open", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.salad])
  expect(slotState(w.venueA.id, w.itemsA.salad)).toBe("pending")

  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto(detail(asset))
  await action(mgr, "keep-reference").first().click()
  await expect(mgr.getByText("Saved.")).toBeVisible()
  await expect(mgr.getByText("Kept as reference").first()).toBeVisible()
  await expect(mgr.locator("ol[data-review-history]")).toContainText(
    "kept as reference"
  )
  // The level can still be switched to public later.
  await expect(action(mgr, "approve").first()).toBeVisible()
  await evidence(mgr, "ac16-kept-as-reference")

  expect(
    psql(`select state || ':' || review_level from public.menu_item_photos
      where asset_id = ${sql(asset)}::uuid`)
  ).toBe("accepted:reference")
  // Stored, but the public-photo requirement is still open.
  expect(
    psql(`select count(*) from public.menu_item_photos
      where item_id = ${sql(w.itemsA.salad)}::uuid and state = 'accepted' and review_level = 'public'`)
  ).toBe("0")
  expect(slotState(w.venueA.id, w.itemsA.salad)).not.toBe("covered")
  expect(
    psql(`select count(*) from public.media_assets
      where id = ${sql(asset)}::uuid and deleted_at is null`)
  ).toBe("1")
})

test("AC17: Ask for another photo gives the reason to the contributor, and Retake opens the same dish", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const asset = await labelledPhoto(w.staffA2, w.venueA, [w.itemsA.lager])
  const note = `Needs more light on the bar ${w.tag}`

  const mgr = await as(browser, w.mgrA, DESKTOP)
  await mgr.goto(detail(asset))
  await action(mgr, "ask-another").first().click()
  const dialog = mgr.getByRole("dialog", {
    name: "Ask for another photo: Lager",
  })
  await dialog.getByRole("button", { name: "Too dark" }).click()
  await expect(
    dialog.getByRole("button", { name: "Too dark" })
  ).toHaveAttribute("aria-pressed", "true")
  await dialog.getByLabel("Add a short note (optional)").fill(note)
  await dialog.locator('[data-review-action="send-ask"]').click()
  await expect(mgr.getByText("Saved.")).toBeVisible()
  await expect(mgr.getByText("Another photo asked for").first()).toBeVisible()

  expect(
    psql(`select state || '|' || reason from public.menu_item_photos
      where asset_id = ${sql(asset)}::uuid`)
  ).toBe(`better_photo_requested|Too dark. ${note}`)

  // The contributor sees the specific reason; Retake opens the same dish.
  const staff = await as(browser, w.staffA2, PHONE)
  await staff.goto("/staff/notifications")
  await expect(staff.getByText("Retake: Lager")).toBeVisible()
  await expect(staff.getByText(`Too dark. ${note}`).first()).toBeVisible()
  await staff.getByText("Retake: Lager").click()
  await expect(staff).toHaveURL(
    new RegExp(`/staff/album/slot/dish/${w.itemsA.lager}$`)
  )
  const retake = staff.locator('[data-slot="slot-retake"]')
  await expect(retake).toContainText("You were asked to retake this")
  await expect(retake).toContainText(`Too dark. ${note}`)
  await evidence(staff, "ac17-retake-slot")
})

test("AC18: when two managers decide the same photo, the second is told and nothing is overwritten", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  // A second manager at venue A (the second staff account, converted).
  await convertToManager(w.adminDb, w.staffA2, w.venueA)
  const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])

  const first = await as(browser, w.mgrA, DESKTOP)
  const second = await as(browser, w.staffA2, PHONE)
  await first.goto(detail(asset))
  await second.goto(detail(asset))
  await expect(action(first, "approve").first()).toBeVisible()
  await expect(action(second, "keep-reference").first()).toBeVisible()

  await action(first, "approve").first().click()
  await expect(first.getByText("Saved.")).toBeVisible()

  await action(second, "keep-reference").first().click()
  await expect(second.getByText(CONFLICT)).toBeVisible()
  await expect(
    second.getByText(
      "Here is the latest. Check it before you decide again; nothing was changed."
    )
  ).toBeVisible()
  await evidence(second, "ac18-conflict")

  // The first decision stands.
  expect(
    psql(`select state || ':' || review_level from public.menu_item_photos
      where asset_id = ${sql(asset)}::uuid`)
  ).toBe("accepted:public")
})

test("AC19: a dish whose presentation changes during review cannot be approved against the old version", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  await convertToManager(w.adminDb, w.staffA2, w.venueA)
  const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.pie])
  const change = `New pastry lid ${w.tag}`

  const reviewer = await as(browser, w.mgrA, DESKTOP)
  await reviewer.goto(detail(asset))
  await expect(action(reviewer, "approve").first()).toBeVisible()

  // Meanwhile the other manager records the presentation change.
  const other = await as(browser, w.staffA2, DESKTOP)
  await other.goto(`/manager/menu/${w.itemsA.pie}`)
  await other.getByLabel("What changed").fill(change)
  await other.getByRole("button", { name: "Mark as changed" }).click()
  await expect(other.getByText(/^Recorded\./)).toBeVisible()

  // The open page still holds the old version: approval is refused.
  await action(reviewer, "approve").first().click()
  await expect(reviewer.getByText(CONFLICT)).toBeVisible()
  expect(photoRow(asset)).toBe("")
  await evidence(reviewer, "ac19-stale-refused")

  // After the refresh the page shows the new presentation, and a decision
  // binds to it.
  await expect(reviewer.getByText(`Presentation 2: ${change}`)).toBeVisible()
  await action(reviewer, "approve").first().click()
  await expect(reviewer.getByText("Saved.")).toBeVisible()
  expect(photoRow(asset)).toMatch(/:accepted:/)
})

test("AC15-AC19 layout: the photo detail and its dialogs fit a 320 px phone", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
  const mgr = await as(browser, w.mgrA, NARROW)
  await mgr.goto(detail(asset))
  await expect(action(mgr, "approve").first()).toBeVisible()
  await expectNoSidewaysScroll(mgr, "photo detail at 320 px")
  await action(mgr, "ask-another").first().click()
  await expect(mgr.getByRole("dialog")).toBeVisible()
  await expectNoSidewaysScroll(mgr, "ask-another dialog at 320 px")
  await evidence(mgr, "ac17-dialog-320")
})
