import { randomUUID } from "node:crypto"

import { expect, test, type Locator, type Page } from "@playwright/test"

import { KNOWLEDGE_FAILURE_COPY } from "../../components/nabalens/knowledge/copy"
import { RECONCILE_COPY } from "../../components/nabalens/knowledge/reconcile-copy"
import { amenityHrefs, staffCaptureHref } from "../../lib/amenities/contract"
import {
  captureForm,
  provisionAmenitiesWorld,
  question,
  seedPhoto,
  sessionOf,
} from "./helpers/amenities-world"
import {
  attachFactPhoto,
  bumpLegacyRevision,
  importLegacy,
  importOf,
  knowledgeCall,
  knowledgeChecks,
  legacyRevision,
  mappingsOf,
  reviewMapping,
  runsAt,
  seedLegacyFact,
  slotRead,
  slotRevision,
  holdServerAction,
  uuid,
} from "./helpers/knowledge-b03-ef-world"
import { psql } from "./helpers/stack"
import { signedInPage } from "./helpers/world"

/**
 * B03-E and B03-F (B03 UI design §7-§8; A1, A15, A16, A43, A44) on the
 * isolated stack, in Chromium contexts at explicit viewports. Fixtures are
 * synthetic and scoped to this spec's venues, checks, facts and
 * contributions; every action and refusal under test is a real person in
 * their own browser session. Held responses are the real server's, released
 * unchanged.
 */

const DESK = { viewport: { width: 1280, height: 800 } }
const PHONE = { viewport: { width: 390, height: 844 } }

const MANAGER = amenityHrefs("/manager")
const adminHrefs = (venueId: string) =>
  amenityHrefs(`/admin/coverage/${venueId}`)

/**
 * Card words from components/nabalens/knowledge/decisions.tsx (IMPORT_COPY),
 * a client module this spec does not import.
 */
const IMPORT_TEXT = {
  never: "Imported records are never used until someone confirms them.",
  notAdoptable:
    "This import can't be used: this question already has a recorded answer (in use, withdrawn or past its check date). To change the answer, send a new finding or state it as a manager or an admin.",
  dontUse: "Don't use",
} as const

/** components/nabalens/knowledge/old-facts.tsx (OLD_FACTS_COPY.title). */
const oldFactsTitle = (n: number) => `From the old facts list (${n})`

/** The To confirm panel (CoverageSection id amenity-to-confirm). */
const toConfirm = (page: Page) => page.locator("#amenity-to-confirm")
/** Where it stands (CoverageSection id amenity-status). */
const whereItStands = (page: Page) => page.locator("#amenity-status")

/** One finding card in To confirm, by text only it carries. */
const cardWith = (page: Page, text: string): Locator =>
  toConfirm(page).getByRole("article").filter({ hasText: text })

/** From the old facts list: opened, and its scoped contents. */
async function openOldFacts(page: Page, n: number): Promise<Locator> {
  const summary = page.locator("summary", {
    hasText: /^From the old facts list \(\d+\)$/,
  })
  await expect(summary).toHaveText(oldFactsTitle(n))
  const details = page.locator("details").filter({ has: summary })
  if ((await details.getAttribute("open")) === null) await summary.click()
  return details
}

/** A refusal page, whatever its status, carries none of these. */
async function expectNone(page: Page, secrets: string[], label: string) {
  const html = await page.content()
  for (const secret of secrets)
    expect(html, `${label} leaks ${secret}`).not.toContain(secret)
}

