import {
  devices,
  expect,
  test,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test"

import { labelledPhoto, provisionManagerWorld } from "./helpers/manager-world"
import { psql, requireIsolatedStack } from "./helpers/stack"
import { signedInPage } from "./helpers/world"

/**
 * A venue manager whose access ends while the workspace is open (charter
 * E-1). The workspace layout is not re-rendered on client navigation, so
 * these drive the in-app nav rather than page loads: after an admin revokes
 * the grant, or converts the account back to staff, the next tab the manager
 * opens must say so (Venue access unavailable, with the shell and its nav
 * gone, or the staff home), never "Try again", and show nothing from the
 * venue. Page loads after a revoke are covered by manager-workspace.spec.ts.
 *
 * Chromium only (the phone project selects files by name in
 * playwright.config.ts): the revoke runs in a 390x844 touch context, the
 * account change at 1280x800, so both nav layouts are driven.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(180_000)

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  userAgent: devices["Pixel 7"].userAgent,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}
const DESKTOP: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
}

const OVERVIEW = /\/manager$/
const WORKSPACE_NAV = "Venue workspace"

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts())
    await context.close().catch(() => undefined)
})

async function evidence(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await test.info().attach(name, { path, contentType: "image/png" })
}

const navLink = (page: Page, name: RegExp) =>
  page
    .getByRole("navigation", { name: WORKSPACE_NAV })
    .getByRole("link", { name })
    .filter({ visible: true })
    .first()

const main = (page: Page) => page.getByRole("main")

/** No error boundary and no retry offer: access ending is not a failure. */
async function expectNoErrorState(page: Page) {
  await expect(page.getByText(/We couldn't load/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)
}

test.describe("manager access ends mid-session", () => {
  test("a revoked grant: the next tab shows Venue access unavailable without the workspace nav", async ({
    browser,
  }) => {
    const w = await provisionManagerWorld()
    await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])

    const mgr = await signedInPage(browser, w.mgrA, PHONE)
    await mgr.goto("/manager/review")
    await expect(main(mgr)).toContainText(w.staffA1.name)

    const grant = psql(
      `select id from public.venue_manager_grants where staff_id = '${w.mgrA.id}'::uuid and revoked_at is null`
    )
    const revoked = await w.adminDb.rpc("revoke_venue_manager", {
      p_grant_id: grant,
      p_reason: "DEV FIXTURE: access ends mid-session",
    })
    expect(revoked.error).toBeNull()

    // A client navigation inside the open workspace.
    await navLink(mgr, /^Menu/).click()
    await expect(mgr).toHaveURL(OVERVIEW)
    await expect(
      mgr.getByRole("heading", { level: 1, name: "Venue access unavailable" })
    ).toBeVisible()
    await expect(mgr.getByText("Your venue access has ended.")).toBeVisible()
    // The shell is replaced: no tabs that loop back to this card.
    await expect(
      mgr.getByRole("navigation", { name: WORKSPACE_NAV })
    ).toHaveCount(0)
    await expect(mgr.getByRole("button", { name: "Sign out" })).toBeVisible()
    await expectNoErrorState(mgr)
    // Nothing from the venue it lost.
    await expect(mgr.locator("body")).not.toContainText(w.staffA1.name)
    await expect(mgr.locator("body")).not.toContainText(w.venueA.name)
    await evidence(mgr, "revoked-client-navigation")

    // Back and forward stay on the unavailable state.
    await mgr.goBack()
    await expect(
      mgr.getByRole("heading", { level: 1, name: "Venue access unavailable" })
    ).toBeVisible()
    await expect(mgr.locator("body")).not.toContainText(w.staffA1.name)
  })

  test("an account converted back to staff: the next tab goes to the staff home", async ({
    browser,
  }) => {
    const w = await provisionManagerWorld()

    const mgr = await signedInPage(browser, w.mgrB, DESKTOP)
    await mgr.goto("/manager/menu")
    await expect(
      mgr.getByRole("navigation", { name: WORKSPACE_NAV }).first()
    ).toBeAttached()

    const converted = await w.adminDb.rpc("convert_manager_to_staff", {
      p_profile_id: w.mgrB.id,
      p_venue_id: w.venueB.id,
      p_reason: "DEV FIXTURE: role changes mid-session",
      p_client_request_key: `e2e-e1-${w.tag}`,
    })
    expect(converted.error).toBeNull()

    await navLink(mgr, /^Review/).click()
    await expect(mgr).not.toHaveURL(/\/manager(\/|$)/)
    await expect(mgr).toHaveURL(/\/staff\//)
    await expectNoErrorState(mgr)
    await evidence(mgr, "converted-client-navigation")
  })
})
