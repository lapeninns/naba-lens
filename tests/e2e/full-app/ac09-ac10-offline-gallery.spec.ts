import { expect, test } from "@playwright/test"

import {
  addPhotos,
  addSheet,
  assetsNamed,
  assetNamed,
  dishesOn,
  keep,
  labelBySearch,
  labelNow,
  openAlbum,
  SIZES,
  uploadStateOf,
  waitPosted,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { signedInPage } from "../helpers/world"

/**
 * AC09 (spec §5.6), for posting first (D21): offline, the add sheet never
 * says a photo was posted; it waits for a signal, and the photo posts once
 * the phone is back online, once.
 * AC10 (FA-2, gallery first): with camera permission denied, Add photos
 * still opens the phone's photo library (no capture attribute) and the
 * photos go through.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

test("AC09 offline: no false Sent; saved on this phone; sent once back online (phone)", async ({
  browser,
}, info) => {
  test.setTimeout(180_000)
  const w = await provisionManagerWorld()
  const photo = await syntheticJpeg(`ac09-${w.tag}.jpg`)
  const page = await signedInPage(browser, w.staffA1, SIZES.phone)
  await openAlbum(page)
  await page.context().setOffline(true)
  const { sheet } = await addPhotos(page, [photo.path])
  // Honest words for a photo still on the phone (spec §5.6).
  await expect(
    sheet.getByRole("status").filter({ hasText: /posted/ })
  ).toHaveText("0 posted · 1 waiting")
  await expect(sheet).toContainText("Waiting for a signal")
  await expect(sheet.getByRole("list", { name: "Files" })).not.toContainText(
    /\bPosted\b/
  )
  await keep(page, info, "ac09-offline-sheet")
  expect(
    assetsNamed(photo.name) === 0 ||
      uploadStateOf(await assetNamed(photo.name)) !== "ready"
  ).toBe(true)

  // Back online: it goes, once.
  await page.context().setOffline(false)
  await waitPosted(page, 1, 90_000)
  const id = await assetNamed(photo.name, 90_000)
  await expect.poll(() => uploadStateOf(id), { timeout: 90_000 }).toBe("ready")
  await expect(addSheet(page)).toBeVisible()
  const screen = await labelNow(page)
  await labelBySearch(screen, [id], "salad", "Salad")
  await expect.poll(() => dishesOn(id), { timeout: 60_000 }).toBe("Salad")
  expect(assetsNamed(photo.name)).toBe(1)
  await page.context().close()
})

for (const size of ["phone", "desktop"] as const) {
  test(`AC10 camera permission denied: the photo library route still works (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(120_000)
    const w = await provisionManagerWorld()
    const photo = await syntheticJpeg(`ac10-${size}-${w.tag}.jpg`)
    // No permission is granted: camera access is denied.
    const page = await signedInPage(browser, w.staffA1, {
      ...SIZES[size],
      permissions: [],
    })
    expect(
      await page.evaluate(async () =>
        navigator.permissions
          ? (
              await navigator.permissions.query({
                name: "camera" as PermissionName,
              })
            ).state
          : "unsupported"
      )
    ).not.toBe("granted")
    await openAlbum(page)
    const { input } = await addPhotos(page, [photo.path])
    // The library picker, never a camera capture (FA-2).
    expect(input.capture).toBeNull()
    expect(input.multiple).toBe(true)
    expect(input.accept).toContain("image/jpeg")
    await waitPosted(page, 1)
    const id = await assetNamed(photo.name)
    await expect
      .poll(() => uploadStateOf(id), { timeout: 60_000 })
      .toBe("ready")
    const screen = await labelNow(page)
    await labelBySearch(screen, [id], "lager", "Lager")
    await keep(page, info, `ac10-${size}`)
    await expect.poll(() => dishesOn(id)).toBe("Lager")
    await page.context().close()
  })
}