test.describe("knowledge B03 E and F", () => {
  test.setTimeout(300_000)

  test("B03-E stale import refuses replacement and history scopes old facts", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const ADMIN = adminHrefs(w.venueA.id)
    // Two independent slots: guest_toilets for the happy path, onsite_parking
    // for the conflict. Both on venue A's working list, unassigned.
    const checks = await knowledgeChecks(w, w.venueA, [
      "guest_toilets",
      "onsite_parking",
    ])
    const toilets = checks.guest_toilets!
    const parking = checks.onsite_parking!
    const adminDb = await sessionOf(w.admin)

    // Synthetic legacy facts: toilets (exact, current revision) and parking
    // (exact, the other question); accessible_toilet reviewed for
    // guest_toilets at revision 1 and then moved on to revision 2.
    const TOILETS_NOTE = `DEV FIXTURE B03-E two toilets downstairs ${w.tag}`
    const PARKING_NOTE = `DEV FIXTURE B03-E car park behind the pub ${w.tag}`
    const OLDER_NOTE = `DEV FIXTURE B03-E older accessible toilet note ${w.tag}`
    const MAPPING_REASON = `DEV FIXTURE B03-E reviewed ${w.tag}`
    const toiletsFact = seedLegacyFact(
      w.venueA,
      "toilets",
      "present",
      TOILETS_NOTE
    )
    attachFactPhoto(
      toiletsFact,
      w.venueA,
      await seedPhoto(w.staffA, w.venueA, `b03e-toilets-${w.tag}`)
    )
    const parkingFact = seedLegacyFact(
      w.venueA,
      "parking",
      "present",
      PARKING_NOTE
    )
    const olderFact = seedLegacyFact(
      w.venueA,
      "accessible_toilet",
      "absent",
      OLDER_NOTE
    )
    await reviewMapping(
      adminDb,
      toiletsFact,
      1,
      "guest_toilets",
      "exact",
      MAPPING_REASON
    )
    await reviewMapping(
      adminDb,
      parkingFact,
      1,
      "onsite_parking",
      "exact",
      MAPPING_REASON
    )
    await reviewMapping(
      adminDb,
      olderFact,
      1,
      "guest_toilets",
      "candidate",
      MAPPING_REASON
    )
    expect(bumpLegacyRevision(olderFact)).toBe(2)
    await importLegacy(adminDb, w.venueA)

    // Mapping readback by legacy fact id, revision and question key.
    expect(mappingsOf([toiletsFact, parkingFact, olderFact])).toEqual(
      expect.arrayContaining([
        {
          legacyFactId: toiletsFact,
          legacyRevision: 1,
          questionKey: "guest_toilets",
          kind: "exact",
        },
        {
          legacyFactId: parkingFact,
          legacyRevision: 1,
          questionKey: "onsite_parking",
          kind: "exact",
        },
        {
          legacyFactId: olderFact,
          legacyRevision: 1,
          questionKey: "guest_toilets",
          kind: "candidate",
        },
      ])
    )
    expect(mappingsOf([toiletsFact, parkingFact, olderFact])).toHaveLength(3)
    expect([
      legacyRevision(toiletsFact),
      legacyRevision(parkingFact),
      legacyRevision(olderFact),
    ]).toEqual([1, 1, 2])

    // Provenance of each import: its own venue, check, source kind and the
    // exact legacy fact revision; no assertion. A candidate imports nothing.
    const toiletsImport = importOf(w.venueA, toiletsFact)
    expect(toiletsImport).toMatchObject({
      venueId: w.venueA.id,
      checkId: toilets,
      questionKey: "guest_toilets",
      sourceKind: "legacy_fact",
      legacyFactId: toiletsFact,
      legacyRevision: 1,
      assertionId: null,
      contributedBy: w.admin.id,
      initialOutcome: "awaiting_confirmation",
    })
    const parkingImport = importOf(w.venueA, parkingFact)
    expect(parkingImport).toMatchObject({
      venueId: w.venueA.id,
      checkId: parking,
      questionKey: "onsite_parking",
      sourceKind: "legacy_fact",
      legacyFactId: parkingFact,
      legacyRevision: 1,
      assertionId: null,
    })
    expect(
      psql(
        `select count(*) from public.knowledge_contribution_sources where legacy_fact_id = ${uuid(olderFact)}`
      )
    ).toBe("0")
    const SOURCE = toiletsImport.sourceLabel

    // ---- 1. Admin/manager at 1280: confirm an eligible import onto an empty slot.
    const manager = await signedInPage(browser, w.managerA, DESK)
    await manager.goto(MANAGER.check(toilets))
    const toiletsCard = cardWith(manager, TOILETS_NOTE)
    await expect(
      toiletsCard.getByRole("heading", {
        name: `Imported from ${SOURCE} by ${w.admin.name}`,
        exact: true,
      })
    ).toBeVisible()
    await expect(
      toiletsCard.getByText(IMPORT_TEXT.never, { exact: true })
    ).toBeVisible()
    const emptySlot = slotRead(w.venueA, toilets)
    expect(emptySlot.currentSubmissionId).toBeNull()
    await toiletsCard
      .getByRole("button", { name: "Confirm", exact: true })
      .click()
    await expect(
      toConfirm(manager).getByText(
        `Confirmed. This is now the answer for ${w.venueA.name}.`,
        { exact: true }
      )
    ).toBeVisible()
    await expect
      .poll(() => slotRead(w.venueA, toilets).currentSubmissionId)
      .not.toBeNull()
    const adopted = slotRead(w.venueA, toilets)
    expect(adopted).toMatchObject({
      currentAnswer: "yes",
      progress: "complete",
      submittedBy: w.admin.id,
      sourceContributionId: toiletsImport.contributionId,
    })
    expect(
      adopted.decisions
        .filter((d) => !emptySlot.decisions.some((e) => e.id === d.id))
        .map((d) => [
          d.decision,
          d.decidedBy,
          d.basis,
          d.contributionId,
          d.resultingSubmissionId,
        ])
    ).toEqual([
      [
        "adopted",
        w.managerA.id,
        "venue_manager",
        toiletsImport.contributionId,
        adopted.currentSubmissionId,
      ],
    ])
    // Adoption leaves the append-only provenance as it was.
    expect(importOf(w.venueA, toiletsFact)).toEqual(toiletsImport)
    await expect(whereItStands(manager)).toContainText(
      `Current answer: Yes. Imported from ${SOURCE}.`
    )

    // ---- 2. History: old facts mapped to this question at the current revision.
    let facts = await openOldFacts(manager, 1)
    await expect(facts).toContainText(TOILETS_NOTE)
    await expect(facts).not.toContainText(OLDER_NOTE)
    await expect(facts).not.toContainText(PARKING_NOTE)
    await expect(facts).not.toContainText(MAPPING_REASON)

    const admin = await signedInPage(browser, w.admin, DESK)
    await admin.goto(ADMIN.check(toilets))
    facts = await openOldFacts(admin, 1)
    await expect(facts).toContainText(TOILETS_NOTE)
    await expect(facts).not.toContainText(OLDER_NOTE)
    await expect(facts).not.toContainText(PARKING_NOTE)

    // ---- 3. Conflict: the parking import card is held open in the manager's
    // page while the admin, in their own context, records a competing answer.
    await manager.goto(MANAGER.check(parking))
    const parkingCard = cardWith(manager, PARKING_NOTE)
    const staleConfirm = parkingCard.getByRole("button", {
      name: "Confirm",
      exact: true,
    })
    await expect(staleConfirm).toBeEnabled()
    facts = await openOldFacts(manager, 1)
    await expect(facts).toContainText(PARKING_NOTE)
    await expect(facts).not.toContainText(TOILETS_NOTE)
    await expect(facts).not.toContainText(OLDER_NOTE)
    expect(slotRead(w.venueA, parking).currentSubmissionId).toBeNull()

    const COMPETING_REASON = `DEV FIXTURE B03-E no guest parking now ${w.tag}`
    await admin.goto(ADMIN.capture(parking))
    const capture = captureForm(admin)
    await capture.answer("no")
    await capture.reason.fill(COMPETING_REASON)
    await capture.submit.click()
    await expect
      .poll(() => slotRead(w.venueA, parking).currentSubmissionId)
      .not.toBeNull()
    const recorded = slotRead(w.venueA, parking)
    expect(recorded).toMatchObject({
      currentAnswer: "no",
      submittedBy: w.admin.id,
      progress: "complete",
    })
    expect(recorded.sourceContributionId).not.toBe(parkingImport.contributionId)

    // The stale card is refused; the page re-reads and the import can no
    // longer be confirmed. Nothing about the recorded answer moves.
    await staleConfirm.click()
    await expect(
      toConfirm(manager).getByText(KNOWLEDGE_FAILURE_COPY.decision.stale, {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      parkingCard.getByText(IMPORT_TEXT.notAdoptable, { exact: true })
    ).toBeVisible()
    await expect(
      parkingCard.getByRole("button", { name: "Confirm", exact: true })
    ).toHaveCount(0)
    await expect(
      parkingCard.getByRole("button", { name: IMPORT_TEXT.dontUse })
    ).toBeVisible()
    await expect(whereItStands(manager)).toContainText(
      /(Current|Recorded) answer: No\./
    )
    expect(slotRead(w.venueA, parking)).toEqual(recorded)

    // The dedicated recorded-answer refusal (NLK14): the same manager, in
    // their own session, at the slot's CURRENT revision. A stale card meets
    // the revision check first, so the browser cannot reach this branch.
    const refused = await knowledgeCall(
      await sessionOf(w.managerA),
      "knowledge_decide",
      {
        p_target_type: "contribution",
        p_target_id: parkingImport.contributionId,
        p_decision: "confirm",
        p_slot_revision: slotRevision(w.venueA, "onsite_parking"),
        p_idempotency_key: randomUUID(),
        p_note: null,
      }
    )
    expect(refused.error?.message).toBe("import_slot_has_answer")
    expect(slotRead(w.venueA, parking)).toEqual(recorded)

    // ---- 4. Staff at 390: the approved source attribution, no private notes.
    const staff = await signedInPage(browser, w.staffA, PHONE)
    await staff.goto(staffCaptureHref(toilets))
    await expect(
      staff.getByRole("heading", {
        level: 1,
        name: question("guest_toilets"),
        exact: true,
      })
    ).toBeVisible()
    await expect(
      staff.getByText(`Current answer: Yes. Imported from ${SOURCE}.`, {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      staff.getByText(oldFactsTitle(1), { exact: true })
    ).toHaveCount(0)
    await expectNone(
      staff,
      [TOILETS_NOTE, PARKING_NOTE, OLDER_NOTE, MAPPING_REASON, w.admin.name],
      "staff 390 check page"
    )

    // ---- 5. Manager and staff are refused admin Sources and Runs.
    for (const [page, label] of [
      [manager, "manager"],
      [staff, "staff"],
    ] as const) {
      for (const path of [
        "/admin/knowledge/sources",
        "/admin/knowledge/runs",
      ]) {
        const res = await page.goto(path)
        expect(res?.status(), `${label} ${path}`).toBeLessThan(500)
        await expect(page, `${label} ${path}`).not.toHaveURL(/\/admin(\/|$)/)
        await expect(
          page.getByRole("heading", { name: RECONCILE_COPY.sourcesTitle })
        ).toHaveCount(0)
        await expect(
          page.getByRole("heading", {
            name: RECONCILE_COPY.runsTitle,
            exact: true,
          })
        ).toHaveCount(0)
        await expect(
          page.getByRole("button", { name: RECONCILE_COPY.startSubmit })
        ).toHaveCount(0)
        await expectNone(
          page,
          [TOILETS_NOTE, PARKING_NOTE, MAPPING_REASON],
          `${label} ${path}`
        )
      }
    }
    await expect(manager).toHaveURL(/\/manager(\/|$|\?)/)

    // ---- 6. Admin Runs: hold the real dry-run response, then release it.
    await admin.goto("/admin/knowledge/runs")
    await expect(
      admin.getByRole("heading", {
        name: RECONCILE_COPY.runsTitle,
        exact: true,
      })
    ).toBeVisible()
    const startForm = admin.getByRole("form", { name: RECONCILE_COPY.start })
    await startForm
      .getByLabel(RECONCILE_COPY.scopeVenue, { exact: true })
      .selectOption(w.venueA.id)
    const runsBefore = runsAt(w.venueA)
    const held = await holdServerAction(
      admin,
      (body) => body.includes('"dry_run"') && body.includes(w.venueA.id)
    )
    await startForm
      .getByRole("button", { name: RECONCILE_COPY.startSubmit })
      .click()
    await held.arrived
    const running = startForm.getByRole("button", {
      name: RECONCILE_COPY.running,
    })
    await expect(running).toBeDisabled()
    await expect(running).toHaveAttribute("aria-busy", "true")
    await expect(
      startForm.getByRole("radio", { name: RECONCILE_COPY.runKind.legacy })
    ).toBeDisabled()
    await expect(
      startForm.getByLabel(RECONCILE_COPY.scopeVenue, { exact: true })
    ).toBeDisabled()
    expect(runsAt(w.venueA), "nothing runs while held").toBe(runsBefore)
    held.release()
    await expect(admin).toHaveURL(
      /\/admin\/knowledge\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    await expect(
      admin.getByRole("heading", {
        name: `${RECONCILE_COPY.runKind.legacy} · ${RECONCILE_COPY.runMode.dry_run} · ${w.venueA.name}`,
        exact: true,
      })
    ).toBeVisible()
    expect(held.count(), "one dry run request").toBe(1)
    expect(runsAt(w.venueA)).toBe(runsBefore + 1)
    await held.dispose()
  })
})
