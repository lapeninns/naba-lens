import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../support/identities"
import {
  legacyStaffGrant,
  provisionCoverageWorld,
  seedImages,
} from "./helpers/coverage-world"
import { syntheticJpeg } from "./helpers/media"
import { provisioner, psql, requireIsolatedStack } from "./helpers/stack"
import {
  activeItemId,
  activeVersionId,
  assetIdFor,
  doneButton,
  importRailway,
  labelItems,
  phone,
  pickFiles,
  savingSheet,
  sql,
  TapCounter,
} from "./helpers/upload-label-flow"
import { escape } from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * Batch B, ME-1: a manager asks for a better photo of a dish, and the staff
 * member who took it sends a new one from Me in at most two taps (Take a new
 * photo, Done), already labelled with that dish and its variant. The service
 * role only seeds the menu, the grant and the photo bytes; the first label is
 * saved by the uploader's own session and the request goes through the
 * manager's page. Chromium, phone context at 390 px (emulation, not a device).
 */

async function settled(page: Page) {
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0)
}

/** The Veg variant of Momo on the venue's active menu. */
function vegVariantId(venueId: string, itemId: string) {
  const id = psql(`select ev.variant_id from public.menu_entry_variants ev
    join public.menu_entries e on e.id = ev.entry_id
    join public.menu_versions v on v.id = e.version_id
    where v.venue_id = ${sql(venueId)} and v.status = 'active'
      and e.item_id = ${sql(itemId)} and ev.name = 'Veg'`)
  if (!id) throw new Error("No Veg variant on Momo")
  return id
}

const photoState = (assetId: string, itemId: string) =>
  psql(
    `select state from public.menu_item_photos where asset_id = ${sql(assetId)}::uuid and item_id = ${sql(itemId)}::uuid and state in ('accepted', 'better_photo_requested', 'needs_recheck')`
  )

test.describe("Better photo requested: retake from Me", () => {
  test.setTimeout(300_000)

  test("staff take the replacement from the request in two taps, labelled with the dish", async ({
    browser,
  }) => {
    requireIsolatedStack()
    const w = await provisionCoverageWorld()
    const admin = await signedInPage(browser, w.admin)
    await importRailway(admin, w.venue1.id)
    await admin.context().close()
    await legacyStaffGrant(w.admin, w.manager, w.venue1)
    const momo = activeItemId(w.venue1.id, "appetisers--momo-veg-chicken")
    const veg = vegVariantId(w.venue1.id, momo)

    // Staff A's labelled photo of Momo (Veg), saved as the uploader.
    const [first] = await seedImages(w.staffA, w.venue1, 1, {
      prefix: "DEV-FIXTURE-better-photo",
    })
    const uploader = await signIn(provisioner(), w.staffA.email)
    const { error } = await uploader.rpc("save_media_labels", {
      p_asset_id: first!,
      p_expected_revision: 0,
      p_content_types: [],
      p_note: null as unknown as string,
      p_items: [{ itemId: momo, variantId: veg }],
      p_missing_item: null as unknown as string,
      p_catalogue_version_id: activeVersionId(w.venue1.id),
    })
    if (error) throw new Error(`fixture label save failed: ${error.message}`)

    // The manager asks for a better photo, with a reason.
    const reason = `Show all ten momos, in focus (${w.tag})`
    const manager = await signedInPage(browser, w.manager)
    await manager.goto("/staff/manage/menu/items")
    await settled(manager)
    const card = manager.getByRole("article", {
      name: new RegExp(`^Momo.*photo by ${escape(w.staffA.name)}`),
    })
    await card.getByRole("button", { name: "Ask for a better photo" }).click()
    const ask = manager.getByRole("dialog", { name: "Ask for a better photo" })
    await ask.getByRole("textbox", { name: /Reason/ }).fill(reason)
    await ask.getByRole("button", { name: "Ask for a better photo" }).click()
    await expect(ask).toBeHidden()
    await expect
      .poll(() => photoState(first!, momo))
      .toBe("better_photo_requested")
    await manager.context().close()

    // Staff A on a phone: the request is on Me with the dish and the note.
    const page = await signedInPage(browser, w.staffA, phone(390))
    await page.goto("/staff")
    await settled(page)
    const section = page.getByRole("region", {
      name: /^Better photo requested/,
    })
    await expect(section).toBeVisible()
    const request = section.getByRole("article", { name: "Momo (Veg)" })
    await expect(request).toContainText(reason)
    const take = request.getByRole("button", { name: "Take a new photo" })
    const takeBox = await take.boundingBox()
    expect(takeBox?.height ?? 0).toBeGreaterThanOrEqual(44)

    // Take a new photo opens the camera straight away, with the dish applied.
    const taps = new TapCounter()
    const photo = await syntheticJpeg(`better-photo-${w.tag}.jpg`)
    const input = await pickFiles(page, take, [photo.path], taps)
    expect(input.capture).toBe("environment")
    const sheet = savingSheet(page, "Saving 1 photo")
    await expect(sheet).toBeVisible()
    await expect(
      sheet.getByRole("button", { name: /^Remove Momo/ })
    ).toBeVisible()
    await taps.tap(doneButton(sheet), "Done")
    await expect(sheet).toBeHidden()
    expect(taps.taps, taps.steps.join(" > ")).toBeLessThanOrEqual(2)

    // The new photo is staff A's, labelled Momo (Veg): it is waiting for the
    // manager under that dish.
    const id = await assetIdFor(photo.name)
    expect(
      psql(`select uploader_id from public.media_assets where id = ${sql(id)}`)
    ).toBe(w.staffA.id)
    await expect
      .poll(() => labelItems(id), { timeout: 90_000 })
      .toBe(`Momo|${veg}|Veg`)

    // Me reads requests on the server: once the retake is labelled, the
    // request says it was sent and offers only a quiet Take another.
    await page.reload()
    await settled(page)
    await expect(request).toContainText(
      "New photo sent · waiting for manager review"
    )
    await expect(
      request.getByRole("button", { name: "Take a new photo" })
    ).toHaveCount(0)
    const again = request.getByRole("button", { name: "Take another" })
    await expect(again).toBeVisible()
    expect((await again.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

    // No page scrolls sideways at 390 px.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
    await page.context().close()
  })
})
