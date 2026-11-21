import { expect, test } from "@playwright/test"

import { signIn } from "../../support/identities"
import { provisionManagerWorld } from "../helpers/manager-world"
import { provisioner, psql, requireIsolatedStack } from "../helpers/stack"
import {
  as,
  closeAll,
  evidence,
  expectNoSidewaysScroll,
  NARROW,
  PHONE,
  sql,
} from "./helpers"

/**
 * S3-R5 repairs on the manager Venue hub (spec §7 M5, §8 A2, §6 S3).
 *
 *   K3  A staff "Report a change" reaches Venue › Reported changes, where
 *       the manager opens what it is about and marks it dealt with.
 *   V1  The main reviewer is the admin's: the manager sees it read-only and
 *       nominates only the backup.
 *
 * The staff report is filed by the staff member's own session through
 * report_slot_change (the staff Album is S3-R3's to repair, D1); every
 * manager decision is made on the page. The database is read only to check
 * what a page did.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

const reportState = (id: string) =>
  psql(`select state || ':' || coalesce(decision_note, '')
    from public.slot_change_reports where id = ${sql(id)}::uuid`)

test("K3: a staff report reaches Venue › Reported changes and is dealt with there", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const staff = await signIn(provisioner(), w.staffA1.email)
  const { data, error } = await staff.rpc(
    "report_slot_change" as never,
    {
      p_kind: "dish",
      p_subject_id: w.itemsA.pie,
      p_reason: "no_longer_served",
      p_note: "Off the menu since Monday",
    } as never
  )
  if (error) throw new Error(`fixture report failed: ${error.message}`)
  const reportId = (data as { report: { id: string } }).report.id

  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto("/manager/venue")
  const link = mgr.getByRole("link", { name: /Reported changes/ })
  await expect(link).toContainText("1 reported by staff")
  await link.click()
  await expect(mgr).toHaveURL(/\/manager\/venue\/reports$/)
  const row = mgr.locator(`[data-report="${reportId}"]`)
  await expect(row).toContainText("Pie")
  await expect(row).toContainText("Dish · It's no longer served")
  await expect(row).toContainText("“Off the menu since Monday”")
  await expect(row).toContainText(`Reported by ${w.staffA1.name}`)
  await expect(
    row.getByRole("link", { name: "Open dish: Pie" })
  ).toHaveAttribute("href", `/manager/menu/${w.itemsA.pie}`)
  // Venue B's manager never sees venue A's report.
  const other = await as(browser, w.mgrB, PHONE)
  await other.goto("/manager/venue/reports")
  await expect(other.locator(`[data-report="${reportId}"]`)).toHaveCount(0)

  // Dealt with opens the optional note (second handoff); Mark dealt with
  // decides.
  await row.getByRole("button", { name: "Dealt with: Pie" }).click()
  await row.getByLabel(/Note/).fill("Marked unavailable")
  await row.getByRole("button", { name: "Mark dealt with: Pie" }).click()
  await expect(row.getByRole("status")).toHaveText("Marked as dealt with.")
  expect(reportState(reportId)).toBe("resolved:Marked unavailable")
  await evidence(mgr, "k3-reported-changes")

  await mgr.goto("/manager/venue/reports")
  await expect(mgr.locator(`[data-report="${reportId}"]`)).toHaveCount(0)
  await expect(mgr.getByText(/Nothing reported/)).toBeVisible()

  // History names the events.
  await mgr.goto("/manager/venue/history")
  await expect(
    mgr.getByText("Reported change dealt with").first()
  ).toBeVisible()
})

test("K3 at 320 px: the report row fits a narrow phone", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const staff = await signIn(provisioner(), w.staffA1.email)
  const { error } = await staff.rpc(
    "report_slot_change" as never,
    {
      p_kind: "dish",
      p_subject_id: w.itemsA.soup,
      p_reason: "other",
      p_note: "The bowl changed to a much wider stoneware dish last week",
    } as never
  )
  if (error) throw new Error(`fixture report failed: ${error.message}`)
  const mgr = await as(browser, w.mgrA, NARROW)
  await mgr.goto("/manager/venue/reports")
  await expect(mgr.getByRole("button", { name: "Dismiss: Soup" })).toBeVisible()
  await expectNoSidewaysScroll(mgr, "reported changes at 320 px")
})

test("V1: the manager sees the main reviewer read-only and nominates the backup", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const { error } = await w.adminDb.rpc("admin_set_venue_reviewer", {
    p_venue_id: w.venueA.id,
    p_responsibility: "main",
    p_profile_id: w.mgrA.id,
    p_reason: "DEV-FIXTURE main reviewer",
    p_revision: 0,
  })
  if (error) throw new Error(`fixture main reviewer failed: ${error.message}`)

  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto("/manager/venue#reviewers")
  const form = mgr.locator('[data-slot="reviewers-form"]')
  await expect(form.locator('[data-reviewer="main"]')).toHaveText(w.mgrA.name)
  await expect(
    form.getByRole("combobox", { name: /Main reviewer/ })
  ).toHaveCount(0)
  // The only other manager-eligible person is mgrA, who is main: nobody else
  // can be the backup yet, and the page says so.
  await expect(form.getByRole("status")).toContainText(
    "Nobody else here holds manager permission yet"
  )
  // The database refuses a manager's change to main whatever the page shows.
  const db = await signIn(provisioner(), w.mgrA.email)
  const refused = await db.rpc("set_venue_reviewer", {
    p_venue_id: w.venueA.id,
    p_role: "main",
    p_profile_id: null as unknown as string,
  })
  expect(refused.error?.message).toBe("main_reviewer_admin_only")
  expect(
    psql(`select count(*) from public.venue_reviewer_assignments
      where venue_id = ${sql(w.venueA.id)}::uuid and role = 'main'
        and ended_at is null and profile_id = ${sql(w.mgrA.id)}::uuid`)
  ).toBe("1")
})
