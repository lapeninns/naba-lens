import { expect, test, type Page } from "@playwright/test"

import {
  amenityHrefs,
  ANSWER_LABEL,
  CORE_CHECK_KEYS,
  PROGRESS_LABEL,
  REOPEN_PRESET_LABEL,
  staffCaptureHref,
  UI_TEXT,
  evidenceHref,
} from "../../lib/amenities/contract"
import {
  amenityOk,
  assigneeOption,
  captureForm,
  checkId,
  checkItem,
  checkKeys,
  checkState,
  CORE_QUESTIONS,
  coverageFootprint,
  currentSubmission,
  eventKinds,
  expectRefused,
  expectSubmitRefused,
  legacyManagerGrant,
  londonToday,
  provisionAmenitiesWorld,
  question,
  readyCheck,
  seedPhoto,
  seedVideo,
  sessionOf,
  submitAndComplete,
  submitArgs,
  type AmenitiesWorld,
} from "./helpers/amenities-world"
import { escape, STAFF_LANDING, chooseOption } from "./helpers/ui"
import { signedInPage, type Person } from "./helpers/world"

/**
 * Amenity checks in the built app (plan release criteria 3 and 4): admin
 * enable, manager add/assign/reopen/archive/restore and Capture myself, staff
 * capture against each evidence rule. Managers are venue manager accounts
 * working in the /manager workspace (the same screens as /staff/manage); one
 * journey covers a staff account with a pre-existing (transitional) grant,
 * which keeps /staff/manage. People act through the pages. Setup that a test
 * does not assert runs in the actor's own database session; the service role
 * only seeds people, grants made before manager accounts and media, and reads
 * state to confirm what the pages did.
 */

const MANAGER = amenityHrefs("/manager")
const LEGACY_MANAGE = amenityHrefs("/staff/manage")
const adminHrefs = (w: AmenitiesWorld) =>
  amenityHrefs(`/admin/coverage/${w.venueA.id}`)

async function openStaffCheck(page: Page, key: string, id: string) {
  await expect(page).toHaveURL(STAFF_LANDING)
  const section = page.getByRole("region", { name: UI_TEXT.staffSection })
  await section.getByRole("link", { name: question(key) }).click()
  await expect(page).toHaveURL(new RegExp(`${escape(staffCaptureHref(id))}$`))
}

/**
 * The check page states progress, answer, and who answered and when, as
 * "Recorded by <name> on 7 Nov 2026" under the answer (answeredText in
 * components/nabalens/amenities/manage/check-row.tsx).
 */
async function expectAnswered(
  page: Page,
  answer: keyof typeof ANSWER_LABEL,
  by: Person
) {
  const main = page.getByRole("main")
  await expect(
    main.getByText(PROGRESS_LABEL.complete, { exact: true }).first()
  ).toBeVisible()
  await expect(
    main.getByText(ANSWER_LABEL[answer], { exact: true }).first()
  ).toBeVisible()
  await expect(
    main
      .getByText(
        new RegExp(
          `^Recorded by ${escape(by.name)} on \\d{1,2} [A-Za-z]+ \\d{4}$`
        )
      )
      .first()
  ).toBeVisible()
}

