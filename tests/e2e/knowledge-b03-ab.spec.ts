import { expect, test, type Page } from "@playwright/test"

import { amenityHrefs, staffCaptureHref } from "../../lib/amenities/contract"
import { ACCESS_COPY } from "../../components/nabalens/knowledge/accessibility-detail"
import { CHECKED_ON_COPY } from "../../components/nabalens/knowledge/checked-on"
import {
  policyConfirmBlock,
  policyNeedWords,
  SEND_PROGRESS_COPY,
} from "../../components/nabalens/knowledge/copy"
import { POLICY_COPY } from "../../components/nabalens/knowledge/policy-detail"
import {
  legacyManagerGrant,
  provisionAmenitiesWorld,
  seedPhoto,
  sessionOf,
} from "./helpers/amenities-world"
import {
  addPlace,
  adoptWithPolicyDetail,
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
const ADMIN = (venue: { id: string }) =>
  amenityHrefs(`/admin/coverage/${encodeURIComponent(venue.id)}`)
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

    // The page's adopted/history surfaces, read as they are. SOURCE GAP (as
    // built): History, Submissions and the event list render no policy
    // conditions, so none of them names the retired type; only the pending
    // card above does. Recorded, not passed off as history.
    await expect(manager.locator("#amenity-history")).toBeVisible()
    await expect(manager.locator("#amenity-submissions")).toBeVisible()
    const historyText = (
      await Promise.all(
        ["#amenity-history", "#amenity-submissions", "#amenity-events"].map(
          async (sel) => {
            const section = manager.locator(sel)
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
