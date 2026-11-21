import { expect, test } from "@playwright/test"

import { signIn } from "../../support/identities"
import {
  addPhotos,
  assetNamed,
  dishesOn,
  keep,
  labelNow,
  labelSearch,
  openAlbum,
  placesOn,
  SIZES,
  slotChoice,
  sql,
  tickPhotos,
  uploadStateOf,
  waitPosted,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { provisioner, psql } from "../helpers/stack"
import { signedInPage } from "../helpers/world"

/**
 * AC03 (spec §5.3, FA-4), for posting first (D21): the photo has posted, and
 * on Label photos the right item can't be found, so staff ask their manager
 * (I'm not sure), the words they searched for going with it as the note.
 * The photo carries no label and no slot, and the venue manager sees it in
 * the MAIN Review queue as Needs label, with the note.
 */

/** Label photos' I'm not sure ("Ask my manager…" once a search found nothing). */
const notSure = /^(I'm not sure|Ask my manager)/

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

for (const size of ["phone", "desktop"] as const) {
  test(`AC03 I'm not sure sends the photo to the manager's main queue as Needs label (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const w = await provisionManagerWorld()
    const photo = await syntheticJpeg(`ac03-${size}-${w.tag}.jpg`)
    const note = `Lamb shank special ${w.tag}`

    const page = await signedInPage(browser, w.staffA1, SIZES[size])
    await openAlbum(page)
    await addPhotos(page, [photo.path])
    await waitPosted(page, 1)
    const id = await assetNamed(photo.name)
    const screen = await labelNow(page)
    await tickPhotos(screen, [id])
    // Search finds nothing for it.
    await labelSearch(screen).fill(note)
    await expect(
      screen.locator('[data-slot="match-search-empty"]')
    ).toContainText(`Nothing called "${note}".`)
    // The words searched for go to the manager as the note.
    await screen
      .getByRole("button", { name: `Ask my manager about “${note}”` })
      .click()
    await expect(screen.locator('[data-slot="label-handed"]')).toHaveText(
      "1 photo is with your manager, who will choose its label."
    )
    await keep(page, info, `ac03-${size}-staff-handed`)

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
  await addPhotos(staff, [photo.path])
  await waitPosted(staff, 1)
  const asset = await assetNamed(photo.name)
  const screen = await labelNow(staff)
  await tickPhotos(screen, [asset])
  const search = labelSearch(screen)
  await search.fill("Soup")
  await expect(slotChoice(screen, "French onion potage")).toBeVisible()
  await search.fill(special)
  await screen.getByRole("button", { name: "It's food" }).click()
  await expect(screen.getByText(/is suggested to your manager/)).toBeVisible()
  await screen.getByRole("button", { name: notSure }).click()
  await expect(screen.locator('[data-slot="label-handed"]')).toContainText(
    "with your manager"
  )
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