test.describe("amenity checks", () => {
  test.setTimeout(240_000)

  test("an admin enables Amenities for a venue and gets the four core checks", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const admin = await signedInPage(browser, w.admin)
    await admin.goto(`/admin/coverage/${w.venueA.id}`)
    await admin.getByRole("link", { name: UI_TEXT.navTab }).click()
    await expect(admin).toHaveURL(new RegExp(`${escape(adminHrefs(w).list)}$`))

    await admin.getByRole("button", { name: UI_TEXT.enable }).click()
    for (const key of CORE_CHECK_KEYS) {
      const item = checkItem(admin, key)
      await expect(item).toBeVisible()
      await expect(item).toContainText(PROGRESS_LABEL.needs_capture)
    }
    await expect(
      admin.getByRole("button", { name: UI_TEXT.enable })
    ).toHaveCount(0)
    expect(checkKeys(w.venueA)).toEqual([...CORE_CHECK_KEYS].sort())
    for (const key of CORE_CHECK_KEYS) {
      expect(checkState(checkId(w.venueA, key))).toMatchObject({
        status: "active",
        progress: "needs_capture",
        answer: "to_check",
        assignee: null,
        submissions: 0,
      })
    }
    expect(checkKeys(w.venueB), "venue B untouched").toEqual([])

    // The manager sees the same four and cannot enable a venue.
    const manager = await signedInPage(browser, w.managerA)
    await manager.goto(MANAGER.list)
    for (const q of CORE_QUESTIONS) {
      await expect(manager.getByRole("link", { name: q })).toBeVisible()
    }
    await expect(
      manager.getByRole("button", { name: UI_TEXT.enable })
    ).toHaveCount(0)
  })

  test("darts (photo): the manager adds it from the catalogue and assigns it; staff capture it and it is Complete with who and when", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    await amenityOk(await sessionOf(w.admin), "amenity_enable_venue", {
      p_venue_id: w.venueA.id,
    })

    const manager = await signedInPage(browser, w.managerA)
    await manager.goto(MANAGER.list)
    await manager
      .getByRole("button", { name: UI_TEXT.addFromCatalogue })
      .click()
    const add = manager.getByRole("dialog", { name: UI_TEXT.addFromCatalogue })
    await add
      .getByRole("checkbox", { name: question("darts"), exact: true })
      .check()
    await add.getByRole("button", { name: UI_TEXT.addSelected }).click()
    await expect(add).toBeHidden()
    await expect(checkItem(manager, "darts")).toContainText(
      PROGRESS_LABEL.needs_capture
    )
    const id = checkId(w.venueA, "darts")

    await manager.getByRole("link", { name: question("darts") }).click()
    await expect(manager).toHaveURL(new RegExp(`${escape(MANAGER.check(id))}$`))
    // Assignees are active staff at the venue; a manager account is not one.
    await manager.getByRole("combobox", { name: "Assignee" }).click()
    await expect(
      manager.getByRole("option", {
        name: assigneeOption(w.staffA),
        exact: true,
      })
    ).toBeVisible()
    await expect(
      manager.getByRole("option", {
        name: assigneeOption(w.managerA),
        exact: true,
      })
    ).toHaveCount(0)
    await manager.keyboard.press("Escape")
    await chooseOption(manager, manager, "Assignee", assigneeOption(w.staffA))
    await manager.getByRole("button", { name: UI_TEXT.assign }).click()
    await expect.poll(() => checkState(id).assignee).toBe(w.staffA.id)

    const photo = await seedPhoto(w.staffA, w.venueA, `darts-${w.tag}`)
    const staff = await signedInPage(browser, w.staffA)
    await openStaffCheck(staff, "darts", id)
    const form = captureForm(staff)
    await form.answer("yes")
    await form.attach(photo)
    await form.finding.fill(`Board by the back door, darts at the bar ${w.tag}`)
    await submitAndComplete(staff, id)
    expect(checkState(id)).toMatchObject({
      answer: "yes",
      answeredBy: w.staffA.id,
      submissions: 1,
    })
    expect(currentSubmission(id).assets).toEqual([photo])

    // Complete checks leave staff Home.
    await staff.goto("/staff/tasks")
    await expect(
      staff.getByRole("link", { name: question("darts") })
    ).toHaveCount(0)

    await manager.reload()
    await expectAnswered(manager, "yes", w.staffA)

    // The venue manager may preview the evidence; a colleague who did not
    // submit it gets the same 404 as an unknown asset.
    const thumb = evidenceHref(photo, "thumb")
    const asManager = await manager.request.get(thumb, { maxRedirects: 0 })
    expect(asManager.status()).toBe(302)
    const colleague = await signedInPage(browser, w.staffA2)
    const asColleague = await colleague.request.get(thumb, { maxRedirects: 0 })
    expect(asColleague.status()).toBe(404)
  })

  test("step-free entrance (video): a photo-only Yes is refused, then a video completes it", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const id = await readyCheck(w, w.venueA, "step_free_entrance", w.staffA)
    const photo = await seedPhoto(w.staffA, w.venueA, `step-${w.tag}`)
    const video = await seedVideo(w.staffA, w.venueA, `step-${w.tag}`)

    const staff = await signedInPage(browser, w.staffA)
    await openStaffCheck(staff, "step_free_entrance", id)
    const form = captureForm(staff)
    await form.answer("yes")
    await form.attach(photo)
    await expectSubmitRefused(staff, id)
    // The rule holds without the page too.
    await expectRefused(
      await sessionOf(w.staffA),
      "amenity_submit_finding",
      submitArgs(id, "yes", [photo]),
      "evidence_rule_unmet"
    )
    expect(checkState(id).progress).toBe("needs_capture")

    await form.detach(photo)
    await form.attach(video)
    await submitAndComplete(staff, id)
    expect(currentSubmission(id).assets).toEqual([video])

    const manager = await signedInPage(browser, w.managerA)
    await manager.goto(MANAGER.check(id))
    await expectAnswered(manager, "yes", w.staffA)
    const stream = await manager.request.get(evidenceHref(video, "stream"), {
      maxRedirects: 0,
    })
    expect([200, 206, 302]).toContain(stream.status())
  })

  test("Wi-Fi needs a photo, a video and the redaction tick, and records the test notes internally", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const id = await readyCheck(w, w.venueA, "guest_wifi", w.staffA)
    const photo = await seedPhoto(w.staffA, w.venueA, `wifi-${w.tag}`)
    const video = await seedVideo(w.staffA, w.venueA, `wifi-${w.tag}`)
    const wifi = {
      testSpot: `Snug by the fire ${w.tag}`,
      testedOn: londonToday(),
      downloadMbps: 54,
      uploadMbps: 12,
    }

    const staff = await signedInPage(browser, w.staffA)
    await openStaffCheck(staff, "guest_wifi", id)
    const form = captureForm(staff)
    await form.answer("yes")
    await form.wifi.testSpot.fill(wifi.testSpot)
    await form.wifi.testedOn.fill(wifi.testedOn)
    await form.wifi.download.fill(String(wifi.downloadMbps))
    await form.wifi.upload.fill(String(wifi.uploadMbps))

    // Photo only, even with the tick.
    await form.attach(photo)
    await form.redaction.check()
    await expectSubmitRefused(staff, id)
    // Video only.
    await form.detach(photo)
    await form.attach(video)
    await expectSubmitRefused(staff, id)
    // Photo and video without the tick.
    await form.attach(photo)
    if (await form.redaction.isChecked()) await form.redaction.uncheck()
    await expectSubmitRefused(staff, id)

    const db = await sessionOf(w.staffA)
    const metadata = { ...wifi }
    await expectRefused(
      db,
      "amenity_submit_finding",
      submitArgs(id, "yes", [photo], {
        p_internal_metadata: metadata,
        p_redaction_confirmed: true,
      }),
      "evidence_rule_unmet"
    )
    await expectRefused(
      db,
      "amenity_submit_finding",
      submitArgs(id, "yes", [photo, video], { p_internal_metadata: metadata }),
      "redaction_not_confirmed"
    )
    await expectRefused(
      db,
      "amenity_submit_finding",
      submitArgs(id, "yes", [photo, video], { p_redaction_confirmed: true }),
      "invalid_wifi_metadata"
    )
    expect(checkState(id)).toMatchObject({
      progress: "needs_capture",
      submissions: 0,
    })

    await form.redaction.check()
    await submitAndComplete(staff, id)
    const current = currentSubmission(id)
    expect([...current.assets].sort()).toEqual([photo, video].sort())
    expect(current.metadata).toMatchObject(wifi)

    // Internal notes: the venue manager sees them on the check page.
    const manager = await signedInPage(browser, w.managerA)
    await manager.goto(MANAGER.check(id))
    await expectAnswered(manager, "yes", w.staffA)
    // Scoped by role: a hidden streamed copy of the page can briefly match text.
    await expect(
      manager.getByRole("article").getByText(wifi.testSpot)
    ).toBeVisible()
  })

  test("No needs a reason: refused without one, Complete with one", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const id = await readyCheck(w, w.venueA, "onsite_parking", w.staffA)
    const reason = `No car park, only the street ${w.tag}`

    const staff = await signedInPage(browser, w.staffA)
    await openStaffCheck(staff, "onsite_parking", id)
    const form = captureForm(staff)
    await form.answer("no")
    await expectSubmitRefused(staff, id)
    await expectRefused(
      await sessionOf(w.staffA),
      "amenity_submit_finding",
      submitArgs(id, "no", []),
      "reason_required"
    )

    await form.reason.fill(reason)
    await submitAndComplete(staff, id)
    expect(checkState(id).answer).toBe("no")
    expect(currentSubmission(id)).toMatchObject({ answer: "no", reason })

    const manager = await signedInPage(browser, w.managerA)
    await manager.goto(MANAGER.check(id))
    await expectAnswered(manager, "no", w.staffA)
    await expect(manager.getByRole("article").getByText(reason)).toBeVisible()
  })

  test("a manager uses Capture myself on an unassigned check", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const id = await readyCheck(w, w.venueA, "guest_toilets", null)
    // The manager's own photo, as if uploaded while still a staff account
    // (manager accounts do not upload); the fixture seeds it as theirs.
    const photo = await seedPhoto(w.managerA, w.venueA, `toilets-${w.tag}`)

    const manager = await signedInPage(browser, w.managerA)
    await manager.goto(MANAGER.check(id))
    await manager
      .getByRole("link", { name: UI_TEXT.captureMyself })
      .or(manager.getByRole("button", { name: UI_TEXT.captureMyself }))
      .click()
    await expect(manager).toHaveURL(
      new RegExp(`${escape(MANAGER.capture(id))}$`)
    )
    const form = captureForm(manager)
    await form.answer("yes")
    await form.attach(photo)
    await submitAndComplete(manager, id)
    expect(checkState(id)).toMatchObject({
      answer: "yes",
      answeredBy: w.managerA.id,
      assignee: null,
    })
    await manager.goto(MANAGER.check(id))
    await expectAnswered(manager, "yes", w.managerA)
  })

  test("a manager reopens with a preset reason; staff see it and recapture to Complete", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const id = await readyCheck(w, w.venueA, "darts", w.staffA)
    const first = await seedPhoto(w.staffA, w.venueA, `darts-1-${w.tag}`)
    const second = await seedPhoto(w.staffA, w.venueA, `darts-2-${w.tag}`)
    await amenityOk(
      await sessionOf(w.staffA),
      "amenity_submit_finding",
      submitArgs(id, "yes", [first])
    )
    // "Other" needs words of its own.
    await expectRefused(
      await sessionOf(w.managerA),
      "amenity_reopen_check",
      {
        p_check_id: id,
        p_revision: checkState(id).revision,
        p_preset: "other",
        p_reason: null,
      },
      "reason_required"
    )

    const extra = `The oche is out of shot ${w.tag}`
    const manager = await signedInPage(browser, w.managerA)
    await manager.goto(MANAGER.check(id))
    await manager.getByRole("button", { name: UI_TEXT.reopen }).click()
    const dialog = manager.getByRole("dialog", { name: "Reopen this check" })
    await dialog
      .getByRole("radio", { name: REOPEN_PRESET_LABEL.wrong_area, exact: true })
      .check()
    // Optional text for a preset other than Other: "Details (optional)".
    await dialog.getByLabel(/^Details/).fill(extra)
    await dialog
      .getByRole("button", { name: UI_TEXT.reopen, exact: true })
      .click()
    await expect(dialog).toBeHidden()
    await expect(
      manager.getByText(PROGRESS_LABEL.needs_recheck).first()
    ).toBeVisible()
    // The earlier answer stays visible while it is rechecked.
    expect(checkState(id)).toMatchObject({
      progress: "needs_recheck",
      answer: "yes",
    })
    expect(checkState(id).recheckReason).toContain(extra)

    const staff = await signedInPage(browser, w.staffA)
    const section = staff.getByRole("region", { name: UI_TEXT.staffSection })
    await expect(checkItem(section, "darts")).toContainText(
      PROGRESS_LABEL.needs_recheck
    )
    await openStaffCheck(staff, "darts", id)
    await expect(
      staff.getByText(REOPEN_PRESET_LABEL.wrong_area).first()
    ).toBeVisible()
    await expect(staff.getByText(extra).first()).toBeVisible()
    const form = captureForm(staff)
    await form.answer("yes")
    await form.attach(second)
    await submitAndComplete(staff, id)
    expect(checkState(id)).toMatchObject({
      answer: "yes",
      recheckReason: null,
      submissions: 2,
    })
    expect(currentSubmission(id).assets).toEqual([second])
    expect(eventKinds(id)).toEqual(
      expect.arrayContaining(["submitted", "reopened"])
    )
    await manager.reload()
    await expectAnswered(manager, "yes", w.staffA)
  })

  test("archive then restore keeps the answer and its history", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const id = await readyCheck(w, w.venueA, "darts", w.staffA)
    const photo = await seedPhoto(w.staffA, w.venueA, `darts-${w.tag}`)
    const finding = `Two boards in the games room ${w.tag}`
    await amenityOk(
      await sessionOf(w.staffA),
      "amenity_submit_finding",
      submitArgs(id, "yes", [photo], { p_finding: finding })
    )

    const manager = await signedInPage(browser, w.managerA)
    await manager.goto(MANAGER.check(id))
    // Archive and Restore act at once; there is no confirmation dialog.
    await manager
      .getByRole("button", { name: UI_TEXT.archive, exact: true })
      .click()
    await expect.poll(() => checkState(id).status).toBe("archived")

    await manager.goto(MANAGER.list)
    const archived = manager.getByRole("region", { name: UI_TEXT.archived })
    await expect(checkItem(archived, "darts")).toBeVisible()
    // Listed once: under Archived, not among the active checks.
    await expect(checkItem(manager, "darts")).toHaveCount(1)

    await archived.getByRole("link", { name: question("darts") }).click()
    await expect(manager).toHaveURL(new RegExp(`${escape(MANAGER.check(id))}$`))
    await manager
      .getByRole("button", { name: UI_TEXT.restore, exact: true })
      .click()
    await expect.poll(() => checkState(id).status).toBe("active")
    expect(checkState(id)).toMatchObject({
      progress: "complete",
      answer: "yes",
      answeredBy: w.staffA.id,
      submissions: 1,
    })
    expect(eventKinds(id)).toEqual(
      expect.arrayContaining(["submitted", "archived", "restored"])
    )
    await manager.reload()
    await expectAnswered(manager, "yes", w.staffA)
    await expect(manager.getByRole("article").getByText(finding)).toBeVisible()
  })

  test("amenity checks never appear in monthly Coverage targets or tasks", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    // Manager accounts do not write the Coverage tables; the admin prepares
    // the month.
    const { error } = await (
      await sessionOf(w.admin)
    ).rpc("prepare_coverage_month", {
      p_venue_id: w.venueA.id,
    })
    if (error) throw new Error(`prepare_coverage_month: ${error.message}`)
    const before = coverageFootprint(w.venueA)

    const darts = await readyCheck(w, w.venueA, "darts", w.staffA)
    await readyCheck(w, w.venueA, "guest_toilets", w.staffA)
    const photo = await seedPhoto(w.staffA, w.venueA, `darts-${w.tag}`)
    const staffDb = await sessionOf(w.staffA)
    const managerDb = await sessionOf(w.managerA)
    await amenityOk(
      staffDb,
      "amenity_submit_finding",
      submitArgs(darts, "yes", [photo])
    )
    await amenityOk(managerDb, "amenity_reopen_check", {
      p_check_id: darts,
      p_revision: checkState(darts).revision,
      p_preset: "evidence_unclear",
      p_reason: null,
    })
    await amenityOk(
      staffDb,
      "amenity_submit_finding",
      submitArgs(darts, "yes", [photo])
    )
    expect(coverageFootprint(w.venueA)).toEqual(before)

    // Staff Home lists the amenity check in its own section, never as a
    // Coverage task or in the month's photo count.
    const staff = await signedInPage(browser, w.staffA)
    await expect(staff).toHaveURL(STAFF_LANDING)
    await expect(
      staff
        .getByRole("region", { name: UI_TEXT.staffSection })
        .getByRole("link", { name: question("guest_toilets") })
    ).toBeVisible()
    const coverageTasks = staff.getByRole("list", { name: "Assigned tasks" })
    for (const key of ["darts", ...CORE_CHECK_KEYS]) {
      await expect(coverageTasks.getByText(question(key))).toHaveCount(0)
    }
    await staff.goto("/staff/tasks/month")
    for (const key of ["darts", ...CORE_CHECK_KEYS]) {
      await expect(staff.getByText(question(key))).toHaveCount(0)
    }

    const admin = await signedInPage(browser, w.admin)
    await admin.goto(`/admin/coverage/${w.venueA.id}/checklist`)
    await expect(admin.getByRole("main")).toBeVisible()
    for (const key of ["darts", ...CORE_CHECK_KEYS]) {
      await expect(admin.getByText(question(key))).toHaveCount(0)
    }
  })

  test("transitional: a staff account with a pre-existing grant still manages Amenities at /staff/manage", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    await amenityOk(await sessionOf(w.admin), "amenity_enable_venue", {
      p_venue_id: w.venueA.id,
    })
    // A grant made before manager accounts existed, held by a staff account.
    await legacyManagerGrant(w, w.staffA2, w.venueA)

    const legacy = await signedInPage(browser, w.staffA2)
    await legacy.goto(LEGACY_MANAGE.list)
    await expect(legacy).toHaveURL(new RegExp(`${escape(LEGACY_MANAGE.list)}$`))
    for (const q of CORE_QUESTIONS) {
      await expect(legacy.getByRole("link", { name: q })).toBeVisible()
    }
    await expect(
      legacy.getByRole("button", { name: UI_TEXT.enable })
    ).toHaveCount(0)

    const id = checkId(w.venueA, "guest_toilets")
    await legacy.getByRole("link", { name: question("guest_toilets") }).click()
    await expect(legacy).toHaveURL(
      new RegExp(`${escape(LEGACY_MANAGE.check(id))}$`)
    )
    await chooseOption(legacy, legacy, "Assignee", assigneeOption(w.staffA))
    await legacy.getByRole("button", { name: UI_TEXT.assign }).click()
    await expect.poll(() => checkState(id).assignee).toBe(w.staffA.id)
    expect(eventKinds(id)).toEqual(expect.arrayContaining(["assigned"]))
  })
})
