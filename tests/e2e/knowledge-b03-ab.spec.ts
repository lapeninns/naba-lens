import { expect, test, type Page } from "@playwright/test"

import { amenityHrefs, staffCaptureHref } from "../../lib/amenities/contract"
import {
  ACCESS_COPY,
  type FeatureValue,
} from "../../components/nabalens/knowledge/accessibility-detail"
import { CHECKED_ON_COPY } from "../../components/nabalens/knowledge/checked-on"
import { SEND_PROGRESS_COPY } from "../../components/nabalens/knowledge/copy"
import {
  provisionAmenitiesWorld,
  question,
  seedVideo,
  sessionOf,
} from "./helpers/amenities-world"
import {
  addPlace,
  B03_DISPOSABLE_REGISTRY,
  contributionsAt,
  decisionsAt,
  enableOnWorkingList,
  evidenceBox,
  expectFocusWithin,
  holdNextSubmit,
  knowledgeRpc,
  londonDaysAgo,
  place,
  STEP_FREE_KEY,
  stepFreeAccessibilityVersion,
  storedCheck,
} from "./helpers/knowledge-b03-ab-world"
import { horizontalOverflow } from "./helpers/overflow"
import { escape, STAFF_LANDING } from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * B03 browser charters A and B on the isolated stack. Each case pins its own
 * synthetic registry key (helpers/knowledge-b03-ab-world), so no real key's
 * version changes for other specs on the lane, except B03-A: the step-free
 * form exists only on step_free_entrance, so it runs on a disposable B03
 * lane only (B03_DISPOSABLE_REGISTRY=1). Every asserted action runs in
 * the real UI or the person's own session; psql only seeds those keys and
 * reads rows back. Chromium contexts at the stated widths, not devices.
 */

const MANAGER = amenityHrefs("/manager")
const PHONE = (width: number, height = 740) => ({
  viewport: { width, height },
  isMobile: true,
  hasTouch: true,
})
const DESKTOP = { viewport: { width: 1280, height: 900 } }

/** The capture form on a page, and its one submit control (label changes). */
function capture(page: Page) {
  const form = page.locator('form[aria-label^="Capture:"]')
  const entrance = (label: string) =>
    form.getByRole("group", { name: label, exact: true })
  return {
    form,
    answer: (label: "Yes" | "No") =>
      form.getByRole("radio", { name: label, exact: true }).check(),
    scope: form.getByRole("group", {
      name: new RegExp(`^${escape(ACCESS_COPY.scope)}`),
    }),
    /** Step-free only: every listed entrance, each with its own result. */
    entrances: form.getByRole("group", {
      name: ACCESS_COPY.entrances,
      exact: true,
    }),
    entrance,
    result: (label: string, value: FeatureValue) =>
      entrance(label).getByRole("radio", {
        name: ACCESS_COPY.entranceValue[value],
        exact: true,
      }),
    checkedOn: form.getByLabel(CHECKED_ON_COPY.label, { exact: true }),
    reason: form.getByLabel("Reason", { exact: true }),
    submit: form.locator('button[type="submit"]'),
  }
}

