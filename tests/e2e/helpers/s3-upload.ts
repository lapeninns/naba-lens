import { expect, type Locator, type Page } from "@playwright/test"

import { provisioner } from "./stack"
import { myPhotos, photoPagePath, STAFF_TABS } from "./ui"

/**
 * Slice 3 (uploading and menu labels) helpers for the five-tab staff app.
 * My photos (DESIGN.md §5e, D19) replaced Me's "Your portfolio": its tiles
 * are links to each photo's own page, named by the photo's slot (or what it
 * is) and its mark, never by file name. These find a tile by the asset id
 * reserved for a file name.
 */

/**
 * The id of the newest live asset uploaded under `fileName` (by `uploaderId`,
 * when names repeat). The row exists from the moment the upload is reserved.
 * Null when none appears within the wait.
 */
export async function newestAssetId(
  fileName: string,
  uploaderId?: string,
  timeout = 15_000
): Promise<string | null> {
  let id: string | null = null
  await expect
    .poll(
      async () => {
        let query = provisioner()
          .from("media_assets")
          .select("id")
          .eq("original_filename", fileName)
          .is("deleted_at", null)
        if (uploaderId) query = query.eq("uploader_id", uploaderId)
        const { data, error } = await query
          .order("created_at", { ascending: false })
          .limit(1)
        if (error) throw error
        id = data[0]?.id ?? null
        return id
      },
      { timeout }
    )
    .not.toBeNull()
    .catch(() => undefined)
  return id
}

/** Every grid tile on My photos (the day sections; Needs you rows aside). */
export const myPhotoTiles = (page: Page) =>
  myPhotos(page).locator(
    'section[aria-labelledby^="day-"] a[href^="/staff/photos/"]'
  )

/** One asset's grid tile on My photos, by id. */
export const myPhotoTileById = (page: Page, assetId: string) =>
  myPhotos(page).locator(
    `section[aria-labelledby^="day-"] a[href="${photoPagePath(assetId)}"]`
  )

/**
 * The grid tile on My photos of the newest asset uploaded under `fileName`.
 * When no such asset exists the locator matches nothing.
 */
export async function myPhotoTile(
  page: Page,
  fileName: string,
  uploaderId?: string
): Promise<Locator> {
  const id = await newestAssetId(fileName, uploaderId)
  return myPhotoTileById(page, id ?? "no-such-asset")
}

/** The Needs you inbox on My photos (§5e step 3). */
export const needsYouInbox = (page: Page) =>
  myPhotos(page).getByRole("region", { name: /^Needs you/ })

/**
 * Me by its tab (phones), a client navigation: the Add queue and its leave
 * guard carry on. Log out lives on Me below md.
 */
export async function openMeTab(page: Page) {
  await page
    .locator('[data-slot="tabbar"]')
    .getByRole("link", { name: /^Me\b/ })
    .click()
  await expect(page).toHaveURL(new RegExp(`${STAFF_TABS.me}$`))
}

/** A photo's own page under My photos (DESIGN.md §5e "One photo"). */
export async function openPhotoPage(page: Page, assetId: string) {
  await page.goto(photoPagePath(assetId))
  await expect(
    page.getByRole("heading", { level: 1, name: "Photo" })
  ).toBeAttached()
}
