import { expect, test } from "@playwright/test"

import {
  assetNamed,
  dishesOn,
  foreignLabels,
  keep,
  matchBySearch,
  matchSummary,
  openAlbum,
  SIZES,
  startMatch,
  uploadStateOf,
} from "../helpers/full-app"
import {
  provisionManagerWorld,
  type ManagerWorld,
} from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { signedInPage } from "../helpers/world"

/**
 * AC02 (spec §5.3, FA-3): a quick upload from Album's Add photos picks a
 * label of the CURRENT venue through search and then through Recent.
 * AC04 (FA-44): R1 has no AI service; with every request to another host
 * refused, adding, search, labels and sending still work.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

let w: ManagerWorld
test.beforeAll(async () => {
  test.setTimeout(180_000)
  w = await provisionManagerWorld()
})

for (const size of ["phone", "desktop"] as const) {
  test(`AC02 quick upload picks a current-venue label by search, then from Recent (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const staff = size === "phone" ? w.staffA1 : w.staffA2
    const page = await signedInPage(browser, staff, SIZES[size])
    await openAlbum(page)

    const first = await syntheticJpeg(`ac02-${size}-1-${w.tag}.jpg`)
    const { match } = await startMatch(page, [first.path])
    await expect(match.locator('[data-slot="match-venue"]')).toHaveText(
      `For ${w.venueA.name}`
    )
    // Search tolerates case and part of a word, and shows only this venue's
    // slots: venue B also has a Soup, which must not be offered.
    await match.getByRole("searchbox", { name: "Search all slots" }).fill("SOU")
    const found = match
      .locator('[data-slot="match-picker"]')
      .getByRole("button", { name: /^Soup\b/ })
    await expect(found).toHaveCount(1)
    await found.click()
    await expect(matchSummary(page)).toBeVisible()
    await expect(page.locator('[data-slot="match-summary-venue"]')).toHaveText(
      `1 photo for ${w.venueA.name}`
    )
    await expect(matchSummary(page)).toContainText("Soup")
    await keep(page, info, `ac02-${size}-summary`)

    const firstId = await assetNamed(first.name)
    await expect.poll(() => dishesOn(firstId), { timeout: 60_000 }).toBe("Soup")
    expect(foreignLabels(firstId)).toBe(0)
    await expect.poll(() => uploadStateOf(firstId)).toBe("ready")

    // The next quick upload offers the same label under Recent: one tap.
    await page.getByRole("link", { name: "See the album" }).click()
    await expect(match).toBeHidden()
    const picker = match.locator('[data-slot="match-picker"]')
    const recentSoup = picker
      .getByRole("list", { name: "Recent" })
      .getByRole("button", { name: /^Soup\b/ })

    // The next visit offers the same label under Recent: one tap, no typing.
    await page.reload()
    await openAlbum(page)
    const second = await syntheticJpeg(`ac02-${size}-2-${w.tag}.jpg`)
    await startMatch(page, [second.path])
    await expect(picker.getByText("Recent", { exact: true })).toBeVisible()
    const recent = recentSoup
    await expect(recent).toBeVisible()
    await recent.click()
    await expect(matchSummary(page)).toBeVisible()
    const secondId = await assetNamed(second.name)
    await expect
      .poll(() => dishesOn(secondId), { timeout: 60_000 })
      .toBe("Soup")
    expect(foreignLabels(secondId)).toBe(0)
    await page.context().close()
  })
}

test("AC02 in the same visit, a slot just matched is offered again under Recent", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const page = await signedInPage(browser, w.staffA1, SIZES.phone)
  await openAlbum(page)
  const first = await syntheticJpeg(`ac02-visit-1-${w.tag}.jpg`)
  const { match } = await startMatch(page, [first.path])
  await matchBySearch(match, "salad", "Salad")
  await expect(matchSummary(page)).toBeVisible()
  await page.getByRole("link", { name: "See the album" }).click()
  await expect(match).toBeHidden()
  // No reload: Salad, now Waiting, is "another photo is welcome" (spec §6
  // S1) and was the last label used, so Recent should offer it (§5.3).
  const again = await syntheticJpeg(`ac02-visit-2-${w.tag}.jpg`)
  await startMatch(page, [again.path])
  await expect(
    match
      .locator('[data-slot="match-picker"]')
      .getByRole("list", { name: "Recent" })
      .getByRole("button", { name: /^Salad\b/ })
  ).toBeVisible()
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
  const { match } = await startMatch(page, [photo.path])
  await matchBySearch(match, "pie", "Pie")
  await expect(matchSummary(page)).toBeVisible()
  await expect(page.locator('[data-slot="match-summary"]')).toContainText(
    "1 slot filled"
  )
  const id = await assetNamed(photo.name)
  await expect.poll(() => dishesOn(id), { timeout: 60_000 }).toBe("Pie")
  await expect.poll(() => uploadStateOf(id)).toBe("ready")
  await keep(page, info, "ac04-summary")
  info.annotations.push({
    type: "outside requests refused",
    description: refused.join(", ") || "none were made",
  })
  await page.context().close()
})