test.describe("B03 venue knowledge: scoped answers and policy authority", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Chromium contexts"
  )
  test.setTimeout(300_000)

  test("B03-A: a scoped entrance and its Checked on date survive manager confirmation", async ({
    browser,
  }) => {
    // The step-free form is offered on the fixed key only, so this case
    // appends accessibility.v1 to the real key: a disposable B03 lane only.
    test.skip(
      !B03_DISPOSABLE_REGISTRY,
      "appends a registry version to step_free_entrance; set B03_DISPOSABLE_REGISTRY=1 on a disposable B03 lane"
    )
    const w = await provisionAmenitiesWorld()
    const v = stepFreeAccessibilityVersion()
    const ask = question(STEP_FREE_KEY)
    expect(v).toMatchObject({
      schema: "accessibility",
      schemaVersion: 1,
      lifecycle: "supported",
      inForce: true,
      question: ask,
      evidenceRule: "video",
      confirmation: "venue_manager",
    })
    // A separate accessibility question at the same venue, never answered here.
    const other = "accessible_toilet"
    const checksA = await enableOnWorkingList(w, w.venueA, [
      STEP_FREE_KEY,
      other,
    ])
    const checksB = await enableOnWorkingList(w, w.venueB, [STEP_FREE_KEY])
    const id = checksA[STEP_FREE_KEY]!
    const otherId = checksA[other]!
    const emptyId = checksB[STEP_FREE_KEY]!

    // Two named entrances at venue A, by its manager; none at venue B.
    const frontLabel = `DEV FIXTURE Front door ${w.tag}`
    const sideLabel = `DEV FIXTURE Side gate beside the long covered walkway to the car park ${w.tag}`
    const front = await addPlace(w.managerA, "entrance", frontLabel)
    const side = await addPlace(w.managerA, "entrance", sideLabel)
    const frontBefore = place(front)
    const sideBefore = place(side)
    const otherBefore = storedCheck(otherId)
    const otherContributionsBefore = contributionsAt(w.venueA, otherId)
    // The key's evidence rule is video.
    const video = await seedVideo(w.staffA, w.venueA, `b03a-${w.tag}`)
    const videoA2 = await seedVideo(w.staffA2, w.venueA, `b03a-a2-${w.tag}`)
    const checkedOn = londonDaysAgo(3)

    // ---- 320 px: wrapped labels, the action dock, errors and focus --------
    const narrow = await signedInPage(browser, w.staffA2, PHONE(320, 640))
    await narrow.goto(staffCaptureHref(id))
    const n = capture(narrow)
    await n.answer("Yes")
    // The fixed key's form: each listed entrance with its own result, and
    // no separate "What did you check?" (A34).
    await expect(n.entrances).toBeVisible()
    await expect(n.scope).toHaveCount(0)
    await expect(n.result(frontLabel, "not_checked")).toBeChecked()
    await expect(n.result(sideLabel, "not_checked")).toBeChecked()
    const sideLegend = n.entrance(sideLabel).locator("legend")
    const sideBox = (await sideLegend.boundingBox())!
    expect(
      sideBox.x + sideBox.width,
      "the long entrance label wraps"
    ).toBeLessThanOrEqual(320)
    const sideLines = await sideLegend.evaluate((el) => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
      return Math.round(el.getBoundingClientRect().height / lineHeight)
    })
    expect(sideLines, "on more than one line").toBeGreaterThan(1)
    await evidenceBox(narrow, videoA2).check()
    // The dock stays on screen and inside the width while the form scrolls.
    await n.checkedOn.scrollIntoViewIfNeeded()
    await expect(n.submit).toBeInViewport()
    const dock = (await n.submit.boundingBox())!
    expect(dock.x).toBeGreaterThanOrEqual(0)
    expect(dock.x + dock.width).toBeLessThanOrEqual(320)
    expect(dock.height).toBeGreaterThanOrEqual(44)
    const overflow = await horizontalOverflow(narrow)
    expect(overflow.overflowPx, overflow.culprit).toBe(0)
    // Yes with no entrance marked step-free: refused here, the message is on
    // the entrances and focus moves into them; nothing reaches the server.
    await n.submit.click()
    await expect(n.entrances.getByText(ACCESS_COPY.yesNeeds)).toBeVisible()
    await expectFocusWithin(n.entrances)
    // A Checked on date in the future is refused on its own field.
    await n.result(frontLabel, "yes").check()
    await n.checkedOn.fill(londonDaysAgo(-1))
    await n.submit.click()
    await expect(narrow.getByText(CHECKED_ON_COPY.future)).toBeVisible()
    await expect(n.checkedOn).toBeFocused()
    await expect(n.checkedOn).toHaveAttribute("aria-invalid", "true")
    expect(contributionsAt(w.venueA, id)).toEqual([])
    await narrow.context().close()

    // ---- Empty-place venue: No without an entrance is refused -------------
    const empty = await signedInPage(browser, w.staffB, PHONE(375, 812))
    await empty.goto(staffCaptureHref(emptyId))
    const e = capture(empty)
    await e.answer("No")
    await expect(e.entrances).toContainText(
      `${ACCESS_COPY.noEntrances(w.venueB.name)} ${ACCESS_COPY.addEntrancesStaff}`
    )
    await expect(e.entrance(frontLabel)).toHaveCount(0)
    await e.reason.fill("DEV FIXTURE no entrance is listed here")
    await e.submit.click()
    await expect(
      e.entrances.getByText(ACCESS_COPY.noNeedsList(w.venueB.name))
    ).toBeVisible()
    // With no entrance control to move to, this head leaves focus where it
    // was (capture-form accessTarget); the refusal itself is the proof here.
    test.info().annotations.push({
      type: "unsupported",
      description:
        "B03-A empty-place No: the entrances refusal renders, but no control receives focus (there is no entrance input to focus).",
    })
    await expect(empty).toHaveURL(
      new RegExp(`${escape(staffCaptureHref(emptyId))}$`)
    )
    expect(contributionsAt(w.venueB, emptyId), "no contribution").toEqual([])
    expect(storedCheck(emptyId).submission).toBeNull()
    await empty.context().close()

    // ---- 375 px: staff choose Checked on and one entrance, and submit ------
    const staff = await signedInPage(browser, w.staffA, PHONE(375, 812))
    await expect(staff).toHaveURL(STAFF_LANDING)
    const row = staff.getByRole("link", {
      name: new RegExp(`: ${escape(ask)}$`),
    })
    await expect(row).toBeVisible()
    await row.tap()
    await expect(staff).toHaveURL(
      new RegExp(`${escape(staffCaptureHref(id))}$`)
    )
    const s = capture(staff)
    await s.answer("Yes")
    await s.result(frontLabel, "yes").check()
    await expect(s.result(frontLabel, "yes")).toBeChecked()
    await expect(s.result(sideLabel, "not_checked")).toBeChecked()
    await expect(s.entrances).toContainText(ACCESS_COPY.yesSays([frontLabel]))
    await expect(s.checkedOn).toHaveValue(londonDaysAgo(0))
    await s.checkedOn.fill(checkedOn)
    await evidenceBox(staff, video).check()

    // The real submit is held: the controls say it's sending and can't send
    // twice; the real response is then released.
    await holdNextSubmit(staff, staffCaptureHref(id), '"observedOnSource"', {
      send: () => s.submit.click(),
      held: async (count) => {
        await expect(s.submit).toHaveAttribute("aria-busy", "true")
        await expect(s.submit).toHaveAttribute("aria-disabled", "true")
        await expect(s.submit).toHaveText(SEND_PROGRESS_COPY.sending)
        await expect(s.checkedOn).toBeDisabled()
        await expect(s.result(sideLabel, "yes")).toBeDisabled()
        await s.submit.click({ force: true })
        expect(count(), "one submit left the page").toBe(1)
      },
    })
    await expect(staff).toHaveURL(new RegExp(`finding_sent=${id}`))
    await expect(
      staff.getByRole("status").filter({ hasText: ask })
    ).toBeFocused()

    // What was recorded: one staff contribution with every listed entrance
    // (the chosen one step-free, the other not checked) and the chosen date,
    // on the version in force, not yet confirmed.
    const [sent, ...more] = contributionsAt(w.venueA, id)
    expect(more).toEqual([])
    expect(sent).toMatchObject({
      by: w.staffA.id,
      basis: "staff",
      kind: "finding",
      answer: "yes",
      detailRow: true,
      detailVenue: w.venueA.id,
      observedOn: checkedOn,
      observedOnSource: "chosen",
      questionVersion: v.version,
      schema: "accessibility",
      schemaVersion: 1,
    })
    const entrancesSent = [
      { subjectId: front, stepFree: "yes" },
      { subjectId: side, stepFree: "not_checked" },
    ]
    expect(sent!.detail).toEqual({
      entrances: expect.arrayContaining(entrancesSent),
    })
    expect(sent!.detail!.entrances).toHaveLength(entrancesSent.length)
    expect(decisionsAt(w.venueA, id)).toEqual([])

    // ---- 1280 px: the manager confirms the valid finding -------------------
    const manager = await signedInPage(browser, w.managerA, DESKTOP)
    await manager.goto(MANAGER.check(id))
    const card = manager.getByRole("article", {
      name: new RegExp(`from ${escape(w.staffA.name)}`),
    })
    await card.getByRole("button", { name: "Confirm", exact: true }).click()
    await expect(
      manager.getByText(
        `Confirmed. This is now the answer for ${w.venueA.name}.`
      )
    ).toBeVisible()
    const confirmed = decisionsAt(w.venueA, id).filter(
      (d) => d.decision === "confirmed"
    )
    expect(confirmed).toEqual([
      {
        contribution: sent!.id,
        decision: "confirmed",
        by: w.managerA.id,
        basis: "venue_manager",
        self: false,
      },
    ])
    expect(storedCheck(id)).toMatchObject({
      progress: "complete",
      answer: "yes",
    })
    // Confirmation copies nothing: the detail row is still the one sent.
    expect(contributionsAt(w.venueA, id)).toEqual([sent])

    // ---- Staff Home and the check page after confirmation ------------------
    await staff.goto("/staff/tasks")
    const home = staff.getByRole("listitem").filter({ hasText: ask })
    await expect(home).toContainText("Current answer: Yes.")
    await staff.goto(staffCaptureHref(id))
    await expect(staff.getByText(/Current answer: Yes\./).first()).toBeVisible()
    // Neither page renders the answer in use's entrances or Checked on date
    // at this head (answerInUseLines gives the value and Recorded date only;
    // checkedOnLine has no caller). Recorded as unsupported, not inferred:
    // the read below is the server's, not browser proof.
    test.info().annotations.push({
      type: "unsupported",
      description:
        "B03-A after confirmation: Staff Home and the check page show 'Current answer: Yes.' but render neither the chosen entrance nor the Checked on date; those are proven by the staff-session knowledge_check read and the detail row only.",
    })
    const view = await knowledgeRpc<{
      answerInUse: { value: string; detail: unknown; observedOn: string }
    }>(await sessionOf(w.staffA), "knowledge_check", { p_check_id: id })
    expect(view.answerInUse).toMatchObject({
      value: "yes",
      detail: sent!.detail,
      observedOn: checkedOn,
    })

    // The entrances, the other accessibility question and the empty venue's
    // step-free check are untouched.
    expect(place(front)).toEqual(frontBefore)
    expect(place(side)).toEqual(sideBefore)
    expect(storedCheck(otherId)).toEqual(otherBefore)
    expect(contributionsAt(w.venueA, otherId)).toEqual(otherContributionsBefore)
    expect(contributionsAt(w.venueB, emptyId)).toEqual([])
  })
})
