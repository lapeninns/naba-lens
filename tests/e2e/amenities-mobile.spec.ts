import { devices, expect, test } from "@playwright/test"

import {
  amenityHrefs,
  PROGRESS_LABEL,
  staffCaptureHref,
  UI_TEXT,
} from "../../lib/amenities/contract"
import {
  captureForm,
  checkItem,
  checkState,
  currentSubmission,
  provisionAmenitiesWorld,
  question,
  readyCheck,
  seedPhoto,
  submitAndComplete,
} from "./helpers/amenities-world"
import { horizontalOverflow } from "./helpers/overflow"
import { escape, STAFF_LANDING } from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * Amenity capture at phone width (Pixel 7 emulation in the mobile-chromium
 * project): staff find the check on Home, capture it with a photo, and no page
 * on the way scrolls sideways. Emulation, not a device or camera test.
 */

test.describe("amenity capture at phone width", () => {
  test.skip(({ isMobile }) => !isMobile, "phone-width spec; mobile run")
  test.setTimeout(240_000)

  test("staff capture an assigned check on a phone-width screen", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const id = await readyCheck(w, w.venueA, "darts", w.staffA)
    const photo = await seedPhoto(w.staffA, w.venueA, `darts-${w.tag}`)
    // signedInPage opens its own context, so it takes the device explicitly.
    const device = devices["Pixel 7"]

    const staff = await signedInPage(browser, w.staffA, device)
    await expect(staff).toHaveURL(STAFF_LANDING)
    const section = staff.getByRole("region", { name: UI_TEXT.staffSection })
    await expect(checkItem(section, "darts")).toContainText(
      PROGRESS_LABEL.needs_capture
    )
    expect((await horizontalOverflow(staff)).overflowPx).toBe(0)

    await section.getByRole("link", { name: question("darts") }).tap()
    await expect(staff).toHaveURL(
      new RegExp(`${escape(staffCaptureHref(id))}$`)
    )
    const form = captureForm(staff)
    await form.answer("yes")
    await form.attach(photo)
    await form.submit.scrollIntoViewIfNeeded()
    const overflow = await horizontalOverflow(staff)
    expect(overflow.overflowPx, overflow.culprit).toBe(0)
    await submitAndComplete(staff, id)
    expect(checkState(id).answeredBy).toBe(w.staffA.id)
    expect(currentSubmission(id).assets).toEqual([photo])

    // The manager's check page at the same width, in the /manager workspace.
    const manager = await signedInPage(browser, w.managerA, device)
    await manager.goto(amenityHrefs("/manager").check(id))
    await expect(
      manager.getByText(PROGRESS_LABEL.complete, { exact: true }).first()
    ).toBeVisible()
    const managerOverflow = await horizontalOverflow(manager)
    expect(managerOverflow.overflowPx, managerOverflow.culprit).toBe(0)
  })
})
