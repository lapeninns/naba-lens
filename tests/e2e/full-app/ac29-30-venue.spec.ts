import { expect, test } from "@playwright/test"

import { seedImages } from "../helpers/coverage-world"
import { provisionManagerWorld } from "../helpers/manager-world"
import { psql, requireIsolatedStack } from "../helpers/stack"
import {
  as,
  closeAll,
  DESKTOP,
  evidence,
  expectNoSidewaysScroll,
  NARROW,
  PHONE,
  sql,
} from "./helpers"

/**
 * AC29 and AC30 (spec §9.3, §22; FA-11): what a venue collects, and review
 * dates. A pub with no accommodation has no bedroom requirements and an
 * applicability change is recorded with a reason; an unchanged garden past its
 * review date asks for a check that the manager can answer without a new
 * photo.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

/** The id an insert … returning id gives (psql also prints the command tag). */
const inserted = (statement: string) => psql(statement).split("\n")[0]!

const bedroomSlots = (venueId: string) =>
  psql(`select count(*) from private.coverage_slot_rows(${sql(venueId)}::uuid)
    where required and (name ilike '%bedroom%' or group_name ilike '%bedroom%'
      or group_name ilike '%accommodation%')`)

test("AC29: a pub with no accommodation has no bedroom slots, and turning it on or off is recorded with a reason", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  expect(bedroomSlots(w.venueA.id)).toBe("0")

  const admin = await as(browser, w.admin, DESKTOP)
  await admin.goto(`/admin/venues/${w.venueA.id}`)
  // What this venue collects is a closed disclosure on Setup (second
  // handoff): open it after every load.
  const openCollect = () => admin.locator("#collect summary").click()
  await openCollect()
  const scope = admin.getByTestId("scope-accommodation")
  await expect(scope).toContainText(
    "No accommodation: no bedroom photos or facts are asked for."
  )

  for (const [turn, reason] of [
    ["on", `Rooms open upstairs ${w.tag}`],
    ["off", `Rooms closed for good ${w.tag}`],
  ] as const) {
    // The panel shows only the saved message after a change: reload for the
    // next one.
    await admin.reload()
    await openCollect()
    await expect(scope).toContainText(
      turn === "on"
        ? "No accommodation: no bedroom photos or facts are asked for."
        : "This venue has bedrooms: bedroom photos and facts are collected."
    )
    await scope.getByTestId("scope-preview").click()
    await expect(scope.getByTestId("scope-impact")).toBeVisible()
    await scope.getByLabel("Why is this changing?").fill(reason)
    await scope
      .getByRole("button", { name: `Turn accommodation ${turn}` })
      .click()
    await expect(
      scope.getByText("Saved. The change is in Activity.")
    ).toBeVisible()
  }
  await evidence(admin, "ac29-admin-scope")

  // Off again: still no mandatory bedroom slots.
  expect(bedroomSlots(w.venueA.id)).toBe("0")
  expect(
    psql(`select string_agg(applicable_after::text || ':' || reason, ',' order by created_at)
      from public.venue_scope_events where venue_id = ${sql(w.venueA.id)}::uuid`)
  ).toBe(
    `true:Rooms open upstairs ${w.tag},false:Rooms closed for good ${w.tag}`
  )

  // The manager can see the change and why in the venue's history.
  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto("/manager/venue/history")
  await expect(mgr.getByRole("main")).toContainText(
    "No longer applies at this venue"
  )
  await expect(mgr.getByRole("main")).toContainText(
    `Rooms closed for good ${w.tag}`
  )
  await evidence(mgr, "ac29-manager-history")
})

test("AC30: an unchanged garden past its review date shows a check, and the manager reconfirms it without a new photo", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const label = `Garden ${w.tag}`
  const garden =
    inserted(`insert into public.knowledge_subjects (venue_id, kind, label, created_by)
    values (${sql(w.venueA.id)}, 'area', ${sql(label)}, ${sql(w.admin.id)}) returning id`)
  const [asset] = await seedImages(w.staffA1, w.venueA, 1, {
    prefix: `DEV-FIXTURE-garden-${w.tag}`,
    colour: "#4b9a5a",
  })
  // DEV FIXTURE: a photo of the garden accepted 100 days ago (past its
  // 90-day review date).
  const labelId =
    inserted(`insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
    values (${sql(asset!)}, ${sql(w.venueA.id)}, ${sql(garden)}, 'area', ${sql(label)}, ${sql(w.staffA1.id)}) returning id`)
  psql(`insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by, decided_at)
    values (${sql(labelId)}, ${sql(w.venueA.id)}, ${sql(asset!)}, 'accepted', ${sql(w.admin.id)}, now() - interval '100 days')`)
  const freshness = () =>
    JSON.parse(psql(`select private.area_photo_freshness(${sql(labelId)})`))
      .state as string
  const slot = () =>
    psql(`select state from private.coverage_slot_rows(${sql(w.venueA.id)}::uuid)
      where slot_id = ${sql(garden)}::uuid`)
  const photos = () =>
    psql(
      `select count(*) from public.media_assets where venue_id = ${sql(w.venueA.id)}::uuid`
    )

  expect(freshness()).toBe("check_due")
  expect(slot()).toBe("check_due")
  const before = photos()

  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto("/manager/venue/facts")
  await expect(mgr.getByRole("main")).toContainText(label)
  await expect(mgr.getByRole("main")).toContainText("1 photo due a check")
  await evidence(mgr, "ac30-check-due")
  await mgr.getByRole("button", { name: `Still right: ${label}` }).click()
  // Nothing is left to confirm, and the confirmed row keeps its announced
  // status after the page refreshes (S3-R2, S3-E2E-2 finding F6).
  await expect(mgr.getByText("No space photos are due a check.")).toBeVisible()
  await expect(
    mgr.getByRole("status").filter({ hasText: "Confirmed as still right." })
  ).toBeVisible()

  // Current again, and covered, with no new photo.
  expect(freshness()).toBe("current")
  expect(slot()).toBe("covered")
  expect(photos()).toBe(before)
})

test("AC30 layout: the To confirm page fits a 320 px phone", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const mgr = await as(browser, w.mgrA, NARROW)
  await mgr.goto("/manager/venue/facts")
  await expect(mgr.getByRole("main")).toBeVisible()
  await expectNoSidewaysScroll(mgr, "venue facts at 320 px")
})
