import { expect, test } from "@playwright/test"

import {
  labelledPhoto,
  photoRow,
  provisionManagerWorld,
} from "../helpers/manager-world"
import { requireIsolatedStack } from "../helpers/stack"
import {
  acceptAsManager,
  as,
  closeAll,
  DESKTOP,
  evidence,
  note,
} from "./helpers"

/**
 * AC20 (spec §9.1, §22) is deferred by FA-42: edited versions and crops need a
 * media worker, so Release 1 has no way to edit an approved image in the app.
 * This pins today's behaviour: no edit or crop action is offered to the
 * manager or the admin, so an approved image can only change through a new
 * upload, which goes through review like any other; the original is kept.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(180_000)
test.afterEach(({ browser }) => closeAll(browser))

const EDIT = /\b(edit|crop|rotate|replace image|new version)\b/i

test("AC20 (deferred, FA-42): no in-app editing of an approved photo; the approved original stays as it was", async ({
  browser,
}) => {
  note(
    "deferred",
    "FA-42: edited versions and crops are Release 2. Pinned: no edit action exists, so nothing visible changes without a new reviewed upload."
  )
  const w = await provisionManagerWorld()
  const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
  await acceptAsManager(w.mgrA, asset, w.itemsA.soup)
  const accepted = photoRow(asset)

  const mgr = await as(browser, w.mgrA, DESKTOP)
  await mgr.goto(`/manager/review/photo/${asset}`)
  await expect(
    mgr.getByRole("heading", { level: 1, name: "Photo review" })
  ).toBeVisible()
  await expect(mgr.getByRole("button", { name: EDIT })).toHaveCount(0)
  await expect(mgr.getByRole("link", { name: EDIT })).toHaveCount(0)

  const admin = await as(browser, w.admin, DESKTOP)
  await admin.goto(`/admin/library/${asset}`)
  await expect(admin.getByTestId("asset-detail")).toBeVisible()
  await expect(admin.getByRole("button", { name: EDIT })).toHaveCount(0)
  await expect(
    admin.getByRole("button", { name: "Download original" })
  ).toBeVisible()
  await evidence(admin, "ac20-admin-detail")

  expect(photoRow(asset)).toBe(accepted)
})
