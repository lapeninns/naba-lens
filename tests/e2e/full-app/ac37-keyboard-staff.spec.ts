import { expect, test, type Locator, type Page } from "@playwright/test"

import { signIn } from "../../support/identities"
import {
  addSheet,
  albumAdd,
  assetNamed,
  dishesOn,
  keep,
  labelConfirm,
  labelScreen,
  labelSearch,
  openAlbum,
  photoTick,
  SIZES,
  sql,
  uploadStateOf,
  waitPosted,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { provisioner, psql } from "../helpers/stack"
import { myPhotos, openMyPhotos } from "../helpers/ui"
import { signedInPage } from "../helpers/world"

/**
 * AC37, staff flows (spec §15.1), for posting first (D21, DESIGN.md §6.1):
 * upload, labelling a group and feedback work from the keyboard alone, with
 * names a screen reader reads: the Add trigger, the add sheet and its Label
 * now, Label photos' tick boxes and their polite count, the confirm bar and
 * its receipt, I'm not sure, and a manager's Retake reason on My photos
 * with its Retake link. (Review flows are S3-E2E-2's.)
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
    const sheet = addSheet(page)
    await expect(sheet).toBeVisible()
    // Focus is inside the sheet (a modal dialog), not left on the page.
    await expect
      .poll(() => sheet.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true)
    await waitPosted(page, 3)
    const ids = await Promise.all(files.map((f) => assetNamed(f.name)))
    const labelNow = sheet.getByRole("link", { name: "Label now" })
    await tabTo(page, labelNow)
    await page.keyboard.press("Enter")
    const screen = labelScreen(page)
    await expect(screen).toBeVisible()

    // Tick photos 1 and 2 with the keyboard: tick boxes with a state, and
    // a polite count.
    for (const id of [ids[0]!, ids[1]!]) {
      const tick = photoTick(screen, id)
      await tabTo(page, tick, 120)
      await page.keyboard.press("Space")
      await expect(tick).toBeChecked()
    }
    await expect(
      screen.getByRole("status").filter({ hasText: /selected/ })
    ).toHaveText("2 photos selected")

    // Search and choose Soup by keyboard; the confirm bar's Save takes focus.
    const search = labelSearch(screen)
    await tabTo(page, search)
    await page.keyboard.type("soup")
    await expect(
      screen.getByRole("status").filter({ hasText: /^\d+ slots?$/ })
    ).toHaveText("1 slot")
    const soup = screen
      .getByRole("list", { name: "Search dishes, drinks and spaces" })
      .getByRole("button", { name: /^Soup\b/ })
    await tabTo(page, soup)
    await page.keyboard.press("Enter")
    const save = labelConfirm(screen).getByRole("button", {
      name: "Save label",
    })
    await expect(labelConfirm(screen)).toContainText("Label 2 photos as Soup")
    await expect(save).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(
      screen.getByText("2 photos labelled Soup", { exact: true })
    ).toBeVisible()

    // The third: I'm not sure, by keyboard.
    const third = photoTick(screen, ids[2]!)
    await tabTo(page, third, 120)
    await page.keyboard.press("Space")
    const unsure = screen.getByRole("button", {
      name: /^(I'm not sure|Ask my manager)/,
    })
    await tabTo(page, unsure, 120)
    await page.keyboard.press("Enter")
    await expect(screen.locator('[data-slot="label-handed"]')).toHaveText(
      "1 photo is with your manager, who will choose its label."
    )
    await keep(page, info, `ac37-${size}-labelled`)

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
    const needsYou = myPhotos(page).getByRole("region", {
      name: /^Needs attention/,
    })
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
