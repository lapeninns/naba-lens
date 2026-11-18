import { expect, test } from "@playwright/test"

import {
  labelAsUploader,
  provisionManagerWorld,
} from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { psql, requireIsolatedStack } from "../helpers/stack"
import { openPortfolio, uploadThroughDialog } from "../helpers/ui"
import {
  acceptAsManager,
  as,
  closeAll,
  DESKTOP,
  evidence,
  PHONE,
  sql,
} from "./helpers"

/**
 * AC21 (spec §12.4, §22; FA-35): an exact duplicate, found by the SHA-256 of
 * its original at finalisation, never adds coverage or contribution credit.
 * The same file is uploaded twice through the real upload sheet, so the hash
 * is computed by the app, not the fixture.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(300_000)
test.afterEach(({ browser }) => closeAll(browser))

const assetsNamed = (uploaderId: string, name: string) =>
  psql(`select coalesce(string_agg(id::text, ',' order by created_at), '')
    from public.media_assets
    where uploader_id = ${sql(uploaderId)}::uuid and original_filename = ${sql(name)}
      and upload_state = 'ready'`)
    .split(",")
    .filter(Boolean)

test("AC21: an exact duplicate does not inflate coverage or contribution counts, and the manager can mark it", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const file = await syntheticJpeg(`ac21-${w.tag}.jpg`)

  const staff = await as(browser, w.staffA1, PHONE)
  await openPortfolio(staff)
  await uploadThroughDialog(staff, [file])
  const [original] = assetsNamed(w.staffA1.id, file.name)
  expect(original).toBeTruthy()
  await labelAsUploader(w.staffA1, w.venueA.id, original!, [w.itemsA.soup])
  await acceptAsManager(w.mgrA, original!, w.itemsA.soup)

  const slot = () =>
    psql(`select state || ':' || pending_count from private.coverage_slot_rows(${sql(w.venueA.id)}::uuid)
      where slot_id = ${sql(w.itemsA.soup)}::uuid`)
  const covered = () =>
    psql(`select count(*) from private.coverage_slot_rows(${sql(w.venueA.id)}::uuid)
      where state = 'covered'`)
  expect(slot()).toBe("covered:0")
  const coveredBefore = covered()

  // The same bytes again.
  await openPortfolio(staff)
  await uploadThroughDialog(staff, [file])
  const both = assetsNamed(w.staffA1.id, file.name)
  expect(both).toHaveLength(2)
  const copy = both[1]!
  expect(
    psql(
      `select duplicate_of_asset_id from public.media_assets where id = ${sql(copy)}::uuid`
    )
  ).toBe(original)
  await labelAsUploader(w.staffA1, w.venueA.id, copy, [w.itemsA.soup])

  // Counts do not move: no second cover, no pending count, no credit.
  expect(slot()).toBe("covered:0")
  expect(covered()).toBe(coveredBefore)
  expect(
    psql(`select private.media_duplicate_suppressed(${sql(copy)}::uuid)`)
  ).toBe("t")

  // The manager sees it flagged and marks it as a duplicate.
  const mgr = await as(browser, w.mgrA, DESKTOP)
  await mgr.goto("/manager/review?view=list&dupes=1")
  await expect(
    mgr.getByRole("list", { name: "Photos to review" })
  ).toContainText("Possible duplicate")
  await mgr.goto(`/manager/review/photo/${copy}`)
  await expect(mgr.getByText("Same file already here")).toBeVisible()
  await mgr.locator('[data-review-action="mark-duplicate"]').first().click()
  const dialog = mgr.getByRole("dialog", { name: "Mark duplicate" })
  await dialog.locator(`[data-duplicate-target="${original}"]`).first().click()
  await dialog.locator('[data-review-action="confirm-duplicate"]').click()
  await expect(mgr.getByText(/^Marked duplicate by /)).toBeVisible()
  await evidence(mgr, "ac21-marked-duplicate")
  expect(
    psql(`select action || ':' || duplicate_of_asset_id from public.review_dispositions
      where asset_id = ${sql(copy)}::uuid order by id desc limit 1`)
  ).toBe(`duplicate:${original}`)
  expect(slot()).toBe("covered:0")
  expect(covered()).toBe(coveredBefore)

  // The staff member is told it doesn't count twice.
  await openPortfolio(staff)
  await expect(
    staff.getByText(/doesn't count twice|won't count twice/).first()
  ).toBeVisible()
  await evidence(staff, "ac21-staff-duplicate")
})
