import { randomUUID } from "node:crypto"

import { expect as baseExpect, test, type Page } from "@playwright/test"

import {
  expectImageLoaded,
  installVisibilityControl,
  setVisibility,
  signInAs,
} from "../library/e2e"
import { secondsBefore, seedAsset, setupIdentity } from "../library/seed"
import { createVenue, serviceClient } from "../support/identities"

/**
 * The library track's browser checks (spec §3 admin library and portfolio, §7
 * signed reads): filters and URL params, pagination under filters, the 15 s
 * foreground refresh, and previews that keep loading after their signed links
 * expire. Run with a short TTL to exercise expiry quickly:
 *
 *   NABALENS_SIGNED_URL_TTL_SECONDS=5 pnpm exec playwright test tests/e2e/library.spec.ts
 *
 * Without it the expiry test waits out the real 60 s links.
 */

// Server round trips (Server Functions, dev-mode route compiles) can take
// several seconds while other local stacks load this machine.
const expect = baseExpect.configure({ timeout: 20_000 })

const admin = serviceClient()
const PAGE = 24
const TTL = Number(process.env.NABALENS_SIGNED_URL_TTL_SECONDS || 60)

const tag = () => randomUUID().slice(0, 6)

/** Seeds `count` ready photos (real WebP derivatives), newest = index 0. */
async function seedPhotos(
  uploaderId: string,
  venueId: string,
  count: number,
  prefix: string,
  base = new Date(Date.now() - 60_000),
  /** Original bytes for the newest photo (stored before it becomes ready). */
  firstOriginal?: Uint8Array
) {
  const assets = []
  for (let i = 0; i < count; i++) {
    assets.push(
      await seedAsset(admin, {
        uploaderId,
        venueId,
        createdAt: secondsBefore(base, i),
        filename: `${prefix}-${String(i).padStart(2, "0")}.jpg`,
        derivatives: true,
        ...(i === 0 && firstOriginal
          ? { original: { bytes: firstOriginal, contentType: "image/jpeg" } }
          : {}),
      })
    )
  }
  return assets
}

/** Tile labels in DOM order, e.g. "Photo, x-00.jpg, by …". */
async function tileLabels(page: Page, list: string) {
  return page
    .getByRole("list", { name: list })
    .getByRole("button")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))
}

/**
 * The gallery's "N previews could not load." alert (Next's dev route announcer
 * is also an empty role="alert").
 */
const previewAlert = (page: Page) =>
  page.getByRole("alert").filter({ hasText: /could not load/ })

/** Private media never goes through the image optimiser. */
function forbidImageOptimiser(page: Page) {
  const seen: string[] = []
  page.on("request", (r) => {
    if (r.url().includes("/_next/image")) seen.push(r.url())
  })
  return () => expect(seen).toEqual([])
}

