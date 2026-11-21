import { expect, type Locator, type Page } from "@playwright/test"

import { staffCaptureHref } from "../../../lib/amenities/contract"
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

/**
 * Where staff land after sign-in or a wrong-role redirect: Today
 * (DESIGN.md §5c, §15). The five staff tabs and their paths are below.
 */
export const STAFF_LANDING = /\/staff\/home$/

/** The staff tabs (DESIGN.md §15): Today, Album, Add (a button), My photos, Me. */
export const STAFF_TABS = {
  today: "/staff/home",
  album: "/staff/album",
  photos: "/staff/photos",
  me: "/staff/me",
} as const

/** Where admins land after sign-in or a wrong-role redirect: Overview (K7). */
export const ADMIN_LANDING = /\/admin\/overview$/

/** Other jobs (G-4, decision 23): non-menu jobs, amenity checks and questions. */
export const OTHER_JOBS_PATH = "/staff/tasks/other"
export const OTHER_JOBS = /\/staff\/tasks\/other$/

/**
 * Opens Other jobs the way staff do: the Other jobs row on Today (under
 * Match later; Me has the same row). The row shows whenever a job waits on
 * the person, so a spec that opens Other jobs proves it is reachable (revb B2).
 */
export async function openOtherJobs(page: Page) {
  if (new URL(page.url()).pathname !== STAFF_TABS.today)
    await page.goto(STAFF_TABS.today)
  await page.getByRole("link", { name: /^Other jobs/ }).click()
  await expect(page).toHaveURL(OTHER_JOBS)
}

/** Working-list actions that wait on the person (slotRow's needsMe rows). */
const CHECK_ACTION = "(Start check|Recheck|Finish|Add detail|Check again)"

/**
 * An amenity check on Other jobs: the assigned-check card (AmenityTaskList,
 * a link named by the question) or its working-list row (a link named
 * "<action>: <question>"). Only rows that ask something of the person.
 */
export function otherJobsCheck(page: Page, question: string) {
  const start = page.getByRole("link", { name: question, exact: true }).or(
    page.getByRole("link", {
      name: new RegExp(`^${CHECK_ACTION}: ${escape(question)}$`),
    })
  )
  const card = page.getByRole("listitem").filter({ has: start })
  return { card, start }
}

/** The check is on Other jobs once, and its link opens its capture page. */
export async function expectOtherJobsCheck(
  page: Page,
  question: string,
  checkId: string
) {
  const check = otherJobsCheck(page, question)
  await expect(check.card).toHaveCount(1)
  await expect(check.start).toHaveAttribute("href", staffCaptureHref(checkId))
  return check
}

/** Other jobs, then the check, landing on its capture page. */
export async function startOtherJobsCheck(
  page: Page,
  question: string,
  checkId: string,
  how: "click" | "tap" = "click"
) {
  if (!OTHER_JOBS.test(page.url())) await openOtherJobs(page)
  const { start } = await expectOtherJobsCheck(page, question, checkId)
  await start[how]()
  await expect(page).toHaveURL(
    new RegExp(`${escape(staffCaptureHref(checkId))}$`)
  )
}

/**
 * My photos, the staff tab of the person's own photos (DESIGN.md §5e, D19):
 * a Needs you inbox and a grid by day. It replaced Me's "Your portfolio";
 * every action on a photo is on that photo's own page. "Add a video" (the
 * older Add sheet, `meSheetButton`) lives here.
 */
export async function openMyPhotos(page: Page) {
  if (new URL(page.url()).pathname !== STAFF_TABS.photos)
    await page.goto(STAFF_TABS.photos)
  await expect(page).toHaveURL(/\/staff\/photos$/)
  await expect(page.locator('[data-slot="my-photos"]')).toBeVisible()
}

export const myPhotos = (page: Page) => page.locator('[data-slot="my-photos"]')

