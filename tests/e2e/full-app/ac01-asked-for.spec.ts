import { expect, test } from "@playwright/test"

import {
  assetNamed,
  dishesOn,
  keep,
  openToday,
  requestDishPhoto,
  SIZES,
  venueOfAsset,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { signedInPage } from "../helpers/world"

/**
 * AC01 (spec §5.2, FA-5, S2-REQ): a manager asks for a photo of a dish.
 * Staff see it on Today (DESIGN.md §5c) under "Asked for" with the brief; tapping the slot
 * opens the gallery for THAT slot, so venue, item and view are already
 * chosen and nothing is typed. The photo lands labelled with that dish at
 * that venue. Staff words never say task, request or due.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

for (const size of ["phone", "narrow", "desktop"] as const) {
  test(`AC01 an asked-for dish prefills venue, item and brief; no typing (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const w = await provisionManagerWorld()
    const brief = `Top-down, on the white plate (${w.tag})`
    const requestId = await requestDishPhoto(
      w.mgrA,
      w.venueA,
      w.itemsA.pie,
      brief
    )

    const page = await signedInPage(browser, w.staffA1, SIZES[size])
    let typed = 0
    await page.exposeFunction("__typed", () => (typed += 1))
    await page.addInitScript(() =>
      document.addEventListener("input", (e) => {
        const t = e.target as HTMLElement
        if (t.matches("input:not([type=file]), textarea"))
          (window as unknown as { __typed: () => void }).__typed()
      })
    )
    await openToday(page)
    const asked = page.locator('[data-slot="asked-for"]')
    await expect(asked).toBeVisible()
    await expect(
      asked.getByRole("heading", { name: "Asked for" })
    ).toBeVisible()
    const item = asked.locator(`[data-request-id="${requestId}"]`)
    await expect(item).toContainText(brief)
    // Staff words only (DESIGN.md §7, §9; FA-5).
    await expect(asked).not.toContainText(/\b(task|request|due|overdue)\b/i)
    const slot = item.getByRole("button", { name: "Pie: needed" })
    await expect(slot).toBeVisible()
    await keep(page, info, `ac01-${size}-asked-for`)

    // One tap opens the gallery for this one slot: one photo, photos only.
    const photo = await syntheticJpeg(`ac01-${size}-${w.tag}.jpg`)
    const chooser = page.waitForEvent("filechooser")
    await slot.click()
    const fc = await chooser
    expect(fc.isMultiple()).toBe(false)
    expect(await fc.element().getAttribute("capture")).toBeNull()
    await fc.setFiles(photo.path)

    // The slot itself now shows the photo on its way, then Waiting.
    await expect(
      item.getByLabel(/^Pie: (sending|waiting for review)/).first()
    ).toBeVisible({ timeout: 30_000 })

    const id = await assetNamed(photo.name)
    await expect.poll(() => dishesOn(id), { timeout: 60_000 }).toBe("Pie")
    expect(venueOfAsset(id)).toBe(w.venueA.id)
    expect(typed, "keystrokes in a text field").toBe(0)
    await page.reload()
    await openToday(page)
    await keep(page, info, `ac01-${size}-after`)
    await page.context().close()
  })
}
