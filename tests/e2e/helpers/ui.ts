import { expect, type Locator, type Page } from "@playwright/test"

import type { SourceFile } from "./media"

export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A gallery tile by its accessible name ("Photo, file.jpg, by …, Venue, uploaded …"). */
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

export const portfolioList = (page: Page) =>
  page.getByRole("list", { name: "Your portfolio" })
export const libraryList = (page: Page) =>
  page.getByRole("list", { name: "Library" })

/**
 * Uploads files through the real upload dialog and records every status text
 * each queue row shows, so the test can assert the real technical sequence
 * (Uploading → Processing → Uploaded) without racing transient states.
 */
export async function uploadThroughDialog(
  page: Page,
  files: SourceFile[],
  { expectSettled = `${files.length} uploaded`, close = true } = {}
): Promise<Record<string, string[]>> {
  await page
    .getByRole("button", { name: "Upload photos or videos" })
    .first()
    .click()
  const dialog = page.getByRole("dialog", { name: "Upload photos or videos" })
  await dialog
    .getByLabel("Choose photos or videos")
    .setInputFiles(files.map((f) => f.path))
  await expect(dialog.getByRole("list", { name: "Files" })).toBeVisible()
  await recordQueueStatuses(page)
  await dialog
    .getByRole("button", {
      name: `Upload ${files.length} ${files.length === 1 ? "file" : "files"}`,
    })
    .click()
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

/** Starts a MutationObserver on the upload queue that logs each row's status line. */
export async function recordQueueStatuses(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __queueSeen: Record<string, string[]> }
    w.__queueSeen = {}
    const list = document.querySelector('ul[aria-label="Files"]')!
    const capture = () => {
      for (const li of Array.from(list.querySelectorAll("li"))) {
        const [nameEl, statusEl] = Array.from(li.querySelectorAll("p"))
        if (!nameEl || !statusEl) continue
        const name = nameEl.textContent ?? ""
        // "12 KB · Uploading 40%" → "Uploading"
        const status = (statusEl.textContent ?? "")
          .split("·")
          .slice(1)
          .join("·")
          .replace(/\s+\d+%$/, "")
          .replace(/\s+—.*$/, "")
          .trim()
        const log = (w.__queueSeen[name] ??= [])
        if (log.at(-1) !== status) log.push(status)
      }
    }
    capture()
    new MutationObserver(capture).observe(list, {
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
