import { expect, test } from "@playwright/test"

import { chooseOption, escape, libraryList } from "./helpers/ui"
import { provisionWorld, seedReadyAssets, signedInPage } from "./helpers/world"

/**
 * Filters combine and survive pagination (spec §10 "Filters"). Ready records are
 * provisioned directly (no stored bytes: thumbnails fall back to the icon); the
 * filtering and paging run through the admin's own session in the UI.
 * Page size is 24 (MEDIA_LIMITS.pageSize).
 */
test("venue + staff + type filters combine across pages, then clear", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const w = await provisionWorld()
  const t = w.tag
  await seedReadyAssets(w.staffA.id, w.venue1.id, 30, "image", `a1-photo-${t}`)
  await seedReadyAssets(w.staffA.id, w.venue1.id, 4, "video", `a1-video-${t}`)
  await seedReadyAssets(w.staffA.id, w.venue2.id, 3, "image", `a2-photo-${t}`)
  await seedReadyAssets(w.staffB.id, w.venue1.id, 5, "image", `b1-photo-${t}`)
  await seedReadyAssets(w.staffC.id, w.venue2.id, 5, "image", `c2-photo-${t}`)

  const admin = await signedInPage(browser, w.adminB)
  await expect(admin).toHaveURL(/\/admin$/)
  const library = libraryList(admin)
  const tiles = library.getByRole("button")

  await chooseOption(admin, admin, "Venue", w.venue1.name)
  await chooseOption(admin, admin, "Staff member", w.staffA.name)
  await admin
    .getByRole("group", { name: "Media type" })
    .getByRole("button", { name: "Photos" })
    .click()
  await expect(admin).toHaveURL(
    new RegExp(`venue=${w.venue1.id}&staff=${w.staffA.id}&type=image`)
  )

  // Page 1: 24 matching tiles; page 2 brings the remaining 6, still matching.
  await expect(tiles).toHaveCount(24)
  await admin.getByRole("button", { name: /^Load more/ }).click()
  await expect(tiles).toHaveCount(30)
  await expect(admin.getByText("All 30 shown")).toBeVisible()
  const expected = new RegExp(
    `^Photo, a1-photo-${t}-\\d\\d\\.jpg, by ${escape(w.staffA.name)}, ${escape(w.venue1.name)}, `
  )
  const names = await tiles.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  )
  expect(new Set(names).size).toBe(30)
  for (const name of names) expect(name).toMatch(expected)

  // Same staff + venue, videos only.
  await admin
    .getByRole("group", { name: "Media type" })
    .getByRole("button", { name: "Videos" })
    .click()
  await expect(tiles).toHaveCount(4)
  for (const name of await tiles.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "")
  )) {
    expect(name).toMatch(new RegExp(`^Video, a1-video-${t}`))
  }

  // Staff A at venue 2 (older uploads before a transfer would sit here).
  await chooseOption(admin, admin, "Venue", w.venue2.name)
  await expect(admin.getByText("Nothing matches these filters.")).toBeVisible()
  await admin
    .getByRole("group", { name: "Media type" })
    .getByRole("button", { name: "All" })
    .click()
  await expect(tiles).toHaveCount(3)

  // Venue 2 for everyone: A's three plus C's five.
  await chooseOption(admin, admin, "Staff member", "All staff")
  await expect(tiles).toHaveCount(8)

  // A reload keeps the filters (they live in the URL).
  await admin.reload()
  await expect(tiles).toHaveCount(8)

  await admin.getByRole("button", { name: "Clear filters" }).click()
  await expect(admin).toHaveURL(/\/admin$/)
  await expect(tiles).toHaveCount(24)
  await admin.context().close()
})
