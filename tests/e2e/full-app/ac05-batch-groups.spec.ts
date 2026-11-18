import { expect, test } from "@playwright/test"

import {
  assetNamed,
  createPlace,
  dishesOn,
  keep,
  matchBySearch,
  matchSummary,
  openAlbum,
  placesOn,
  SIZES,
  startMatch,
  uploadStateOf,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { sha256, syntheticJpeg } from "../helpers/media"
import { provisioner, psql } from "../helpers/stack"
import { signedInPage } from "../helpers/world"

/**
 * AC05 (spec §5.4, FA-3): one batch holds two dishes and the garden. Staff
 * make three explicit groups with "Photo N too" and give each its own
 * label; nothing is applied to the next photos without that tap, and each
 * photo ends up with its group's label only. The end shows the venue, the
 * count and a chip per group.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

for (const size of ["phone", "narrow", "desktop"] as const) {
  test(`AC05 two dishes and a garden get three independent group labels (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const w = await provisionManagerWorld()
    createPlace(w.venueA, `Garden ${w.tag}`, w.mgrA)
    const files = await Promise.all(
      ["soup-1", "soup-2", "pie-1", "pie-2", "garden"].map((n) =>
        syntheticJpeg(`ac05-${size}-${n}-${w.tag}.jpg`)
      )
    )
    const page = await signedInPage(browser, w.staffA1, SIZES[size])
    await openAlbum(page)
    // Picked newest first: Match shows the batch in capture order (soup-1
    // first), and each label must follow the photo on screen, never its
    // place in the pick (S3-E2E-1 E3).
    const { match } = await startMatch(page, files.map((f) => f.path).reverse())
    await expect(match.locator('[data-slot="match-open-count"]')).toHaveText(
      "5 not matched yet"
    )

    // Group 1: photos 1 and 2 are Soup. The group is an explicit choice.
    const group = match.locator('[data-slot="match-group"]')
    const photo2 = group.getByRole("button", { name: "Photo 2 too" })
    await expect(photo2).toHaveAttribute("aria-pressed", "false")
    await photo2.click()
    await expect(photo2).toHaveAttribute("aria-pressed", "true")
    await expect(group).toContainText(
      "This photo and the next one get the same answer."
    )
    await matchBySearch(match, "soup", "Soup")

    // Group 2: photos 3 and 4 are Pie. The Soup answer was not carried on.
    await expect(match.getByRole("heading", { level: 2 }).first()).toHaveText(
      "Photo 3 of 5"
    )
    await expect(match.locator('[data-slot="match-open-count"]')).toHaveText(
      "3 not matched yet"
    )
    await group.getByRole("button", { name: "Photo 4 too" }).click()
    await matchBySearch(match, "pie", "Pie")

    // Group 3: the garden, a place, alone.
    await expect(match.getByRole("heading", { level: 2 }).first()).toHaveText(
      "Photo 5 of 5"
    )
    await matchBySearch(match, "garden", `Garden ${w.tag}`)

    const summary = matchSummary(page)
    await expect(summary).toBeVisible()
    await expect(page.locator('[data-slot="match-summary-venue"]')).toHaveText(
      `5 photos for ${w.venueA.name}`
    )
    await expect(summary).toContainText("3 slots filled")
    const chips = page.locator('[data-slot="match-summary-chips"]')
    await expect(chips).toContainText("Soup × 2")
    await expect(chips).toContainText("Pie × 2")
    await expect(chips).toContainText(`Garden ${w.tag}`)
    await keep(page, info, `ac05-${size}-summary`)

    // Each photo has its own group's label, and only that one.
    const expected: [number, string, string][] = [
      [0, "Soup", ""],
      [1, "Soup", ""],
      [2, "Pie", ""],
      [3, "Pie", ""],
      [4, "", `Garden ${w.tag}`],
    ]
    const ids = await Promise.all(files.map((f) => assetNamed(f.name)))
    // Each asset holds the bytes of the photo whose name it carries (so a
    // wrong label below is a wrong label, not a renamed file).
    await expect
      .poll(() => Promise.all(ids.map(uploadStateOf)), { timeout: 60_000 })
      .toEqual(ids.map(() => "ready"))
    const stored = await Promise.all(
      ids.map(async (id) => {
        const path = psql(
          `select original_path from public.media_assets where id = '${id}'::uuid`
        )
        const { data, error } = await provisioner()
          .storage.from("media")
          .download(path)
        if (error) throw error
        return sha256(new Uint8Array(await data.arrayBuffer()))
      })
    )
    expect
      .soft(stored, "stored bytes match the file name")
      .toEqual(files.map((f) => f.sha256))
    const want = expected
      .map(([i, dish, place]) => `${files[i]!.name}=${dish}|${place}`)
      .join("; ")
    await expect
      .poll(
        () =>
          ids
            .map((id, i) => `${files[i]!.name}=${dishesOn(id)}|${placesOn(id)}`)
            .join("; "),
        { timeout: 60_000 }
      )
      .toBe(want)
    await page.context().close()
  })
}
