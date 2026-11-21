import { expect, test, type Locator } from "@playwright/test"

import {
  addPhotos,
  assetNamed,
  dishesOn,
  foreignLabels,
  keep,
  labelNow,
  labelSearch,
  openAlbum,
  openToday,
  postAndLabel,
  saveLabel,
  SIZES,
  tickPhotos,
  uploadStateOf,
  waitPosted,
} from "../helpers/full-app"
import {
  provisionManagerWorld,
  type ManagerWorld,
} from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { signedInPage } from "../helpers/world"

/**
 * AC02 (spec §5.3, FA-3), for posting first (D21, DESIGN.md §6.1): a photo
 * added from Album's Add photos posts at once; Label now then picks a label
 * of the CURRENT venue through search, and the next photo's label through
 * Recent. AC04 (FA-44): R1 has no AI service; with every request to another
 * host refused, adding, posting, search and labels still work.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

let w: ManagerWorld
test.beforeAll(async () => {
  test.setTimeout(180_000)
  w = await provisionManagerWorld()
})

/** The picker's Recent row, and one slot on it. */
const recentChoice = (screen: Locator, name: RegExp) =>
  screen
    .locator('[data-slot="match-picker"]')
    .getByRole("list", { name: "Recent" })
    .getByRole("button", { name })

for (const size of ["phone", "desktop"] as const) {
  test(`AC02 quick upload picks a current-venue label by search, then from Recent (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const staff = size === "phone" ? w.staffA1 : w.staffA2
    const page = await signedInPage(browser, staff, SIZES[size])
    await openAlbum(page)

    const first = await syntheticJpeg(`ac02-${size}-1-${w.tag}.jpg`)
    await addPhotos(page, [first.path])
    await waitPosted(page, 1)
    const firstId = await assetNamed(first.name)
    // Posted before any label: in the Album, unlabelled (D21).
    await expect.poll(() => uploadStateOf(firstId)).toBe("ready")
    expect(dishesOn(firstId)).toBe("")

    const screen = await labelNow(page)
    await tickPhotos(screen, [firstId])
    // Search tolerates case and part of a word, and shows only this venue's
    // slots: venue B also has a Soup, which must not be offered.
    await labelSearch(screen).fill("SOU")
    const found = screen
      .locator('[data-slot="match-picker"]')
      .getByRole("button", { name: /^Soup\b/ })
    await expect(found).toHaveCount(1)
    await found.click()
    await saveLabel(screen, 1, "Soup")
    await keep(page, info, `ac02-${size}-labelled`)
    await expect.poll(() => dishesOn(firstId), { timeout: 60_000 }).toBe("Soup")
    expect(foreignLabels(firstId)).toBe(0)

    // The next visit offers the same label under Recent: one tap, no typing.
    await page.reload()
    await openAlbum(page)
    const second = await syntheticJpeg(`ac02-${size}-2-${w.tag}.jpg`)
    await addPhotos(page, [second.path])
    await waitPosted(page, 1)
    const secondId = await assetNamed(second.name)
    const again = await labelNow(page)
    await tickPhotos(again, [secondId])
    const recent = recentChoice(again, /^Soup\b/)
    await expect(recent).toBeVisible()
    await recent.click()
    await saveLabel(again, 1, "Soup")
    await expect
      .poll(() => dishesOn(secondId), { timeout: 60_000 })
      .toBe("Soup")
    expect(foreignLabels(secondId)).toBe(0)
    await page.context().close()
  })
}

test("AC02 in the same visit, a slot just labelled is offered again under Recent", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const page = await signedInPage(browser, w.staffA1, SIZES.phone)
  await openAlbum(page)
  const first = await syntheticJpeg(`ac02-visit-1-${w.tag}.jpg`)
  await postAndLabel(page, [first], "salad", "Salad")
  // No reload: back to Today, then the next photo. Salad, now Waiting, is
  // "another photo is welcome" (spec §6 S1) and was the last label used,
  // so Recent offers it (§5.3).
  await openToday(page)
  const again = await syntheticJpeg(`ac02-visit-2-${w.tag}.jpg`)
  await addPhotos(page, [again.path])
  await waitPosted(page, 1)
  const againId = await assetNamed(again.name)
  const screen = await labelNow(page)
  await tickPhotos(screen, [againId])
  await expect(recentChoice(screen, /^Salad\b/)).toBeVisible()
  await page.context().close()
})

test("AC04 with no AI service reachable, adding, search, labels and sending still work", async ({
  browser,
}, info) => {
  test.setTimeout(180_000)
  const page = await signedInPage(browser, w.staffA1, SIZES.phone)
  // Every request that leaves the app and its local Supabase is refused, as
  // if any outside service (AI included) were down.
  const refused: string[] = []
  await page.context().route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname
    if (host === "127.0.0.1" || host === "localhost") return route.fallback()
    refused.push(host)
    return route.abort()
  })
  await openAlbum(page)
  const photo = await syntheticJpeg(`ac04-${w.tag}.jpg`)
  const { ids } = await postAndLabel(page, [photo], "pie", "Pie")
  await expect.poll(() => dishesOn(ids[0]!), { timeout: 60_000 }).toBe("Pie")
  await expect.poll(() => uploadStateOf(ids[0]!)).toBe("ready")
  await keep(page, info, "ac04-labelled")
  info.annotations.push({
    type: "outside requests refused",
    description: refused.join(", ") || "none were made",
  })
  await page.context().close()
})
