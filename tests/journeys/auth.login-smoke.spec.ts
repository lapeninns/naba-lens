import { expect, test } from "@playwright/test"

import { openEmailLink } from "../e2e/helpers/email-link"
import { SUBJECTS, mailboxIds, waitForLink } from "../e2e/helpers/mailpit"
import { requireIsolatedStack } from "../e2e/helpers/stack"
import { portfolioList, tile } from "../e2e/helpers/ui"
import { JOURNEY_PEOPLE } from "../support/journey-world"

// Proves the journey harness end to end on the fixture world: a real sign-in
// through the login form and the stack's Mailpit inbox, then the staff
// portfolio of the seeded user (and nobody else's media).
test("auth.login-smoke: staff A signs in and sees only their own photo", async ({
  page,
}, testInfo) => {
  requireIsolatedStack()
  const staff = JOURNEY_PEOPLE.staffA

  await page.goto("/staff")
  await expect(page).toHaveURL(/\/login$/)

  const seen = await mailboxIds(staff.email)
  await page.getByLabel("Email").fill(staff.email)
  await page.getByRole("button", { name: "Send sign-in link" }).click()
  await expect(
    page.getByRole("heading", { name: "Check your email" })
  ).toBeVisible()

  await openEmailLink(
    page,
    await waitForLink(staff.email, SUBJECTS.signIn, seen)
  )
  await expect(page).toHaveURL(/\/staff$/)
  await expect(page.getByRole("heading", { name: staff.name })).toBeVisible()

  const list = portfolioList(page)
  await expect(tile(list, "Photo", "JOURNEY staffA-photo.jpg")).toBeVisible()
  await expect(tile(list, "Video", "JOURNEY staffA-video.mp4")).toBeVisible()
  await expect(tile(page, "Photo", "JOURNEY staffB-photo.jpg")).toHaveCount(0)
  await expect(tile(page, "Photo", "JOURNEY staffC-photo.jpg")).toHaveCount(0)

  await testInfo.attach("staff-a-portfolio", {
    body: await page.screenshot(),
    contentType: "image/png",
  })
})
