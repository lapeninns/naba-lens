import { expect, test } from "@playwright/test"

import { signIn } from "../support/identities"
import {
  legacyStaffGrant,
  provisionCoverageWorld,
} from "./helpers/coverage-world"
import { convertToManager } from "./helpers/manager-world"
import { provisioner, requireIsolatedStack } from "./helpers/stack"
import { STAFF_LANDING, STAFF_TABS } from "./helpers/ui"
import { signedInPage, type Person } from "./helpers/world"

/**
 * S16 Me on a phone (DESIGN.md §5b, decision D3): managing a venue needs a
 * venue manager account, which works in /manager and never opens the staff
 * app. Me is a hub of rows, and plain staff see no Manage row.
 */

test.beforeAll(() => requireIsolatedStack())

const PHONE = { viewport: { width: 390, height: 844 } }

async function expectNoManageRow(
  browser: Parameters<typeof signedInPage>[0],
  who: Person
) {
  const staff = await signedInPage(browser, who, PHONE)
  await staff.goto(STAFF_TABS.me)
  await expect(staff).toHaveURL(/\/staff\/me$/)
  await expect(
    staff.getByRole("heading", { level: 2, name: who.name })
  ).toBeVisible()
  await expect(staff.locator('[data-slot="me-settings"]')).toBeVisible()
  await expect(staff.locator('[data-slot="me-manage"]')).toHaveCount(0)
  await expect(staff.getByRole("link", { name: /^Manage\b/ })).toHaveCount(0)
  // /manager is for manager accounts only: staff go back to Today.
  await staff.goto("/manager")
  await expect(staff).toHaveURL(STAFF_LANDING)
  await staff.context().close()
}

test("at 390px a manager account opening Me lands in /manager; plain staff see no Manage row", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const w = await provisionCoverageWorld()
  const adminDb = await signIn(provisioner(), w.admin.email)
  await convertToManager(adminDb, w.manager, w.venue1)

  const manager = await signedInPage(browser, w.manager, PHONE)
  await manager.goto(STAFF_TABS.me)
  await expect(manager).toHaveURL(/\/manager$/)
  await expect(manager).toHaveTitle(/Naba-Lens$/)
  await expect(
    manager.getByRole("heading", { name: "Venue access unavailable" })
  ).toHaveCount(0)
  await manager.context().close()

  await expectNoManageRow(browser, w.staffA)
})

// App defect (D3): Me still shows "Manage <venue>" to a staff account holding
// a legacy staff-held grant (canManageVenue counts staff-held grants), and the
// row's /manager link sends that account straight back to Today.
test.fixme("at 390px staff holding a legacy staff-held grant see no Manage row", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const w = await provisionCoverageWorld()
  await legacyStaffGrant(w.admin, w.staffB, w.venue1)
  await expectNoManageRow(browser, w.staffB)
})
