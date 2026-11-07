import { expect, type Locator, type Page } from "@playwright/test"

import type { SourceFile } from "./media"
import { provisioner } from "./stack"

export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * An admin-view gallery tile by its accessible name
 * ("Photo, file.jpg, by …, Venue, uploaded …"). Staff views never show file
 * names: use `staffTile` there.
 */
export function tile(
  scope: Page | Locator,
  kind: "Photo" | "Video",
  fileName: string,
  extra = ""
): Locator {
  return scope.getByRole("button", {
    name: new RegExp(`^${kind}, ${escape(fileName)}${extra}`),
  })
}

/**
 * A staff-view tile (own portfolio or community), found by the media id of the
 * newest asset uploaded under `fileName` (by `uploaderId`, when names repeat); the tile's accessible name carries no
 * file name. The row exists from the moment the upload is reserved. If none
 * appears the locator matches nothing, so `toBeVisible` fails and
 * `toHaveCount(0)` holds only because the file never existed.
 */
export async function staffTile(
  scope: Page | Locator,
  fileName: string,
  uploaderId?: string
): Promise<Locator> {
  let id: string | null = null
  await expect
    .poll(
      async () => {
        let query = provisioner()
          .from("media_assets")
          .select("id")
          .eq("original_filename", fileName)
        if (uploaderId) query = query.eq("uploader_id", uploaderId)
        const { data, error } = await query
          .order("created_at", { ascending: false })
          .limit(1)
        if (error) throw error
        id = data[0]?.id ?? null
        return id
      },
      { timeout: 15_000 }
    )
    .not.toBeNull()
    .catch(() => undefined)
  return scope.locator(`button[data-media-id="${id ?? "no-such-asset"}"]`)
}

/** Where staff land after sign-in or a wrong-role redirect: Home. */
export const STAFF_LANDING = /\/staff\/tasks$/

/** My portfolio is a page staff open, no longer where they land. */
export async function openPortfolio(page: Page) {
  await page.goto("/staff")
  await expect(page).toHaveURL(/\/staff$/)
}

export const portfolioList = (page: Page) =>
  page.getByRole("list", { name: "Your portfolio" })
export const libraryList = (page: Page) =>
  page.getByRole("list", { name: "Library" })

/**
 * The staff upload sheet. Before a pick it is "Upload photos or videos" (or
 * "Upload photos" for photos only); once files are picked it is the
 * "Saving N photos" sheet ("files" when a video is among them).
 */
export const UPLOAD_SHEET =
  /^(Upload photos( or videos)?|Saving \d+ (photos?|files?))$/
export const uploadSheet = (page: Page) =>
  page.getByRole("dialog", { name: UPLOAD_SHEET })

/** The sheet's title for these files once they are picked. */
export function savingTitle(files: readonly { name: string }[]) {
  const n = files.length
  const photos = files.every((f) => !/\.(mp4|mov|webm)$/i.test(f.name))
  return `Saving ${n} ${photos ? (n === 1 ? "photo" : "photos") : n === 1 ? "file" : "files"}`
}

/**
 * Uploads files through the real upload sheet (they start saving as soon as
 * they are picked) and records every state each queue row shows, so the test
 * can assert the real technical sequence (Uploading → Processing → Saved)
 * without racing transient states. `expectSettled` is the footer once the run
 * settles ("2 saved", "0 saved · 1 need attention").
 */
export async function uploadThroughDialog(
  page: Page,
  files: SourceFile[],
  { expectSettled = `${files.length} saved`, close = true } = {}
): Promise<Record<string, string[]>> {
  await page
    .getByRole("button", { name: "Upload photos or videos" })
    .first()
    .click()
  const dialog = uploadSheet(page)
  await expect(dialog).toBeVisible()
  // Before the pick: the files start uploading the moment they are chosen.
  await recordQueueStatuses(page)
  await dialog
    .getByLabel("Choose photos or videos")
    .setInputFiles(files.map((f) => f.path))
  await expect(dialog.getByRole("list", { name: "Files" })).toBeVisible()
  await expect(dialog.getByRole("status")).toHaveText(expectSettled, {
    timeout: 90_000,
  })
  const seen = await readQueueStatuses(page)
  if (close) {
    await dialog.getByRole("button", { name: "Done" }).click()
    await expect(dialog).toBeHidden()
  }
  return seen
}

/**
 * Starts a MutationObserver that logs each upload queue row's state, by file
 * name: the detail while saving ("Uploading", "Processing", "Waiting"),
 * otherwise the word ("Saved", "Needs attention"). It may start before the
 * queue exists (uploads start on pick).
 */
export async function recordQueueStatuses(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __queueSeen: Record<string, string[]> }
    w.__queueSeen = {}
    const capture = () => {
      const list = document.querySelector('ul[aria-label="Files"]')
      if (!list) return
      for (const li of Array.from(list.querySelectorAll(":scope > li"))) {
        // File name, "Saved · …" / "Saving…" / "Needs attention", detail.
        const [nameEl, wordEl, detailEl] = Array.from(li.querySelectorAll("p"))
        if (!nameEl || !wordEl) continue
        const name = nameEl.textContent ?? ""
        const word = (wordEl.textContent ?? "").split("·")[0].trim()
        const detail = (detailEl?.textContent ?? "")
          .replace(/\s+\d+%$/, "")
          .trim()
        const status = word === "Saving…" && detail ? detail : word
        if (!status) continue
        const log = (w.__queueSeen[name] ??= [])
        if (log.at(-1) !== status) log.push(status)
      }
    }
    capture()
    new MutationObserver(capture).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })
  })
}

export async function readQueueStatuses(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __queueSeen: Record<string, string[]> })
        .__queueSeen
  )
}

/** Marks the document so a later check can prove no reload/navigation happened. */
export async function markDocument(page: Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __e2eMarker: number }).__e2eMarker = 1
  })
}
export async function documentUnchanged(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __e2eMarker?: number }).__e2eMarker === 1
  )
}

/** Chooses an option in one of the app's OptionSelect comboboxes. */
export async function chooseOption(
  page: Page,
  scope: Page | Locator,
  comboName: string,
  option: string
) {
  await scope.getByRole("combobox", { name: comboName }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}
