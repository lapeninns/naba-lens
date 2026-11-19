import { expect, test } from "@playwright/test"

import { signIn } from "../../support/identities"
import {
  assetNamed,
  dishesOn,
  keep,
  matchSummary,
  openAlbum,
  placesOn,
  SIZES,
  slotChoice,
  sql,
  startMatch,
  uploadStateOf,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { provisioner, psql } from "../helpers/stack"
import { signedInPage } from "../helpers/world"

/**
 * AC03 (spec §5.3, FA-4): the right item can't be found, so staff choose
 * I'm not sure (with an optional note). The photo is sent, carries no label
 * and no slot, and the venue manager sees it in the MAIN Review queue as
 * Needs label, with the note.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

for (const size of ["phone", "desktop"] as const) {
  test(`AC03 I'm not sure sends the photo to the manager's main queue as Needs label (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const w = await provisionManagerWorld()
    const photo = await syntheticJpeg(`ac03-${size}-${w.tag}.jpg`)
    const note = `Tonight's special, not on the menu (${w.tag})`

    const page = await signedInPage(browser, w.staffA1, SIZES[size])
    await openAlbum(page)
    const { match } = await startMatch(page, [photo.path])
    // Search finds nothing for it.
    await match
      .getByRole("searchbox", { name: "Search all slots" })
      .fill("lamb shank")
    await expect(
      match.locator('[data-slot="match-search-empty"]')
    ).toContainText('No slot matches "lamb shank".')
    // The note is optional and collapsed; this person adds one.
    await match.getByRole("button", { name: "Add a note" }).click()
    await match
      .getByRole("textbox", { name: "Note for your manager (optional)" })
      .fill(note)
    await match.getByRole("button", { name: /^I'm not sure/ }).click()
    await expect(matchSummary(page)).toBeVisible()
    await expect(page.locator('[data-slot="match-summary-unsure"]')).toHaveText(
      "1 photo is with your manager, who will choose its slot."
    )
    await keep(page, info, `ac03-${size}-staff-summary`)

    const id = await assetNamed(photo.name)
    await expect
      .poll(() => uploadStateOf(id), { timeout: 60_000 })
      .toBe("ready")
    // No label and no slot were made up for it (§5.3).
    expect(dishesOn(id)).toBe("")
    expect(placesOn(id)).toBe("")
    await page.context().close()

    // The manager's main Review queue shows it as Needs label, with the note.
    const manager = await signedInPage(browser, w.mgrA, SIZES[size])
    await manager.goto("/manager/review")
    await expect(manager.getByRole("heading", { level: 1 })).toBeVisible()
    await keep(manager, info, `ac03-${size}-manager-review`)
    const link = manager.locator(`a[href*="${id}"]`).first()
    await expect(link).toBeVisible({ timeout: 30_000 })
    const card = manager
      .getByRole("listitem")
      .filter({ has: manager.locator(`a[href*="${id}"]`) })
      .last()
    await expect(card).toContainText("Needs label")
    await expect(card).toContainText(note)
    await keep(manager, info, `ac03-${size}-manager-queue`)
    await manager.context().close()
  })
}

test("staff can search by the original dish name and a manager can approve a photo for a staff-suggested special", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const w = await provisionManagerWorld()
  const special = "Venison and juniper"
  const photo = await syntheticJpeg(`special-${w.tag}.jpg`)
  const managerDb = await signIn(provisioner(), w.mgrA.email)
  const rename = await managerDb.rpc("menu_item_display_name_set", {
    p_item_id: w.itemsA.soup,
    p_name: "French onion potage",
    p_reason: "TEST local display name",
  })
  expect(rename.error).toBeNull()

  const staff = await signedInPage(browser, w.staffA1, SIZES.phone)
  await openAlbum(staff)
  const { match } = await startMatch(staff, [photo.path])
  const search = match.getByRole("searchbox", { name: "Search all slots" })
  await search.fill("Soup")
  await expect(slotChoice(match, "French onion potage")).toBeVisible()
  await search.fill(special)
  await match.getByRole("button", { name: "It's food" }).click()
  await expect(match.getByText(/is suggested to your manager/)).toBeVisible()
  await match.getByRole("button", { name: /^I'm not sure/ }).click()
  await expect(matchSummary(staff)).toContainText("with your manager")
  const asset = await assetNamed(photo.name)
  await expect
    .poll(() => uploadStateOf(asset), { timeout: 60_000 })
    .toBe("ready")
  await staff.context().close()

  const manager = await signedInPage(browser, w.mgrA, SIZES.desktop)
  await manager.goto("/manager/menu/specials")
  const proposal = manager.getByRole("listitem").filter({ hasText: special })
  await proposal.getByRole("button", { name: "Accept", exact: true }).click()
  await expect(proposal).toContainText("Running")
  await manager.goto(`/manager/review/photo/${asset}`)
  await manager.locator('[data-review-action="fix-label"]').click()
  const dialog = manager.getByRole("dialog", { name: "Fix label" })
  await dialog.getByRole("searchbox", { name: "Search the menu" }).fill(special)
  await dialog.getByRole("radio", { name: new RegExp(`^${special}`) }).check()
  await dialog.getByRole("button", { name: `Approve for ${special}` }).click()
  await expect(dialog).not.toBeVisible()
  await expect(manager.getByText("Saved.")).toBeVisible()
  expect(
    psql(`select s.name || ':' || r.state from public.menu_specials s
    join private.coverage_slot_rows(${sql(w.venueA.id)}::uuid) r on r.slot_id = s.item_id
    where s.venue_id = ${sql(w.venueA.id)}::uuid and r.primary_asset_id = ${sql(asset)}::uuid`)
  ).toBe(`${special}:covered`)
  await manager.context().close()
})
