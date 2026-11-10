import { expect, type Locator, type Page } from "@playwright/test"

import { ENTRY_COPY } from "../../../components/nabalens/shell/entry-copy"
import type { TapCounter } from "./upload-label-flow"

/**
 * The shared entry (B02-02) behind the global Add: an idle Add (the phone tab,
 * or "Add photos" in the bar from md) asks "What are you adding?" first, and
 * "Just photos" goes on to today's Add. A busy Add skips it and shows the
 * queue; a page's own upload (the portfolio's) never passes through it.
 */
export const intentDialog = (page: Page) =>
  page.getByRole("dialog", { name: ENTRY_COPY.title, exact: true })

/** The "Just photos" choice, named with its audience line. */
export const JUST_PHOTOS = `${ENTRY_COPY.intents.photos} ${ENTRY_COPY.photosAudience}`

/**
 * Taps an idle global Add `trigger`, then "Just photos" in the intent dialog.
 * With `taps`, both taps and the intent dialog are recorded. The caller then
 * waits for the Add sheet (phones) or the upload dialog (from md).
 */
export async function addJustPhotos(
  page: Page,
  trigger: Locator,
  taps?: TapCounter
) {
  if (taps) await taps.tap(trigger, "Add")
  else await trigger.click()
  const intent = intentDialog(page)
  await expect(intent).toBeVisible()
  taps?.dialog(ENTRY_COPY.title)
  const choice = intent.getByRole("button", { name: JUST_PHOTOS, exact: true })
  if (taps) await taps.tap(choice, ENTRY_COPY.intents.photos)
  else await choice.click()
  await expect(intent).toBeHidden()
}

/**
 * What a count badge shows on screen: its text outside the assistive-only
 * (`sr-only`) words, which the trigger's accessible name carries instead.
 */
export function visibleBadgeText(badge: Locator) {
  return badge.evaluate((el) => {
    const shown = (node: Node): string =>
      node instanceof Element
        ? node.classList.contains("sr-only")
          ? ""
          : Array.from(node.childNodes).map(shown).join("")
        : (node.textContent ?? "")
    return shown(el).trim()
  })
}