test.describe("admin library", () => {
  test("filters combine, live in the URL, survive paging and clear", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000)
    const t = tag()
    const venueA = await createVenue(admin, `e2e-lib-a-${t}`)
    const venueB = await createVenue(admin, `e2e-lib-b-${t}`)
    const staff1 = await setupIdentity(admin, {
      label: `e2e-lib-one-${t}`,
      role: "staff",
      venueId: venueA.id,
      session: false,
    })
    const staff2 = await setupIdentity(admin, {
      label: `e2e-lib-two-${t}`,
      role: "staff",
      venueId: venueB.id,
      session: false,
    })
    const adminUser = await setupIdentity(admin, {
      label: `e2e-lib-admin-${t}`,
      role: "admin",
      session: false,
    })
    const base = new Date(Date.now() - 120_000)
    const photos = await seedPhotos(
      staff1.id,
      venueA.id,
      PAGE + 2,
      `one-${t}`,
      base
    )
    for (let i = 0; i < 2; i++) {
      await seedAsset(admin, {
        uploaderId: staff1.id,
        venueId: venueA.id,
        type: "video",
        createdAt: secondsBefore(base, 100 + i),
        filename: `one-${t}-clip-${i}.mp4`,
      })
    }
    await seedPhotos(staff2.id, venueB.id, 3, `two-${t}`, base)

    const page = await signInAs(browser, admin, adminUser, baseURL!)
    const checkOptimiser = forbidImageOptimiser(page)
    await expect(page).toHaveURL(/\/admin$/)

    // URL -> filters: a shared link opens with the same filters applied.
    await page.goto(`/admin?venue=${venueA.id}&type=image`)
    await expect(page.getByRole("combobox", { name: "Venue" })).toContainText(
      venueA.name
    )
    await expect(
      page.getByRole("combobox", { name: "Staff member" })
    ).toContainText("All staff")
    await expect(page.getByRole("button", { name: "Photos" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    // Page 1, then page 2 under the same filters: newest first, no gaps.
    const library = page.getByRole("list", { name: "Library" })
    await expect(library.getByRole("button")).toHaveCount(PAGE)
    await page.getByRole("button", { name: "Load more" }).click()
    await expect(library.getByRole("button")).toHaveCount(PAGE + 2)
    await expect(page.getByText(`All ${PAGE + 2} shown`)).toBeVisible()
    const labels = await tileLabels(page, "Library")
    expect(labels.map((l) => l.split(", ")[1])).toEqual(
      photos.map((_, i) => `one-${t}-${String(i).padStart(2, "0")}.jpg`)
    )
    for (const label of labels) {
      expect(label).toContain(`by TEST e2e-lib-one-${t}, ${venueA.name}`)
    }
    await expectImageLoaded(library.getByRole("button").first().locator("img"))

    // Filters -> URL: the type toggle and the staff select update the URL.
    await page.getByRole("button", { name: "Videos" }).click()
    await expect(page).toHaveURL(
      new RegExp(`/admin\\?venue=${venueA.id}&type=video$`)
    )
    await expect(library.getByRole("button")).toHaveCount(2)
    expect(
      (await tileLabels(page, "Library")).every((l) => l.startsWith("Video, "))
    ).toBe(true)

    await page.getByRole("combobox", { name: "Staff member" }).click()
    await page
      .getByRole("option", { name: `TEST e2e-lib-two-${t}`, exact: true })
      .click()
    await expect(page).toHaveURL(
      new RegExp(`/admin\\?venue=${venueA.id}&staff=${staff2.id}&type=video$`)
    )
    // Staff two never uploaded at venue A: an empty, explained result.
    await expect(page.getByText("Nothing matches these filters.")).toBeVisible()
    await expect(library).toHaveCount(0)

    // Changing the venue keeps the other filters.
    await page.getByRole("combobox", { name: "Venue" }).click()
    await page.getByRole("option", { name: venueB.name, exact: true }).click()
    await expect(page).toHaveURL(
      new RegExp(`/admin\\?venue=${venueB.id}&staff=${staff2.id}&type=video$`)
    )
    await expect(page.getByText("Nothing matches these filters.")).toBeVisible()
    await page.getByRole("button", { name: "All", exact: true }).click()
    await expect(page).toHaveURL(
      new RegExp(`/admin\\?venue=${venueB.id}&staff=${staff2.id}$`)
    )
    await expect(library.getByRole("button")).toHaveCount(3)

    // Reload: the URL restores the same view.
    await page.reload()
    await expect(page.getByRole("combobox", { name: "Venue" })).toContainText(
      venueB.name
    )
    await expect(
      page.getByRole("combobox", { name: "Staff member" })
    ).toContainText(`TEST e2e-lib-two-${t}`)
    await expect(library.getByRole("button")).toHaveCount(3)

    // Clear: back to the bare URL and the whole library.
    await page.getByRole("button", { name: "Clear filters" }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(
      page.getByRole("button", { name: "Clear filters" })
    ).toHaveCount(0)
    await expect(page.getByRole("combobox", { name: "Venue" })).toContainText(
      "All venues"
    )
    await expect(library.getByRole("button").first()).toBeVisible()
    checkOptimiser()
    await page.context().close()
  })

  test("refreshes every 15 s in the foreground, pauses when hidden, and on focus", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000)
    const t = tag()
    const venue = await createVenue(admin, `e2e-lib-refresh-${t}`)
    const staff = await setupIdentity(admin, {
      label: `e2e-lib-refresh-${t}`,
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    const adminUser = await setupIdentity(admin, {
      label: `e2e-lib-refresh-admin-${t}`,
      role: "admin",
      session: false,
    })
    await seedPhotos(staff.id, venue.id, 1, `r-${t}`)

    const page = await signInAs(browser, admin, adminUser, baseURL!)
    await installVisibilityControl(page)
    await page.clock.install()
    await page.goto(`/admin?staff=${staff.id}`)
    const tiles = page
      .getByRole("list", { name: "Library" })
      .getByRole("button")
    await expect(tiles).toHaveCount(1)
    const upload = (name: string) =>
      seedAsset(admin, {
        uploaderId: staff.id,
        venueId: venue.id,
        filename: `${name}.jpg`,
        derivatives: true,
      })

    // Hidden: a new upload arrives and two intervals pass without a refresh.
    await setVisibility(page, "hidden")
    await upload(`r-${t}-hidden`)
    await page.clock.fastForward(16_000)
    await page.clock.fastForward(16_000)
    await page.waitForTimeout(2_000)
    await expect(tiles).toHaveCount(1)

    // Back in the foreground: refreshed at once, no reload or approval step.
    await setVisibility(page, "visible")
    await expect(tiles).toHaveCount(2)
    await expect(tiles.first()).toHaveAccessibleName(
      new RegExp(`^Photo, r-${t}-hidden\\.jpg`)
    )

    // Visible: the next upload appears after one 15 s interval.
    await upload(`r-${t}-interval`)
    await page.waitForTimeout(1_000)
    await expect(tiles).toHaveCount(2)
    await page.clock.fastForward(15_000)
    await expect(tiles).toHaveCount(3)

    // Window focus (switching back from another app) also refreshes.
    await upload(`r-${t}-focus`)
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(tiles).toHaveCount(4)
    await expect(tiles.first()).toHaveAccessibleName(
      new RegExp(`^Photo, r-${t}-focus\\.jpg`)
    )
    await page.context().close()
  })
})

test.describe("signed previews", () => {
  test("keep loading after their links expire, in the staff and admin portfolios", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000 + TTL * 3_000)
    const t = tag()
    const venue = await createVenue(admin, `e2e-lib-expiry-${t}`)
    const staff = await setupIdentity(admin, {
      label: `e2e-lib-expiry-${t}`,
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    const adminUser = await setupIdentity(admin, {
      label: `e2e-lib-expiry-admin-${t}`,
      role: "admin",
      session: false,
    })
    // A real original for the download check, stored while still uploading
    // (the storage guard refuses writes to a ready asset's original).
    const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const photos = await seedPhotos(
      staff.id,
      venue.id,
      PAGE + 2,
      `x-${t}`,
      undefined,
      original
    )

    // --- Staff portfolio.
    const staffPage = await signInAs(browser, admin, staff, baseURL!)
    const checkStaffOptimiser = forbidImageOptimiser(staffPage)
    await expect(staffPage).toHaveURL(/\/staff$/)
    const portfolio = staffPage.getByRole("list", { name: "Your portfolio" })
    const firstTile = portfolio.getByRole("button").first()
    await expectImageLoaded(firstTile.locator("img"))
    expect(await firstTile.locator("img").getAttribute("src")).toBe(
      `/api/media/${photos[0].id}/thumb`
    )

    // Capture a link the route issued now, then let it expire.
    const issued = await staffPage.request.get(
      `/api/media/${photos[0].id}/thumb`,
      { maxRedirects: 0 }
    )
    expect(issued.status()).toBe(302)
    const signed = issued.headers()["location"]
    expect(signed).toMatch(/\/storage\/v1\/object\/sign\/media\//)
    expect((await staffPage.request.get(signed)).status()).toBe(200)
    await staffPage.waitForTimeout((TTL + 2) * 1000)
    const stale = await staffPage.request.get(signed)
    expect(stale.ok(), "the captured link should have expired").toBe(false)

    // After expiry: the viewer, more pages and a focus refresh all load.
    await firstTile.click()
    const staffViewer = staffPage.getByRole("dialog")
    await expectImageLoaded(staffViewer.locator("img"))
    await staffViewer.press("Escape")
    await staffPage.getByRole("button", { name: "Load more" }).click()
    await expect(portfolio.getByRole("button")).toHaveCount(PAGE + 2)
    await expectImageLoaded(portfolio.getByRole("button").last().locator("img"))
    await staffPage.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expectImageLoaded(firstTile.locator("img"))
    await expect(previewAlert(staffPage)).toHaveCount(0)

    // A load that fails once (e.g. expired between redirect and fetch) is
    // re-signed and retried once, invisibly.
    let failures = 0
    await staffPage.route(`**/api/media/${photos[1].id}/thumb*`, (route) => {
      if (failures++ === 0) return route.fulfill({ status: 503, body: "" })
      return route.continue()
    })
    await staffPage.reload()
    const second = portfolio.getByRole("button").nth(1).locator("img")
    await expectImageLoaded(second)
    expect(await second.getAttribute("src")).toBe(
      `/api/media/${photos[1].id}/thumb?r=1`
    )
    expect(failures).toBe(2)
    await expect(previewAlert(staffPage)).toHaveCount(0)

    // A load that keeps failing shows a visible error; Try again recovers.
    await staffPage.unroute(`**/api/media/${photos[1].id}/thumb*`)
    await staffPage.route(`**/api/media/${photos[2].id}/thumb*`, (route) =>
      route.fulfill({ status: 503, body: "" })
    )
    await staffPage.reload()
    const alert = previewAlert(staffPage)
    await expect(alert).toHaveText(/1 preview could not load\./)
    await expect(
      portfolio.getByRole("button").nth(2).locator("img")
    ).toHaveCount(0)
    await staffPage.unroute(`**/api/media/${photos[2].id}/thumb*`)
    await alert.getByRole("button", { name: "Try again" }).click()
    await expectImageLoaded(portfolio.getByRole("button").nth(2).locator("img"))
    await expect(alert).toHaveCount(0)
    checkStaffOptimiser()

    // --- Admin portfolio (/admin/staff/[id]): the same gallery and recovery.
    const adminPage = await signInAs(browser, admin, adminUser, baseURL!)
    const checkAdminOptimiser = forbidImageOptimiser(adminPage)
    await adminPage.goto(`/admin/staff/${staff.id}`)
    const adminGrid = adminPage.getByRole("list", {
      name: `TEST e2e-lib-expiry-${t}'s portfolio`,
    })
    await expect(adminGrid.getByRole("button")).toHaveCount(PAGE)
    await expectImageLoaded(
      adminGrid.getByRole("button").first().locator("img")
    )
    await adminPage.waitForTimeout((TTL + 2) * 1000)
    await adminGrid.getByRole("button").first().click()
    const viewer = adminPage.getByRole("dialog")
    await expectImageLoaded(viewer.locator("img"))
    await expect(viewer.getByText("Venue at upload")).toBeVisible()
    const downloadLink = viewer.getByRole("link", { name: "Download original" })
    await expect(downloadLink).toHaveAttribute(
      "href",
      `/api/media/${photos[0].id}/download`
    )
    await expect(viewer.getByRole("button", { name: "Delete" })).toBeVisible()

    // Download, preview and thumbnail responses: private, typed, not sniffable.
    const download = await adminPage.request.get(
      `/api/media/${photos[0].id}/download`
    )
    expect(download.status()).toBe(200)
    const dh = download.headers()
    expect(dh["content-type"]).toBe("image/jpeg")
    expect(dh["content-disposition"]).toMatch(
      new RegExp(`^attachment; filename="x-${t}-00\\.jpg"`)
    )
    expect(dh["x-content-type-options"]).toBe("nosniff")
    expect(dh["cache-control"]).toBe("private, no-store")
    expect(new Uint8Array(await download.body())).toEqual(original)
    for (const route of ["thumb", "preview"]) {
      const r = await adminPage.request.get(
        `/api/media/${photos[0].id}/${route}`,
        { maxRedirects: 0 }
      )
      expect(r.status(), route).toBe(302)
      expect(r.headers()["cache-control"], route).toBe("private, no-store")
      expect(r.headers()["x-content-type-options"], route).toBe("nosniff")
      expect(r.headers()["location"], route).toMatch(
        /\/storage\/v1\/object\/sign\/media\//
      )
    }

    // Admin delete from the portfolio.
    await viewer.getByRole("button", { name: "Delete" }).click()
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click()
    await expect(
      adminGrid.getByRole("button", {
        name: new RegExp(`^Photo, x-${t}-00\\.jpg`),
      })
    ).toHaveCount(0)
    checkAdminOptimiser()
    await staffPage.context().close()
    await adminPage.context().close()
  })
})
