import { expect, test } from "@playwright/test"

import { createIdentity, createVenue } from "../support/identities"
import { syntheticJpeg } from "./helpers/media"
import { provisioner } from "./helpers/stack"
import { portfolioList, tile, uploadThroughDialog } from "./helpers/ui"
import { signedInPage } from "./helpers/world"

// Final review F5: a gallery refresh that hangs must not hold up uploads.
// Server Functions run one at a time in the browser, so the refresh is now an
// abortable GET (/api/portfolio): while one hangs, the upload's reserve and
// finalise Server Functions still run, the refresh is cancelled at the 10 s
// timeout, and refreshes never pile up.

const REFRESH_TIMEOUT_MS = 10_000

test.describe("a hung gallery refresh", () => {
  test.skip(({ isMobile }) => isMobile, "timing path; desktop run")

  test("does not block an upload, and is aborted at the timeout", async ({
    browser,
  }) => {
    const service = provisioner()
    const venue = await createVenue(service, "e2e-refresh-hang")
    const staff = await createIdentity(service, {
      label: "e2e-refresh-hang",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    const page = await signedInPage(browser, staff)
    await expect(
      page.getByRole("button", { name: "Upload photos or videos" }).first()
    ).toBeVisible()

    // Every refresh hangs: the request is held and never answered.
    const started: number[] = []
    const failed: number[] = []
    await page.route("**/api/portfolio**", () => {
      started.push(Date.now())
    })
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).pathname === "/api/portfolio")
        failed.push(Date.now())
    })

    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect.poll(() => started.length).toBe(1)
    const hungAt = started[0]

    // More focus refreshes while it hangs start nothing new.
    for (let i = 0; i < 3; i++)
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))

    const jpeg = await syntheticJpeg(`hang-${Date.now()}.jpg`)
    await uploadThroughDialog(page, [jpeg], { close: false })
    const uploadedAt = Date.now()

    // The upload finished while the refresh was still hanging: it did not wait
    // for the refresh to be given up.
    expect(failed, "refresh still in flight when the upload finished").toEqual(
      []
    )
    expect(uploadedAt - hungAt).toBeLessThan(REFRESH_TIMEOUT_MS)
    expect(started).toHaveLength(1)

    // The browser really cancels the hung request at the timeout.
    await expect.poll(() => failed.length, { timeout: 15_000 }).toBe(1)
    expect(failed[0] - hungAt).toBeGreaterThanOrEqual(REFRESH_TIMEOUT_MS - 500)

    // Once the server answers again, the next refresh shows the upload.
    await page.unroute("**/api/portfolio**")
    await page
      .getByRole("dialog", { name: "Upload photos or videos" })
      .getByRole("button", { name: "Done" })
      .click()
    // (A refresh started after the abort but before unroute is held too and
    // aborts in its turn, so keep asking until one gets through.)
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(tile(portfolioList(page), "Photo", jpeg.name)).toBeVisible({
        timeout: 2_000,
      })
    }).toPass({ timeout: 30_000 })

    await page.context().close()
  })
})
