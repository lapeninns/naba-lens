import { expect, test } from "@playwright/test"

import {
  assetsNamed,
  assetNamed,
  dishesOn,
  keep,
  matchBySearch,
  matchSummary,
  openAlbum,
  SIZES,
  startMatch,
  uploadStateOf,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { signedInPage } from "../helpers/world"

/**
 * AC09 (spec §5.6): offline, Match never says a photo was sent; it says it
 * is saved on this phone, and it sends once the phone is back online.
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
  // The signal drops once Match has its slots (they come from the server).
  const { match } = await startMatch(page, [photo.path])
  await expect(
    match.locator('[data-slot="match-picker"]').getByRole("button", { name: /^Salad\b/ })
  ).toBeVisible()
  await page.context().setOffline(true)
  await matchBySearch(match, "salad", "Salad")
  const summary = matchSummary(page)
  await expect(summary).toBeVisible()
  // Honest words for a photo still on the phone (spec §5.6).
  await expect(summary).toContainText("Saved on this phone")
  // Nothing reached the server, so the end must not claim a filled slot or
  // Waiting (soft: on the merged head it does; report D7).
  await expect.soft(summary).not.toContainText(/\b(Sent|Waiting|slots? filled)\b/)
  await expect(summary).not.toContainText(/\bSent\b/)
  await keep(page, info, "ac09-offline-summary")
  expect(
    assetsNamed(photo.name) === 0 ||
      uploadStateOf(await assetNamed(photo.name)) !== "ready"
  ).toBe(true)

  // The album tile says so too, and not Waiting.
  await page.keyboard.press("Escape")
  await expect(match).toBeHidden()
  await expect(
    page.getByLabel("Salad: saved on this phone").first()
  ).toBeVisible()

  // Back online: it goes, once.
  await page.context().setOffline(false)
  const id = await assetNamed(photo.name, 90_000)
  await expect.poll(() => uploadStateOf(id), { timeout: 90_000 }).toBe("ready")
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
    const { match, input } = await startMatch(page, [photo.path])
    // The library picker, never a camera capture (FA-2).
    expect(input.capture).toBeNull()
    expect(input.multiple).toBe(true)
    expect(input.accept).toContain("image/jpeg")
    await matchBySearch(match, "lager", "Lager")
    await expect(matchSummary(page)).toBeVisible()
    await keep(page, info, `ac10-${size}`)
    const id = await assetNamed(photo.name)
    await expect
      .poll(() => uploadStateOf(id), { timeout: 60_000 })
      .toBe("ready")
    await expect.poll(() => dishesOn(id)).toBe("Lager")
    await page.context().close()
  })
}
