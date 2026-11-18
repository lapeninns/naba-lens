import { expect, test } from "@playwright/test"

import {
  labelledPhoto,
  preferredAsset,
  provisionManagerWorld,
} from "../helpers/manager-world"
import { psql, requireIsolatedStack } from "../helpers/stack"
import { acceptAsManager, as, closeAll, evidence, SIZES, sql } from "./helpers"

/**
 * AC35 (spec §9, §22): one effective main photo per subject, with traceable
 * history. The first public photo of a dish becomes its main photo; the
 * manager makes a second one main from its photo detail.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

for (const [size, options] of SIZES) {
  test(`AC35 (${size}): changing the main photo leaves exactly one, and history shows both changes`, async ({
    browser,
  }) => {
    const w = await provisionManagerWorld()
    const first = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.pie], {
      colour: "#aa5533",
    })
    const second = await labelledPhoto(w.staffA2, w.venueA, [w.itemsA.pie], {
      colour: "#3355aa",
    })
    await acceptAsManager(w.mgrA, first, w.itemsA.pie)
    expect(preferredAsset(w.itemsA.pie)).toBe(first)

    const mgr = await as(browser, w.mgrA, options)
    await mgr.goto(`/manager/review/photo/${second}`)
    await mgr.locator('[data-review-action="approve"]').first().click()
    await expect(mgr.getByText("Saved.")).toBeVisible()
    // Accepted for public use; the first is still the main photo.
    expect(preferredAsset(w.itemsA.pie)).toBe(first)

    await mgr
      .locator('[data-review-action="primary"]')
      .filter({ visible: true })
      .first()
      .click()
    await expect(mgr.getByText("Saved.")).toBeVisible()
    await expect(mgr.locator("ol[data-review-history]")).toContainText(
      "Made the main photo"
    )
    await evidence(mgr, `ac35-main-photo-${size.replace(" ", "-")}`)

    // Exactly one effective main photo, the new one.
    expect(preferredAsset(w.itemsA.pie)).toBe(second)
    expect(
      psql(`select count(*) from public.menu_item_photos
        where item_id = ${sql(w.itemsA.pie)}::uuid and is_primary`)
    ).toBe("1")
    // Traceable: the old one was cleared, the new one set.
    expect(
      psql(`select string_agg(asset_id::text || ':' || action, ',' order by created_at)
        from public.menu_item_photo_events
        where item_id = ${sql(w.itemsA.pie)}::uuid and action in ('primary_set', 'primary_cleared')`)
    ).toMatch(
      new RegExp(
        `${first}:primary_cleared.*${second}:primary_set|${second}:primary_set.*${first}:primary_cleared`
      )
    )

    await mgr.goto(`/manager/review/photo/${first}`)
    await expect(mgr.locator("ol[data-review-history]")).toContainText(
      "No longer the main photo"
    )
  })
}
