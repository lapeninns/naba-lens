import { expect, test } from "@playwright/test"

import {
  legacyStaffGrant,
  provisionCoverageWorld,
} from "./helpers/coverage-world"
import { requireIsolatedStack } from "./helpers/stack"
import { signedInPage } from "./helpers/world"

/**
 * S16 Me on a phone: the Manage row is a venue manager's way into Manage when
 * Home has nothing to review; plain staff never see it.
 */

test.beforeAll(() => requireIsolatedStack())

const PHONE = { viewport: { width: 390, height: 844 } }

test("at 390px a granted manager reaches Manage from Me; plain staff see no Manage row", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const w = await provisionCoverageWorld()
  // A staff-held (legacy) grant: the transitional rule keeps /staff/manage.
  await legacyStaffGrant(w.admin, w.manager, w.venue1)

  const manager = await signedInPage(browser, w.manager, PHONE)
  await manager.goto("/staff")
  const row = manager
    .getByRole("navigation", { name: "Manage" })
    .getByRole("link", { name: `Manage ${w.venue1.name}` })
  await expect(row).toBeVisible()
  await expect(row).toHaveAccessibleDescription(
    "Review, checklist, menu and team"
  )
  const box = await row.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(52)
  await row.click()
  await expect(manager).toHaveURL(/\/staff\/manage$/)
  await expect(manager).toHaveTitle("Manage · Naba-Lens")
  await expect(
    manager.getByRole("heading", { name: "Manage isn't available" })
  ).toHaveCount(0)
  await manager.context().close()

  const staff = await signedInPage(browser, w.staffA, PHONE)
  await staff.goto("/staff")
  await expect(
    staff.getByRole("heading", { level: 1, name: w.staffA.name })
  ).toBeVisible()
  await expect(staff.getByRole("navigation", { name: "Manage" })).toHaveCount(0)
  await expect(staff.getByRole("link", { name: /^Manage\b/ })).toHaveCount(0)
  await staff.context().close()
})
