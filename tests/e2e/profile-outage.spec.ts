import { expect, test, type Browser, type Page } from "@playwright/test"

import { createIdentity, createVenue } from "../support/identities"
import { provisioner, psql } from "./helpers/stack"

// Final review F4: the /admin and /staff layouts read the profile for their
// role gate, outside the segment's own error.tsx. A failed read (database
// trouble) must show the app's "could not load / Try again" page, not Next's
// bare 500 document, and must never render the app or its data. Once the
// database recovers, Try again re-requests the page and it loads.
//
// The outage is a revoked SELECT on profiles for signed-in users (Postgres
// 42501), restored in `finally`. Playwright runs one worker, so no other spec
// runs while it lasts.

const OUTAGE = "revoke select on public.profiles from authenticated"
const RESTORE = "grant select on public.profiles to authenticated"

async function signedIn(browser: Browser, email: string) {
  const { data, error } = await provisioner().auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw error
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/confirm"))
  return page
}

async function expectRetryPage(page: Page, path: string) {
  const res = await page.goto(path)
  expect(res, path).not.toBeNull()
  // Not Next's bare error document: the app's own page, with a way back.
  await expect(
    page.getByRole("heading", { name: /could not load/i })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
  const html = await res!.text()
  expect(html).not.toContain("Internal Server Error")
  // Fails closed: neither app shell is rendered.
  await expect(
    page.getByRole("button", { name: "Upload photos or videos" })
  ).toHaveCount(0)
  await expect(page.getByRole("combobox", { name: "Venue" })).toHaveCount(0)
}

test.describe("profile read outage on the role-gated layouts", () => {
  test.skip(({ isMobile }) => isMobile, "server error path; desktop run")

  test("shows the retry page, then recovers through Try again", async ({
    browser,
  }) => {
    const service = provisioner()
    const venue = await createVenue(service, "e2e-outage")
    const staff = await createIdentity(service, {
      label: "e2e-outage-staff",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    const admin = await createIdentity(service, {
      label: "e2e-outage-admin",
      role: "admin",
      session: false,
    })
    const staffPage = await signedIn(browser, staff.email)
    const adminPage = await signedIn(browser, admin.email)

    psql(OUTAGE)
    try {
      await expectRetryPage(adminPage, "/admin/staff")
      await expectRetryPage(adminPage, "/admin")
      // A staff member asking for /admin is not let in either.
      await expectRetryPage(staffPage, "/admin")
      await expectRetryPage(staffPage, "/staff")
    } finally {
      psql(RESTORE)
    }

    await adminPage.getByRole("button", { name: "Try again" }).click()
    await expect(
      adminPage.getByRole("combobox", { name: "Venue" })
    ).toBeVisible()
    await staffPage.getByRole("button", { name: "Try again" }).click()
    await expect(
      staffPage
        .getByRole("button", { name: "Upload photos or videos" })
        .first()
    ).toBeVisible()

    await staffPage.context().close()
    await adminPage.context().close()
  })
})
