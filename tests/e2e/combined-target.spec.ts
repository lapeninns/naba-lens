import { expect, test } from "@playwright/test"

import { UI_TEXT } from "../../lib/amenities/contract"
import {
  amenityOk,
  captureForm,
  provisionAmenitiesWorld,
  question,
  readyCheck,
  seedPhoto,
  sessionOf,
  submitAndComplete,
  submitArgs,
} from "./helpers/amenities-world"
import { activeItemId, labelledPhoto } from "./helpers/manager-world"
import { activateMenu, createMenuDraft, ok } from "./helpers/menus"
import { psql } from "./helpers/stack"
import { signedInPage } from "./helpers/world"

test("a staff target combines distinct menu items and completed amenity checks", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const w = await provisionAmenitiesWorld()
  const period = psql("select private.current_london_month()")
  psql(`insert into private.venue_monthly_completion_targets
    (venue_id, starts_on, target_count) values ('${w.venueA.id}', '${period}', 5)`)

  const admin = await sessionOf(w.admin)
  await activateMenu(
    admin,
    await createMenuDraft(admin, w.venueA.id, `Completion target ${w.tag}`)
  )
  const manager = await sessionOf(w.managerA)
  for (const key of [
    "starters--soup",
    "starters--soup",
    "starters--salad",
    "mains--pie",
  ]) {
    const itemId = activeItemId(w.venueA.id, key)
    const assetId = await labelledPhoto(w.staffA, w.venueA, [itemId])
    const revision = Number(
      psql(`select coalesce(
      (select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`)
    )
    await ok(
      manager.rpc("review_menu_item_photo", {
        p_asset_id: assetId,
        p_item_id: itemId,
        p_variant_id: null as unknown as string,
        p_decision: "accepted",
        p_expected_revision: revision,
      })
    )
  }

  const parking = await readyCheck(w, w.venueA, "onsite_parking", w.staffA)
  await amenityOk(
    await sessionOf(w.staffA),
    "amenity_submit_finding",
    submitArgs(parking, "no", [], { p_reason: "Street parking only." })
  )
  const darts = await readyCheck(w, w.venueA, "darts", w.staffA)
  const photo = await seedPhoto(w.staffA, w.venueA, `target-${w.tag}`)

  const staff = await signedInPage(browser, w.staffA)
  try {
    await expect(
      staff.getByRole("progressbar", { name: "4 of 5 items completed" })
    ).toBeVisible()
    await staff.getByRole("link", { name: "See this month's target" }).click()
    await expect(
      staff.getByRole("heading", { name: "Monthly target", exact: true })
    ).toBeVisible()
    await expect(
      staff.getByRole("img", { name: "4 of 5 items completed" })
    ).toBeVisible()
    await expect(
      staff.getByText("3 menu items · 1 amenity check", { exact: true })
    ).toBeVisible()
    await expect(
      staff.getByRole("link", { name: "Browse menu items" })
    ).toHaveAttribute("href", "/staff/menu")
    await expect(
      staff.getByRole("heading", { name: "Add photos for this month" })
    ).toHaveCount(0)
    await expect(staff.getByText("Target met", { exact: true })).toHaveCount(0)

    await staff
      .getByRole("link", { name: "See assigned checks on Home" })
      .click()
    await staff
      .getByRole("region", { name: UI_TEXT.staffSection })
      .getByRole("link", { name: question("darts"), exact: true })
      .click()
    const form = captureForm(staff)
    await form.answer("yes")
    await form.attach(photo)
    await submitAndComplete(staff, darts)

    await staff.goto("/staff/tasks/month")
    await expect(
      staff.getByRole("img", { name: "5 of 5 items completed" })
    ).toBeVisible()
    await expect(
      staff.getByText("3 menu items · 2 amenity checks", { exact: true })
    ).toBeVisible()
    await expect(staff.getByText("Target met", { exact: true })).toBeVisible()
  } finally {
    await staff.context().close()
  }

  const managerPage = await signedInPage(browser, w.managerA)
  try {
    await expect(managerPage).toHaveURL(/\/manager$/)
    const targetRow = managerPage
      .getByRole("region", { name: /^Staff targets for / })
      .getByRole("listitem")
      .filter({ has: managerPage.getByText(w.staffA.name, { exact: true }) })
    await expect(targetRow).toContainText("5 of 5 completed")
    await expect(targetRow).toContainText("3 menu items · 2 amenity checks")
  } finally {
    await managerPage.context().close()
  }

  // A completed check at the unconfigured venue leaves its photo target at zero.
  await ok(
    admin.rpc("set_monthly_target", {
      p_staff_id: w.staffB.id,
      p_venue_id: w.venueB.id,
      p_period_month: period,
      p_target_count: 5,
    })
  )
  const legacyParking = await readyCheck(
    w,
    w.venueB,
    "onsite_parking",
    w.staffB
  )
  await amenityOk(
    await sessionOf(w.staffB),
    "amenity_submit_finding",
    submitArgs(legacyParking, "no", [], { p_reason: "Street parking only." })
  )
  const legacy = await signedInPage(browser, w.staffB)
  try {
    await legacy.goto("/staff/tasks/month")
    await expect(
      legacy.getByRole("heading", { name: "Monthly photos", exact: true })
    ).toBeVisible()
    await expect(
      legacy.getByRole("img", { name: "0 of 5 photos accepted" })
    ).toBeVisible()
    await expect(
      legacy.getByRole("heading", { name: "Add photos for this month" })
    ).toBeVisible()
  } finally {
    await legacy.context().close()
  }
})
