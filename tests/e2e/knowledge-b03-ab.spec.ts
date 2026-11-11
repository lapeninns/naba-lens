import { expect, test, type Page } from "@playwright/test"

import { amenityHrefs, staffCaptureHref } from "../../lib/amenities/contract"
import {
  ACCESS_COPY,
  type FeatureValue,
} from "../../components/nabalens/knowledge/accessibility-detail"
import { CHECKED_ON_COPY } from "../../components/nabalens/knowledge/checked-on"
import { AT_DATE_COPY } from "../../components/nabalens/knowledge/corrections-copy"
import {
  policyConfirmBlock,
  policyNeedWords,
  SEND_PROGRESS_COPY,
} from "../../components/nabalens/knowledge/copy"
import { POLICY_COPY } from "../../components/nabalens/knowledge/policy-detail"
import {
  legacyManagerGrant,
  provisionAmenitiesWorld,
  question,
  seedPhoto,
  seedVideo,
  sessionOf,
} from "./helpers/amenities-world"
import {
  addPlace,
  adoptWithPolicyDetail,
  B03_DISPOSABLE_REGISTRY,
  contributionsAt,
  decisionsAt,
  enableOnWorkingList,
  evidenceBox,
  expectFocusWithin,
  holdNextSubmit,
  knowledgeRpc,
  legacyCheck,
  londonDaysAgo,
  organisationScopeRows,
  place,
  policyCapabilities,
  policyMissing,
  registryVersion,
  retireValueItem,
  seedSyntheticQuestion,
  seedValueItem,
  sendStatement,
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
const ADMIN = (venue: { id: string }) =>
  amenityHrefs(`/admin/coverage/${encodeURIComponent(venue.id)}`)
const PHONE = (width: number, height = 740) => ({
  viewport: { width, height },
  isMobile: true,
  hasTouch: true,
})
const DESKTOP = { viewport: { width: 1280, height: 900 } }

/**
 * After a document load, until React moves a streamed boundary into the page:
 * meanwhile the boundary sits both in the page and in a hidden `<div id="S:n">`
 * (tests/e2e/visual.spec.ts), so strict id locators would match twice.
 */
async function settled(page: Page) {
  await expect(page.locator('body > div[hidden][id^="S:"]')).toHaveCount(0)
}

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
    // A separate accessibility question at the same venue, never answered
    // here. Synthetic, with its own rule: the working list refuses a key
    // without one (knowledge_rule_missing), and accessible_toilet has none.
    const other = seedSyntheticQuestion({
      tag: w.tag,
      kind: "toilet",
      schema: "accessibility",
      category: "Accessibility",
      question: `DEV FIXTURE B03-A Is there an accessible toilet ${w.tag}?`,
    }).key
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
    const emptyBefore = storedCheck(emptyId)
    const emptyDecisionsBefore = decisionsAt(w.venueB, emptyId)
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
    expect(storedCheck(emptyId), "check unchanged").toEqual(emptyBefore)
    expect(decisionsAt(w.venueB, emptyId), "no decision").toEqual(
      emptyDecisionsBefore
    )
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
    expect(storedCheck(emptyId)).toEqual(emptyBefore)
    expect(decisionsAt(w.venueB, emptyId)).toEqual(emptyDecisionsBefore)
  })

  test("B03-B: an incomplete policy cannot pass as an authorized answer", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    // The pinned registry version: policy.v1 on two synthetic keys, one for
    // the statement under test and one holding the separate legacy answer.
    const q = seedSyntheticQuestion({
      tag: w.tag,
      kind: "policy",
      schema: "policy",
      category: "Policies",
      question: `DEV FIXTURE B03-B Are dogs allowed inside ${w.tag}?`,
    })
    const legacyQ = seedSyntheticQuestion({
      tag: w.tag,
      kind: "legacy",
      schema: "policy",
      category: "Policies",
      question: `DEV FIXTURE B03-B Are dogs allowed on the terrace ${w.tag}?`,
    })
    for (const key of [q.key, legacyQ.key])
      expect(registryVersion(key)).toEqual({
        version: 1,
        schema: "policy",
        schemaVersion: 1,
        lifecycle: "supported",
        inForce: true,
      })
    const onLead = seedValueItem({
      tag: w.tag,
      list: "policy_condition_types",
      name: "on_lead",
      label: "On a lead",
    })
    const maxDogs = seedValueItem({
      tag: w.tag,
      list: "policy_condition_types",
      name: "max_dogs",
      label: "Maximum dogs",
      valueKind: "number",
    })
    const oldRule = seedValueItem({
      tag: w.tag,
      list: "policy_condition_types",
      name: "old_rule",
      label: "Bar area only",
    })
    const checks = await enableOnWorkingList(w, w.venueA, [q.key, legacyQ.key])
    const id = checks[q.key]!
    const legacyId = checks[legacyQ.key]!
    const keys = [q.key, legacyQ.key]

    // The separate legacy answer, bound to the soon-retired type: in use,
    // confirmed by the manager, but with no stated date or source.
    const legacyPhoto = await seedPhoto(
      w.managerA,
      w.venueA,
      `b03b-legacy-${w.tag}`,
      { uploaderRole: "manager" }
    )
    const adopted = await adoptWithPolicyDetail(
      w.managerA,
      w.venueA,
      { id: legacyId, key: legacyQ.key },
      { stance: "conditional", conditions: [{ type: oldRule.code }] },
      [legacyPhoto]
    )
    // Another manager's complete statement naming the same type, left for
    // managerA to decide.
    await legacyManagerGrant(w, w.staffA2, w.venueA)
    const otherPhoto = await seedPhoto(
      w.staffA2,
      w.venueA,
      `b03b-other-${w.tag}`
    )
    const otherStatement = await sendStatement(
      w.staffA2,
      w.venueA,
      { id: legacyId, key: legacyQ.key },
      {
        stance: "conditional",
        conditions: [{ type: oldRule.code }],
        policyScope: "venue",
        authority: {
          basis: "venue_manager",
          source: "written_policy",
          statedOn: londonDaysAgo(2),
        },
      },
      [otherPhoto]
    )
    retireValueItem("policy_condition_types", oldRule)
    expect(policyMissing(legacyId)).toEqual(["authority", "stated_on"])

    const staffPhoto = await seedPhoto(w.staffA, w.venueA, `b03b-${w.tag}`)
    const managerPhoto = await seedPhoto(
      w.managerA,
      w.venueA,
      `b03b-manager-${w.tag}`,
      { uploaderRole: "manager" }
    )
    const statedOn = londonDaysAgo(1)
    const group = (page: Page, name: string) =>
      capture(page).form.getByRole("group", { name, exact: true })
    const needsPanel = (page: Page) =>
      page.getByRole("note", { name: POLICY_COPY.needsTitle })

    // ---- 390 px: staff observe the rule they saw; no authority controls ---
    expect(await policyCapabilities(w.staffA, null)).toEqual({
      canStatePolicy: false,
      canStateOrgPolicy: false,
      policyBasis: null,
    })
    const staff = await signedInPage(browser, w.staffA, PHONE(390, 844))
    await staff.goto(staffCaptureHref(id))
    const s = capture(staff)
    const seen = group(staff, POLICY_COPY.ruleSeen)
    await expect(seen).toContainText(POLICY_COPY.staffContext)
    await seen
      .getByRole("radio", {
        name: POLICY_COPY.stanceLabel.conditional,
        exact: true,
      })
      .check()
    await expect(
      s.form.getByRole("group", { name: POLICY_COPY.conditions, exact: true })
    ).toHaveCount(0)
    await expect(
      s.form.getByRole("group", { name: POLICY_COPY.appliesTo, exact: true })
    ).toHaveCount(0)
    await expect(
      s.form.getByRole("group", { name: POLICY_COPY.whoStated, exact: true })
    ).toHaveCount(0)
    await expect(needsPanel(staff)).toHaveCount(0)
    await evidenceBox(staff, staffPhoto).check()
    const staffOverflow = await horizontalOverflow(staff)
    expect(staffOverflow.overflowPx, staffOverflow.culprit).toBe(0)
    await s.submit.click()
    await expect(staff).toHaveURL(new RegExp(`finding_sent=${id}`))
    await staff.context().close()

    const [observed, ...extra] = contributionsAt(w.venueA, id)
    expect(extra).toEqual([])
    expect(observed).toMatchObject({
      by: w.staffA.id,
      basis: "staff",
      answer: "yes",
      detail: { stance: "conditional" },
      questionVersion: 1,
      schema: "policy",
      schemaVersion: 1,
    })
    expect(observed!.detail).not.toHaveProperty("authority")
    expect(observed!.detail).not.toHaveProperty("conditions")
    expect(decisionsAt(w.venueA, id)).toEqual([])

    // ---- 1280 px: the manager can't confirm the incomplete observation ----
    expect(await policyCapabilities(w.managerA, null)).toEqual({
      canStatePolicy: true,
      canStateOrgPolicy: false,
      policyBasis: "venue_manager",
    })
    const manager = await signedInPage(browser, w.managerA, DESKTOP)
    await manager.goto(MANAGER.check(id))
    await expect(
      manager.getByRole("link", { name: POLICY_COPY.statePolicy })
    ).toBeVisible()
    const card = manager.getByRole("article", {
      name: new RegExp(`from ${escape(w.staffA.name)}`),
    })
    const block = policyConfirmBlock(["conditions", "authority", "stated_on"])!
    await expect(card).toContainText(block)
    const blockedConfirm = card.getByRole("button", {
      name: "Confirm",
      exact: true,
    })
    // Unavailable but still focusable, and it says why.
    await expect(blockedConfirm).toHaveAttribute("aria-disabled", "true")
    await expect(blockedConfirm).toBeDisabled()
    await expect(blockedConfirm).not.toHaveAttribute("disabled")
    await expect(blockedConfirm).toHaveAccessibleDescription(block)
    // A pointer click waits for an enabled control, so press it from the
    // keyboard instead: Enter and Space both reach it and start nothing.
    const actions: string[] = []
    manager.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"])
        actions.push(r.url())
    })
    await blockedConfirm.focus()
    await expect(blockedConfirm).toBeFocused()
    await manager.keyboard.press("Enter")
    await manager.keyboard.press("Space")
    await expect(blockedConfirm).toBeFocused()
    await expect(manager.getByText(/^Confirmed\./)).toHaveCount(0)
    await expect(card).toBeVisible()
    expect(decisionsAt(w.venueA, id), "no confirmation").toEqual([])
    expect(storedCheck(id).submission).toBeNull()
    expect(contributionsAt(w.venueA, id)).toEqual([observed])
    expect(actions, "no decision left the page").toEqual([])

    // Complete the policy from that finding, as the venue manager.
    await card.getByRole("link", { name: POLICY_COPY.completePolicy }).click()
    await expect(manager).toHaveURL(
      new RegExp(`${escape(MANAGER.capture(id))}\\?complete=`)
    )
    const m = capture(manager)
    // The notice names the sender by their first name only.
    const firstName = w.staffA.name.split(" ")[0]!
    await expect(
      m.form.getByRole("note").filter({
        hasText: POLICY_COPY.completesFrom(firstName),
      })
    ).toHaveText(POLICY_COPY.completesFrom(firstName))
    await expect(
      group(manager, POLICY_COPY.rule).getByRole("radio", {
        name: POLICY_COPY.stanceLabel.conditional,
        exact: true,
      })
    ).toBeChecked()
    const who = group(manager, POLICY_COPY.whoStated)
    await expect(who).toContainText(POLICY_COPY.basisLabel.venue_manager)
    await expect(
      m.form.getByRole("group", { name: POLICY_COPY.appliesTo, exact: true })
    ).toHaveCount(0)
    await expect(
      m.form.getByRole("radio", { name: POLICY_COPY.scopeLabel.organisation })
    ).toHaveCount(0)
    for (const need of policyNeedWords([
      "conditions",
      "authority",
      "stated_on",
    ]))
      await expect(needsPanel(manager)).toContainText(need)
    await expect(m.submit).toHaveText("Save policy (not confirmed)")

    // A fresh condition is offered the active types only, never the retired.
    const conditions = group(manager, POLICY_COPY.conditions)
    await conditions
      .getByRole("button", { name: POLICY_COPY.addCondition })
      .click()
    const type = conditions.getByLabel(POLICY_COPY.conditionType, {
      exact: true,
    })
    const offered = await type.locator("option").allTextContents()
    expect(offered).toEqual(
      expect.arrayContaining([onLead.label, maxDogs.label])
    )
    expect(offered).not.toContain(oldRule.label)
    expect(offered).not.toContain(POLICY_COPY.retired(oldRule.label))
    await type.selectOption(maxDogs.code)
    await expect(needsPanel(manager)).not.toContainText(
      policyNeedWords(["conditions"])[0]!
    )
    await expect(m.submit).toHaveText("Save policy (not confirmed)")
    await manager
      .getByLabel(POLICY_COPY.statedOn, { exact: true })
      .fill(statedOn)
    await group(manager, POLICY_COPY.where)
      .getByRole("radio", { name: POLICY_COPY.sourceLabel.in_person })
      .check()
    await expect(needsPanel(manager)).toContainText(POLICY_COPY.nothingMissing)
    await m.form.getByRole("radio", { name: /^I confirm it now/ }).check()
    await expect(m.submit).toHaveText("Submit and confirm")
    await evidenceBox(manager, managerPhoto).check()
    // The condition still lacks its value: refused here, nothing is sent.
    await m.submit.click()
    await expect(conditions).toContainText(POLICY_COPY.valueNeeded)
    expect(contributionsAt(w.venueA, id)).toEqual([observed])
    expect(decisionsAt(w.venueA, id)).toEqual([])

    // Complete and confirm the valid conditional policy.
    await conditions
      .getByLabel(POLICY_COPY.conditionValue, { exact: true })
      .fill("2")
    await m.submit.click()
    await expect(manager).toHaveURL(new RegExp(`finding_sent=${id}`))
    const stated = contributionsAt(w.venueA, id).find(
      (c) => c.by === w.managerA.id
    )
    expect(stated).toMatchObject({
      answer: "yes",
      detailRow: true,
      detail: {
        stance: "conditional",
        conditions: [{ type: maxDogs.code, value: 2 }],
        policyScope: "venue",
        authority: { basis: "venue_manager", source: "in_person", statedOn },
      },
      questionVersion: 1,
      schema: "policy",
      schemaVersion: 1,
    })
    expect(
      decisionsAt(w.venueA, id).filter((d) => d.decision === "confirmed")
    ).toEqual([
      {
        contribution: stated!.id,
        decision: "confirmed",
        by: w.managerA.id,
        basis: "venue_manager",
        self: true,
      },
    ])
    expect(policyMissing(id)).toEqual([])
    expect(storedCheck(id)).toMatchObject({
      progress: "complete",
      answer: "yes",
    })
    await expect(needsPanel(manager)).toHaveCount(0)

    // ---- The separate legacy answer stays incomplete and qualified --------
    expect(await legacyCheck(w.managerA, w.venueA, legacyQ.key)).toEqual({
      progress: "needs_recheck",
      recheckReason:
        "The policy in use is not complete yet. Open the check to see what it still needs.",
      qualification: "policy_incomplete",
    })
    expect(storedCheck(legacyId)).toMatchObject({
      progress: "complete",
      answer: "yes",
    })
    expect(policyMissing(legacyId)).toEqual(["authority", "stated_on"])
    await manager.goto(MANAGER.check(legacyId))
    await settled(manager)
    for (const need of policyNeedWords(["authority", "stated_on"]))
      await expect(needsPanel(manager)).toContainText(need)
    const retiredName = POLICY_COPY.retired(oldRule.label)

    // The other manager's statement on this check is still pending: its To
    // confirm card names the retired type. That card is not history.
    const pendingStatement = manager.getByRole("article", {
      name: new RegExp(
        `^Finding from ${escape(w.staffA2.name)}( \\(assigned\\))?$`
      ),
    })
    await expect(pendingStatement).toHaveCount(1)
    await expect(
      pendingStatement.getByText(retiredName, { exact: true })
    ).toBeVisible()
    expect(
      contributionsAt(w.venueA, legacyId).find((c) => c.id === otherStatement)
    ).toMatchObject({
      by: w.staffA2.id,
      detail: { conditions: [{ type: oldRule.code }] },
    })
    expect(
      decisionsAt(w.venueA, legacyId).filter(
        (d) => d.contribution === otherStatement
      ),
      "the other statement is undecided"
    ).toEqual([])

    // The adopted answer, apart from that card. Its stored detail and its
    // confirmation name the retired type (DB), and the owner's list in
    // managerA's own session keeps the type as retired, never offered (RPC).
    expect(
      contributionsAt(w.venueA, legacyId).find((c) => c.id === adopted)
    ).toMatchObject({
      by: w.managerA.id,
      detailRow: true,
      detail: { stance: "conditional", conditions: [{ type: oldRule.code }] },
    })
    expect(
      decisionsAt(w.venueA, legacyId).filter((d) => d.decision === "confirmed")
    ).toEqual([
      {
        contribution: adopted,
        decision: "confirmed",
        by: w.managerA.id,
        basis: "venue_manager",
        self: true,
      },
    ])
    const list = await knowledgeRpc<{
      items: { code: string }[]
      retired: { code: string; label: string }[] | null
    }>(await sessionOf(w.managerA), "knowledge_value_list", {
      p_list: "policy_condition_types",
    })
    expect(list.items.map((i) => i.code)).not.toContain(oldRule.code)
    expect(list.retired ?? []).toContainEqual(
      expect.objectContaining({ code: oldRule.code, label: oldRule.label })
    )

    // The answer on a date reads the adopted snapshot's own detail with the
    // owner's lists, so it names the retired type (A38). This incomplete
    // policy isn't shown as the current answer (§4.3), so Where it stands
    // has the needs panel instead of its rows.
    const atDate = manager.locator("#main #amenity-at-date")
    await atDate
      .getByLabel(AT_DATE_COPY.date, { exact: true })
      .fill(londonDaysAgo(0))
    await atDate.getByRole("button", { name: AT_DATE_COPY.show }).click()
    await expect(
      atDate.getByText(`Conditions: ${retiredName}`, { exact: true })
    ).toBeVisible()

    // The other adopted/history surfaces, read as they are. SOURCE GAP (as
    // built): History, Submissions and the event list render no policy
    // conditions, so none of them names the retired type. Recorded, not
    // passed off as history.
    await expect(manager.locator("#main #amenity-history")).toBeVisible()
    await expect(manager.locator("#main #amenity-submissions")).toBeVisible()
    const historyText = (
      await Promise.all(
        ["#amenity-history", "#amenity-submissions", "#amenity-events"].map(
          async (sel) => {
            const section = manager.locator(`#main ${sel}`)
            return (await section.count()) ? section.innerText() : ""
          }
        )
      )
    ).join("\n")
    if (!historyText.includes(retiredName))
      test.info().annotations.push({
        type: "source-gap",
        description:
          "B03-B: the adopted answer's history (History, Submissions, events) does not name its retired condition type; only the other manager's pending card does.",
      })
    await manager.context().close()

    // ---- 1280 px: an admin may choose Every venue; nothing is written -----
    expect(await policyCapabilities(w.admin, w.venueA)).toEqual({
      canStatePolicy: true,
      canStateOrgPolicy: true,
      policyBasis: "admin",
    })
    const contributionsBefore = contributionsAt(w.venueA, id)
    const checkBefore = storedCheck(id)
    const admin = await signedInPage(browser, w.admin, DESKTOP)
    await admin.goto(ADMIN(w.venueA).capture(id))
    const a = capture(admin)
    await group(admin, POLICY_COPY.rule)
      .getByRole("radio", {
        name: POLICY_COPY.stanceLabel.allowed,
        exact: true,
      })
      .check()
    await expect(group(admin, POLICY_COPY.whoStated)).toContainText(
      POLICY_COPY.basisLabel.admin
    )
    const appliesTo = group(admin, POLICY_COPY.appliesTo)
    await expect(
      appliesTo.getByRole("radio", { name: POLICY_COPY.scopeLabel.venue })
    ).toBeChecked()
    await appliesTo
      .getByRole("radio", { name: POLICY_COPY.scopeLabel.organisation })
      .check()
    await expect(appliesTo).toContainText(POLICY_COPY.everyVenueHelp)
    for (const need of policyNeedWords(["authority", "stated_on"], {
      admin: true,
    }))
      await expect(needsPanel(admin)).toContainText(need)
    await expect(a.submit).toHaveText("Save policy (not confirmed)")
    await admin.context().close()
    expect(organisationScopeRows(keys), "no organisation-wide write").toBe(0)
    expect(contributionsAt(w.venueA, id)).toEqual(contributionsBefore)
    expect(storedCheck(id)).toEqual(checkBefore)
  })
})
