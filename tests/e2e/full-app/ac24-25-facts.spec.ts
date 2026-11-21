import { expect, test, type Browser } from "@playwright/test"

import {
  amenityHrefs,
  staffCaptureHref,
  UI_TEXT,
} from "../../../lib/amenities/contract"
import {
  amenityOk,
  captureForm,
  checkId,
  checkState,
  londonToday,
  provisionAmenitiesWorld,
  question,
  readyCheck,
  seedPhoto,
  sessionOf,
  submitAndComplete,
} from "../helpers/amenities-world"
import { psql, requireIsolatedStack } from "../helpers/stack"
import { OTHER_JOBS_PATH, otherJobsCheck } from "../helpers/ui"
import { as, closeAll, DESKTOP, evidence, PHONE, sql } from "./helpers"

/**
 * AC24 and AC25 (spec §2, §4.2, §22; FA-32): an amenity fact is separate
 * from its photo requirement. A confirmed No needs no photo and leaves no
 * photo task; a policy question (guest Wi-Fi) needs the fact confirmed, and
 * a router photo does not confirm it. Staff open the capture page from its
 * link (the Other jobs card's href); managers decide on /manager/amenities.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

/**
 * The admin brings venue A onto the knowledge layer on its venue page: "What
 * this venue collects", the group catalogue template (AC23). That puts the
 * venue's core questions on its working list, including a core check that is
 * already active (S3-R9), and from then on a check a manager adds at the
 * venue joins the list too. Only checks on the working list count in
 * coverage (private.knowledge_in_scope).
 */
async function applyVenueTemplate(
  browser: Browser,
  w: Awaited<ReturnType<typeof provisionAmenitiesWorld>>
) {
  const admin = await as(browser, w.admin, DESKTOP)
  await admin.goto(`/admin/venues/${w.venueA.id}`)
  // What this venue collects is a closed disclosure on Setup (second handoff).
  await admin.locator("#collect summary").click()
  const template = admin.getByTestId("venue-template")
  await template.getByTestId("template-preview-button").click()
  await expect(template.getByTestId("template-preview")).toBeVisible()
  await template
    .getByLabel("Why are you adding these?")
    .fill(`New venue setup ${w.tag}`)
  await template.getByTestId("template-apply").click()
  await expect
    .poll(() =>
      psql(`select count(*) > 0 from public.knowledge_working_list
        where venue_id = ${sql(w.venueA.id)}::uuid and disabled_at is null`)
    )
    .toBe("t")
  await admin.context().close()
}

const MANAGER = amenityHrefs("/manager")

/** Assigns the check in the admin's session (setup; not under test here). */
async function assignTo(
  w: Awaited<ReturnType<typeof provisionAmenitiesWorld>>,
  id: string,
  who: { id: string }
) {
  await amenityOk(await sessionOf(w.admin), "amenity_assign_check", {
    p_check_id: id,
    p_assignee_id: who.id,
    p_revision: checkState(id).revision,
  })
}

const onList = (venueId: string, key: string) =>
  psql(`select count(*) from public.knowledge_working_list
    where venue_id = ${sql(venueId)}::uuid and question_key = ${sql(key)}
      and disabled_at is null`)

const fact = (venueId: string, key: string) =>
  psql(`select coalesce(current_answer, '') || '|' || coalesce(verification, '')
    from private.knowledge_fact_rows(${sql(venueId)}::uuid)
    where question_key = ${sql(key)}`)

const slot = (venueId: string, checkId: string) =>
  psql(`select state || ':' || required from private.coverage_slot_rows(${sql(venueId)}::uuid)
    where slot_id = ${sql(checkId)}::uuid`)

test("AC24: a confirmed No for the pool table resolves the fact and leaves no table-photo task", async ({
  browser,
}) => {
  const w = await provisionAmenitiesWorld()
  const id = await readyCheck(w, w.venueA, "pool_table", w.staffA)

  const staff = await as(browser, w.staffA, PHONE)
  await staff.goto(OTHER_JOBS_PATH)
  await expect(otherJobsCheck(staff, question("pool_table")).card).toHaveCount(
    1
  )
  await staff.goto(staffCaptureHref(id))
  const form = captureForm(staff)
  await form.answer("no")
  await form.reason.fill(`No pool table, the room is a dining room ${w.tag}`)
  await submitAndComplete(staff, id)

  // The fact is resolved; nothing asks for a photo of a table.
  expect(fact(w.venueA.id, "pool_table")).toMatch(/^no\|/)
  // No required photo slot for it. This venue has no working list, so the
  // check has no coverage slot at all (the FA-32 test has one).
  expect(slot(w.venueA.id, id)).not.toMatch(/:true$/)
  await staff.goto(OTHER_JOBS_PATH)
  await expect(otherJobsCheck(staff, question("pool_table")).card).toHaveCount(
    0
  )
  await evidence(staff, "ac24-other-jobs-after-no")

  const mgr = await as(browser, w.managerA, DESKTOP)
  await mgr.goto(`/manager/amenities/${id}`)
  await expect(mgr.getByRole("main")).toContainText("Complete")
  await expect(mgr.getByRole("main")).toContainText(
    `Recorded by ${w.staffA.name}`
  )
  await evidence(mgr, "ac24-manager-check")
})

