import { expect, test, type Page } from "@playwright/test"

import { amenityHrefs, staffCaptureHref } from "../../lib/amenities/contract"
import { ACCESS_COPY } from "../../components/nabalens/knowledge/accessibility-detail"
import { CHECKED_ON_COPY } from "../../components/nabalens/knowledge/checked-on"
import { SEND_PROGRESS_COPY } from "../../components/nabalens/knowledge/copy"
import {
  provisionAmenitiesWorld,
  seedPhoto,
  sessionOf,
} from "./helpers/amenities-world"
import {
  addPlace,
  contributionsAt,
  decisionsAt,
  enableOnWorkingList,
  evidenceBox,
  expectFocusWithin,
  holdNextSubmit,
  knowledgeRpc,
  londonDaysAgo,
  place,
  registryVersion,
  seedSyntheticQuestion,
  storedCheck,
} from "./helpers/knowledge-b03-ab-world"
import { horizontalOverflow } from "./helpers/overflow"
import { escape, STAFF_LANDING } from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * B03 browser charters A and B on the isolated stack. Each case pins its own
 * synthetic registry key (helpers/knowledge-b03-ab-world), so no real key's
 * version changes for other specs on the lane. Every asserted action runs in
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
  return {
    form,
    answer: (label: "Yes" | "No") =>
      form.getByRole("radio", { name: label, exact: true }).check(),
    scope: form.getByRole("group", {
      name: new RegExp(`^${escape(ACCESS_COPY.scope)}`),
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
    const w = await provisionAmenitiesWorld()
    // The pinned registry version: accessibility.v1 on a synthetic key.
    const q = seedSyntheticQuestion({
      tag: w.tag,
      kind: "entrance",
      schema: "accessibility",
      category: "Accessibility",
      question: `DEV FIXTURE B03-A Is the checked entrance step-free for guests arriving ${w.tag}?`,
    })
    expect(registryVersion(q.key)).toEqual({
      version: 1,
      schema: "accessibility",
      schemaVersion: 1,
      lifecycle: "supported",
      inForce: true,
    })
    // A separate accessibility question at the same venue, never answered here.
    const other = "accessible_toilet"
    const checksA = await enableOnWorkingList(w, w.venueA, [q.key, other])
    const checksB = await enableOnWorkingList(w, w.venueB, [q.key])
    const id = checksA[q.key]!
    const otherId = checksA[other]!
    const emptyId = checksB[q.key]!

    // Two named entrances at venue A, by its manager; none at venue B.
    const frontLabel = `DEV FIXTURE Front door ${w.tag}`
    const sideLabel = `DEV FIXTURE Side gate beside the long covered walkway to the car park ${w.tag}`
    const front = await addPlace(w.managerA, "entrance", frontLabel)
    const side = await addPlace(w.managerA, "entrance", sideLabel)
    const sideBefore = place(side)
    const otherBefore = storedCheck(otherId)
    const otherContributionsBefore = contributionsAt(w.venueA, otherId)
    const photo = await seedPhoto(w.staffA, w.venueA, `b03a-${w.tag}`)
    const photoA2 = await seedPhoto(w.staffA2, w.venueA, `b03a-a2-${w.tag}`)
    const checkedOn = londonDaysAgo(3)

    // ---- 320 px: wrapped labels, the action dock, errors and focus --------
    const narrow = await signedInPage(browser, w.staffA2, PHONE(320, 640))
    await narrow.goto(staffCaptureHref(id))
    const n = capture(narrow)
    await n.answer("Yes")
    await expect(
      n.scope.getByRole("radio", { name: sideLabel, exact: true })
    ).toBeVisible()
    const sideRow = n.scope.locator("label").filter({ hasText: sideLabel })
    const sideBox = (await sideRow.boundingBox())!
    expect(
      sideBox.x + sideBox.width,
      "the long entrance label wraps"
    ).toBeLessThanOrEqual(320)
    const sideLines = await sideRow.locator("span").evaluate((el) => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
      return Math.round(el.getBoundingClientRect().height / lineHeight)
    })
    expect(sideLines, "on more than one line").toBeGreaterThan(1)
    await evidenceBox(narrow, photoA2).check()
    // The dock stays on screen and inside the width while the form scrolls.
    await n.checkedOn.scrollIntoViewIfNeeded()
    await expect(n.submit).toBeInViewport()
    const dock = (await n.submit.boundingBox())!
    expect(dock.x).toBeGreaterThanOrEqual(0)
    expect(dock.x + dock.width).toBeLessThanOrEqual(320)
    expect(dock.height).toBeGreaterThanOrEqual(44)
    const overflow = await horizontalOverflow(narrow)
    expect(overflow.overflowPx, overflow.culprit).toBe(0)
    // Yes without a place: refused here, the message is on the scope and
    // focus moves into it; nothing reaches the server.
    await n.submit.click()
    await expect(n.scope.getByText(ACCESS_COPY.scopeRequired)).toBeVisible()
    await expectFocusWithin(n.scope)
    // A Checked on date in the future is refused on its own field.
    await n.scope.getByRole("radio", { name: frontLabel, exact: true }).check()
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
    await expect(
      e.scope.getByText(ACCESS_COPY.noPlaces(w.venueB.name))
    ).toBeVisible()
    await expect(e.scope.getByRole("radio", { name: frontLabel })).toHaveCount(
      0
    )
    await e.reason.fill("DEV FIXTURE no entrance is listed here")
    await e.submit.click()
    await expect(e.scope.getByText(ACCESS_COPY.scopeRequired)).toBeVisible()
    await expectFocusWithin(e.scope)
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
      name: new RegExp(`: ${escape(q.question)}$`),
    })
    await expect(row).toBeVisible()
    await row.tap()
    await expect(staff).toHaveURL(
      new RegExp(`${escape(staffCaptureHref(id))}$`)
    )
    const s = capture(staff)
    await s.answer("Yes")
    await s.scope.getByRole("radio", { name: frontLabel, exact: true }).check()
    await expect(s.scope).toContainText(ACCESS_COPY.covers(frontLabel))
    await expect(s.checkedOn).toHaveValue(londonDaysAgo(0))
    await s.checkedOn.fill(checkedOn)
    await evidenceBox(staff, photo).check()

    // The real submit is held: the controls say it's sending and can't send
    // twice; the real response is then released.
    const hold = await holdNextSubmit(
      staff,
      staffCaptureHref(id),
      '"observedOnSource"'
    )
    await s.submit.click()
    await hold.reached
    await expect(s.submit).toHaveAttribute("aria-busy", "true")
    await expect(s.submit).toHaveAttribute("aria-disabled", "true")
    await expect(s.submit).toHaveText(SEND_PROGRESS_COPY.sending)
    await expect(s.checkedOn).toBeDisabled()
    await expect(
      s.scope.getByRole("radio", { name: sideLabel, exact: true })
    ).toBeDisabled()
    await s.submit.click({ force: true })
    expect(hold.count(), "one submit left the page").toBe(1)
    hold.release()
    await expect(staff).toHaveURL(new RegExp(`finding_sent=${id}`))
    await expect(
      staff.getByRole("status").filter({ hasText: q.question })
    ).toBeFocused()

    // What was recorded: one staff contribution with the chosen place and
    // date, on the version in force, not yet confirmed.
    const [sent, ...more] = contributionsAt(w.venueA, id)
    expect(more).toEqual([])
    expect(sent).toMatchObject({
      by: w.staffA.id,
      basis: "staff",
      kind: "finding",
      answer: "yes",
      detailRow: true,
      detailVenue: w.venueA.id,
      detail: { scope: { subjectId: front } },
      observedOn: checkedOn,
      observedOnSource: "chosen",
      questionVersion: 1,
      schema: "accessibility",
      schemaVersion: 1,
    })
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

    // ---- Staff Home and the check page keep the place and date -------------
    await staff.goto("/staff/tasks")
    const home = staff.getByRole("listitem").filter({ hasText: q.question })
    await expect(home).toContainText("Current answer: Yes.")
    await staff.goto(staffCaptureHref(id))
    await expect(staff.getByText(/Current answer: Yes\./).first()).toBeVisible()
    // The read both pages render from, in staff's own session.
    const view = await knowledgeRpc<{
      answerInUse: { value: string; detail: unknown; observedOn: string }
    }>(await sessionOf(w.staffA), "knowledge_check", { p_check_id: id })
    expect(view.answerInUse).toMatchObject({
      value: "yes",
      detail: { scope: { subjectId: front } },
      observedOn: checkedOn,
    })

    // The other entrance and the other accessibility question are untouched.
    expect(place(side)).toEqual(sideBefore)
    expect(JSON.stringify(contributionsAt(w.venueA, id))).not.toContain(side)
    expect(storedCheck(otherId)).toEqual(otherBefore)
    expect(contributionsAt(w.venueA, otherId)).toEqual(otherContributionsBefore)
  })
})