/** A photo's own page under My photos (DESIGN.md §5e). */
export const photoPagePath = (assetId: string) =>
  `${STAFF_TABS.photos}/${encodeURIComponent(assetId)}`

/** A photo's link on My photos (grid tile or Needs you row), by asset id. */
export const myPhotoLink = (page: Page | Locator, assetId: string) =>
  page.locator(`a[href="${photoPagePath(assetId)}"]`).first()
export const libraryList = (page: Page) =>
  page.getByRole("list", { name: "Library" })

/**
 * My photos' way to the older Add sheet (R15-1): "Add a video", a secondary
 * button at the top of the My photos tab (`openMyPhotos`). Add photos opens the gallery and Match, which
 * takes photos only; the sheet takes photos and videos, labels them with
 * "What's in these photos?" and lists each file with Retry. Every journey
 * that tests the sheet itself starts here.
 */
export const ME_SHEET_ADD = "Add a video"
export const meSheetButton = (page: Page) =>
  page.getByRole("button", { name: ME_SHEET_ADD }).first()

/**
 * The staff upload sheet. Before a pick it is "Add photos or videos" (or
 * "Upload photos" for photos only, a task screen's sheet); once files are
 * picked it is the "Saving N photos" sheet ("files" when a video is among
 * them), and for staff "N photos added" once every one has finished (D21).
 */
export const UPLOAD_SHEET =
  /^(Add photos or videos|Upload photos|Saving \d+ (photos?|files?)|\d+ (photos?|files?) added)$/
export const uploadSheet = (page: Page) =>
  page.getByRole("dialog", { name: UPLOAD_SHEET })

const isVideo = (f: { name: string }) => /\.(mp4|mov|webm)$/i.test(f.name)

/** The sheet's title for these files once they are picked. */
export function savingTitle(files: readonly { name: string }[]) {
  const n = files.length
  const photos = files.every((f) => !isVideo(f))
  return `Saving ${n} ${photos ? (n === 1 ? "photo" : "photos") : n === 1 ? "file" : "files"}`
}

/**
 * The sheet's footer once a staff run settles with every file finished
 * (D21): photos are posted to the Album, videos are saved ("2 posted ·
 * 1 saved"). Pass `{ posting: false }` for a run that only saves.
 */
export function settledWords(
  files: readonly { name: string }[],
  { posting = true } = {}
) {
  if (!posting) return `${files.length} saved`
  const videos = files.filter(isVideo).length
  const photos = files.length - videos
  return [
    photos > 0 || videos === 0 ? `${photos} posted` : null,
    videos > 0 ? `${videos} saved` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/**
 * Closes the settled sheet: Done, or for photos posted with no label yet
 * (D21) the sheet's own close, which leaves them under Unlabelled.
 */
export async function closeUploadSheet(page: Page) {
  await closeSheet(uploadSheet(page))
}

/** The same for a sheet already found (labels chosen in it are kept). */
export async function closeSheet(dialog: Locator) {
  const done = dialog.getByRole("button", { name: "Done", exact: true })
  if (await done.isVisible()) await done.click()
  else
    // Escape closes an open picker first, then the sheet.
    await expect(async () => {
      await dialog.page().keyboard.press("Escape")
      await expect(dialog).toBeHidden({ timeout: 1_000 })
    }).toPass({ timeout: 10_000 })
  await expect(dialog).toBeHidden()
}

/**
 * Uploads files through the real upload sheet (they start saving as soon as
 * they are picked) and records every state each queue row shows, so the test
 * can assert the real technical sequence (Uploading → Processing → Saved)
 * without racing transient states. `expectSettled` is the footer once the run
 * settles ("2 posted", "1 posted · 1 saved", "0 posted · 1 need attention").
 */
export async function uploadThroughDialog(
  page: Page,
  files: SourceFile[],
  { expectSettled = settledWords(files), close = true } = {}
): Promise<Record<string, string[]>> {
  await meSheetButton(page).click()
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
  if (close) await closeUploadSheet(page)
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