test("AC25: a router photo leaves guest Wi-Fi unconfirmed until the manager verifies it", async ({
  browser,
}) => {
  const w = await provisionAmenitiesWorld()
  const id = await readyCheck(w, w.venueA, "guest_wifi", w.staffA)
  // The check is already active; the template brings it into coverage.
  await applyVenueTemplate(browser, w)
  expect(onList(w.venueA.id, "guest_wifi")).toBe("1")
  const router = await seedPhoto(w.staffA, w.venueA, `router-${w.tag}`)

  const staff = await as(browser, w.staffA, PHONE)
  await staff.goto(staffCaptureHref(id))
  const form = captureForm(staff)
  await form.answer("yes")
  await form.wifi.testSpot.fill(`By the bar ${w.tag}`)
  await form.wifi.testedOn.fill(londonToday())
  await form.wifi.download.fill("40")
  await form.wifi.upload.fill("10")
  await form.attach(router)
  if (await form.redaction.isVisible()) await form.redaction.check()
  await form.submit.click()
  await expect
    .poll(() =>
      psql(`select count(*) from public.knowledge_contributions
        where check_id = ${sql(id)}::uuid`)
    )
    .toBe("1")

  // Submitted with a photo of the router, but not a confirmed fact.
  expect(fact(w.venueA.id, "guest_wifi")).not.toMatch(/\|confirmed$/)
  await evidence(staff, "ac25-sent")

  const mgr = await as(browser, w.managerA, DESKTOP)
  await mgr.goto(`/manager/amenities/${id}`)
  const toConfirm = mgr.getByRole("region", { name: /^To confirm/ })
  await expect(toConfirm).toBeVisible()
  await evidence(mgr, "ac25-to-confirm")
  expect(fact(w.venueA.id, "guest_wifi")).not.toMatch(/\|confirmed$/)

  // Verified separately by the manager: now confirmed.
  await toConfirm.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect
    .poll(() => fact(w.venueA.id, "guest_wifi"))
    .toMatch(/\|confirmed$/)
})

test("FA-32 (AC24 context): a pool table Yes asks for a reviewed photo in coverage", async ({
  browser,
}) => {
  // FA-32: "a confirmed Yes still needs a reviewed photo where the catalogue
  // asks for one". pool_table's catalogue evidence rule is `photo`.
  const w = await provisionAmenitiesWorld()
  await applyVenueTemplate(browser, w)

  // The manager adds Pool table from the catalogue (amenity_add_checks). At
  // a venue with a working list it joins the list (S3-R9, W5): no other step.
  const mgr = await as(browser, w.managerA, DESKTOP)
  await mgr.goto(MANAGER.list)
  await mgr.getByRole("button", { name: UI_TEXT.addFromCatalogue }).click()
  const add = mgr.getByRole("dialog", { name: UI_TEXT.addFromCatalogue })
  await add
    .getByRole("checkbox", { name: question("pool_table"), exact: true })
    .check()
  await add.getByRole("button", { name: UI_TEXT.addSelected }).click()
  await expect(add).toBeHidden()
  const id = checkId(w.venueA, "pool_table")
  expect(onList(w.venueA.id, "pool_table")).toBe("1")
  expect(slot(w.venueA.id, id)).toBe("missing:true")
  await assignTo(w, id, w.staffA)

  const photo = await seedPhoto(w.staffA, w.venueA, `pool-${w.tag}`)
  const staff = await as(browser, w.staffA, PHONE)
  await staff.goto(staffCaptureHref(id))
  const form = captureForm(staff)
  await form.answer("yes")
  await form.attach(photo)
  await form.submit.click()
  await expect
    .poll(() =>
      psql(`select count(*) from public.amenity_submissions
        where check_id = ${sql(id)}::uuid`)
    )
    .toBe("1")
  expect(fact(w.venueA.id, "pool_table")).toMatch(/^yes\|/)
  // The photo requirement is a counted Facilities slot.
  expect(
    slot(w.venueA.id, id),
    "pool_table is missing from private.coverage_slot_rows"
  ).toMatch(/^(pending|covered|missing):true$/)
})
