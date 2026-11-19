import { expect, test } from "@playwright/test"

import { openEmailLink } from "../e2e/helpers/email-link"
import { SUBJECTS, mailboxIds, waitForLink } from "../e2e/helpers/mailpit"
import { myPhotoTile, openMe } from "../e2e/helpers/s4-photos"
import { requireIsolatedStack } from "../e2e/helpers/stack"
import { openMyPhotos, STAFF_TABS } from "../e2e/helpers/ui"
import { JOURNEY_PEOPLE } from "../support/journey-world"

// Proves the journey harness end to end on the fixture world: a real sign-in
// through the login form and the stack's Mailpit inbox, then the seeded
// user's My photos (DESIGN.md §5e) with their own media and nobody else's.
test("auth.login-smoke: staff A signs in and sees only their own photo", async ({
  page,
}, testInfo) => {
  requireIsolatedStack()
  const staff = JOURNEY_PEOPLE.staffA

  await page.goto(STAFF_TABS.photos)
  // Signed out lands on /login, remembering My photos as the page to return to.
  await expect(page).toHaveURL(/\/login\?next=%2Fstaff%2Fphotos$/)

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
  // Signing in returns to the page asked for (My photos), not Today.
  await expect(page).toHaveURL(/\/staff\/photos$/)
  await openMyPhotos(page)

  await expect(
    await myPhotoTile(page, "JOURNEY staffA-photo.jpg")
  ).toBeVisible()
  await expect(
    await myPhotoTile(page, "JOURNEY staffA-video.mp4")
  ).toBeVisible()
  await expect(await myPhotoTile(page, "JOURNEY staffB-photo.jpg")).toHaveCount(
    0
  )
  await expect(await myPhotoTile(page, "JOURNEY staffC-photo.jpg")).toHaveCount(
    0
  )

  await testInfo.attach("staff-a-my-photos", {
    body: await page.screenshot(),
    contentType: "image/png",
  })

  // Me's profile header names the person (DESIGN.md §5b).
  const profile = await openMe(page)
  await expect(profile.getByRole("heading", { name: staff.name })).toBeVisible()
})
