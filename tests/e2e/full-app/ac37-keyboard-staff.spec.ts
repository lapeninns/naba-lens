import { expect, test, type Locator, type Page } from "@playwright/test"

import { signIn } from "../../support/identities"
import {
  albumAdd,
  assetNamed,
  dishesOn,
  keep,
  matchScreen,
  matchSummary,
  openAlbum,
  SIZES,
  sql,
  uploadStateOf,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { provisioner, psql } from "../helpers/stack"
import { myPhotos, openMyPhotos } from "../helpers/ui"
import { signedInPage } from "../helpers/world"

/**
 * AC37, staff flows (spec §15.1): upload, label grouping and feedback work
 * from the keyboard alone, with names a screen reader reads: the Add
 * trigger, Match's grouping buttons (aria-pressed) and its polite hint,
 * the photo strip's per-photo answers, the end, and a manager's Retake
 * reason on My photos with its Retake link. (Review flows are S3-E2E-2's.)
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

const focused = (target: Locator) =>
  target.evaluate((el) => el === document.activeElement)

/** Presses Tab until `target` has focus: it is reachable by keyboard. */
async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i++) {
    if (await focused(target).catch(() => false)) return i
    await page.keyboard.press("Tab")
  }
  throw new Error(`Not reachable with Tab in ${max} presses: ${target}`)
}

for (const size of ["desktop", "phone"] as const) {
  test(`AC37 keyboard only: add, group, label and read the answers back (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(240_000)
    const w = await provisionManagerWorld()
    const files = await Promise.all(
      ["1", "2", "3"].map((n) =>
        syntheticJpeg(`ac37-${size}-${n}-${w.tag}.jpg`)
      )
    )
    const page = await signedInPage(browser, w.staffA1, SIZES[size])
    await openAlbum(page)
    await page.locator("body").click({ position: { x: 1, y: 1 } })

    // Add photos, by Tab and Enter: the gallery opens.
    const add = albumAdd(page)
    await expect(add).toHaveAccessibleName("Add photos")
    await tabTo(page, add)
    const chooser = page.waitForEvent("filechooser")
    await page.keyboard.press("Enter")
    await (await chooser).setFiles(files.map((f) => f.path))
    const match = matchScreen(page)
    await expect(match).toBeVisible()
    await expect(match).toHaveAccessibleName("Photo 1 of 3")
    // Focus is inside Match (a modal dialog), not left behind on the page.
    await expect
      .poll(() => match.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true)

    // Group photos 1 and 2 with the keyboard: a toggle button with a state.
    const photo2 = match.getByRole("button", { name: "Photo 2 too" })
    await tabTo(page, photo2)
    await page.keyboard.press("Space")
    await expect(photo2).toHaveAttribute("aria-pressed", "true")
    const hint = match.locator('[data-slot="match-group"] [aria-live="polite"]')
    await expect(hint).toHaveText(
      "This photo and the next one get the same answer."
    )

    // Search and choose Soup by keyboard.
    const search = match.getByRole("searchbox", {
      name: "Search all slots",
    })
    await tabTo(page, search)
    await page.keyboard.type("soup")
    await expect(
      match.getByRole("status").filter({ hasText: /^\d+ slots?$/ })
    ).toHaveText("1 slot")
    const soup = match
      .getByRole("list", { name: "Search all slots" })
      .getByRole("button", { name: /^Soup\b/ })
    await tabTo(page, soup)
    await page.keyboard.press("Enter")

    // The strip names each photo's answer for a screen reader.
    await expect(match).toHaveAccessibleName("Photo 3 of 3")
    const strip = match.getByRole("list", { name: "Your photos" })
    await expect(
      strip.getByRole("button", { name: "Photo 1 of 3: in Soup" })
    ).toBeVisible()
    await expect(
      strip.getByRole("button", { name: "Photo 2 of 3: in Soup" })
    ).toBeVisible()
    await expect(
      strip.getByRole("button", { name: "Photo 3 of 3: not matched yet" })
    ).toBeVisible()

    // The third: I'm not sure, by keyboard.
    const unsure = match.getByRole("button", { name: /^I'm not sure/ })
    await tabTo(page, unsure)
    await page.keyboard.press("Enter")
    const summary = matchSummary(page)
    await expect(summary).toBeVisible()
    await expect(summary).toHaveAttribute("aria-live", "polite")
    await expect(summary).toContainText("1 slot filled")
    await expect(
      page.locator('[data-slot="match-summary-unsure"]')
    ).toBeVisible()
    await keep(page, info, `ac37-${size}-summary`)
    // Leave with the keyboard.
    const seeAlbum = page.getByRole("link", { name: "See the album" })
    await tabTo(page, seeAlbum)
    await page.keyboard.press("Enter")
    await expect(match).toBeHidden()

    // Feedback: the manager asks for another photo of photo 2 (the newer of
    // the two Soup photos), with a reason.
    const first = await assetNamed(files[1]!.name)
    await expect
      .poll(() => uploadStateOf(first), { timeout: 60_000 })
      .toBe("ready")
    await expect.poll(() => dishesOn(first), { timeout: 60_000 }).toBe("Soup")
    const reason = `Too dark: use the window light (${w.tag})`
    const manager = await signIn(provisioner(), w.mgrA.email)
    const revision = Number(
      psql(`select coalesce((select revision from public.menu_item_photo_heads
        where item_id = ${sql(w.itemsA.soup)}::uuid), 1)`)
    )
    const asked = await manager.rpc("review_menu_item_photo", {
      p_asset_id: first,
      p_item_id: w.itemsA.soup,
      p_variant_id: null as unknown as string,
      p_decision: "better_photo_requested",
      p_expected_revision: revision,
      p_reason: reason,
    } as never)
    expect(asked.error).toBeNull()

    // On My photos (DESIGN.md §5e), the Needs you row reads the reason, and
    // Retake opens the same slot (lib/staff/my-photos.ts).
    await openMyPhotos(page)
    const needsYou = myPhotos(page).getByRole("region", { name: /^Needs you/ })
    await expect(needsYou).toBeVisible()
    const row = needsYou.getByRole("listitem").filter({ hasText: reason })
    await expect(row).toBeVisible()
    await expect(row).toContainText("Retake")
    const retake = row.getByRole("link", { name: /Retake/ })
    await page.locator("body").click({ position: { x: 1, y: 1 } })
    await tabTo(page, retake, 160)
    await page.keyboard.press("Enter")
    const slot = page.locator('[data-slot="album-slot"]')
    await expect(slot).toBeVisible()
    await expect(slot).toContainText("Soup")
    await expect(slot).toContainText(reason)
    await keep(page, info, `ac37-${size}-retake`)
    await page.context().close()
  })
}
