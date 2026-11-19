import { expect, type Locator, type Page } from "@playwright/test"

import { provisioner } from "./stack"
import { myPhotos, photoPagePath, STAFF_TABS } from "./ui"

/**
 * The person's own photos after the five-tab move: My photos (DESIGN.md §5e,
 * D19), each photo's own page, and Me's profile header (§5b). My photos'
 * tiles carry no file name, so a tile is found by the media id of the
 * uploader's newest live asset with that name.
 */

/**
 * The id of the newest live asset uploaded as `fileName` (by `uploaderId`
 * when names repeat across runs), or null when none appears in time. The row
 * exists from the moment the upload is reserved.
 */
export async function ownAssetId(
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

/** My photos' grid by day (§5e step 6), without the Needs you inbox. */
export const myPhotosGrid = (page: Page) =>
  myPhotos(page).locator('section[aria-labelledby^="day-"]')

/** Every tile in the grid; each is a link to its photo's page. */
export const myPhotoTiles = (page: Page) =>
  myPhotosGrid(page).locator('a[href^="/staff/photos/"]')

/** A grid tile by asset id. */
export const myPhotoTileById = (page: Page, assetId: string) =>
  myPhotosGrid(page).locator(`a[href="${photoPagePath(assetId)}"]`)

/**
 * A grid tile by file name (newest live asset; by `uploaderId` when names
 * repeat). If no such asset exists the locator matches nothing, so
 * `toBeVisible` fails and `toHaveCount(0)` holds.
 */
export async function myPhotoTile(
  page: Page,
  fileName: string,
  uploaderId?: string
): Promise<Locator> {
  const id = await ownAssetId(fileName, uploaderId)
  return myPhotoTileById(page, id ?? "no-such-asset")
}

/** A tile's corner mark, the end of its name (§5e step 6). */
export type PhotoMarkWord =
  "Needs you" | "Waiting" | "In the album" | "Not in the album"

export const expectMark = (tile: Locator, mark: PhotoMarkWord) =>
  expect(tile).toHaveAttribute("aria-label", new RegExp(`, ${mark}$`))

/** The one photo on its own page (`MyUploads` layout="detail"). */
export const photoDetail = (page: Page) =>
  page.locator('[data-slot="my-upload-row"]')

/** Opens a photo's own page, where every action on it is (§5e "One photo"). */
export async function openPhotoPage(page: Page, assetId: string) {
  await page.goto(photoPagePath(assetId))
  await expect(page).toHaveURL(new RegExp(`${photoPagePath(assetId)}$`))
  await expect(photoDetail(page)).toBeVisible()
}

/**
 * The receipt word a photo's page shows while it isn't done
 * (lib/upload/states RECEIPT_WORDS): "Sending" while the server still has it
 * uploading (whether or not a tab is sending it), "Checking" while it is
 * processing, "Couldn't finish" once it failed. A ready photo shows none.
 */
export type PhotoState = "Sending" | "Checking" | "Couldn't finish" | "ready"
const RECEIPTS = ["Sending", "Checking", "Couldn't finish"] as const

/**
 * Checks a photo's state on its own page, opened in another tab of the same
 * browser so the page under test (and its Add queue) is left alone.
 */
export async function expectPhotoState(
  page: Page,
  assetId: string,
  state: PhotoState
) {
  const tab = await page.context().newPage()
  try {
    await openPhotoPage(tab, assetId)
    const row = photoDetail(tab)
    for (const word of RECEIPTS)
      await expect(row.getByText(word, { exact: true }), word).toHaveCount(
        word === state ? 1 : 0
      )
  } finally {
    await tab.close({ runBeforeUnload: false })
  }
}

/** Me (§5b): the profile header with the person's name and venue. */
export async function openMe(page: Page) {
  if (new URL(page.url()).pathname !== STAFF_TABS.me)
    await page.goto(STAFF_TABS.me)
  await expect(page).toHaveURL(/\/staff\/me$/)
  const profile = meProfile(page)
  await expect(profile).toBeVisible()
  return profile
}

export const meProfile = (page: Page) =>
  page.getByRole("region", { name: "Profile" })

/** Settings, where staff edit their profile (§5b; was Me's Edit profile). */
export const SETTINGS_PATH = `${STAFF_TABS.me}/settings`

/** My photos with nothing yet (§5e). */
export const MY_PHOTOS_EMPTY = "Photos you add appear here, newest first."
