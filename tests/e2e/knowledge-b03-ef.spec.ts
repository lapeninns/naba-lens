import { randomUUID } from "node:crypto"

import { expect, test, type Locator, type Page } from "@playwright/test"

import { ACCESS_COPY } from "../../components/nabalens/knowledge/accessibility-detail"
import {
  dateAndTime,
  KNOWLEDGE_FAILURE_COPY,
  LEGACY_QUALIFICATION_WORD,
  longDate,
} from "../../components/nabalens/knowledge/copy"
import {
  AT_DATE_COPY,
  CORRECT_COPY,
  WITHDRAW_COPY,
  whenWords,
} from "../../components/nabalens/knowledge/corrections-copy"
import { RECONCILE_COPY } from "../../components/nabalens/knowledge/reconcile-copy"
import { MANAGER_COPY } from "../../components/nabalens/manager/copy"
import {
  amenityHrefs,
  ANSWER_LABEL,
  staffCaptureHref,
} from "../../lib/amenities/contract"
import {
  amenityOk,
  captureForm,
  checkItem,
  checkState,
  legacyManagerGrant,
  provisionAmenitiesWorld,
  question,
  seedPhoto,
  seedVideo,
  sessionOf,
} from "./helpers/amenities-world"
import {
  addStaff,
  attachFactPhoto,
  bumpLegacyRevision,
  confirmFinding,
  detailCorrections,
  holdServerAction,
  importLegacy,
  importOf,
  knowledgeCall,
  knowledgeChecks,
  knowledgeOk,
  legacyRevision,
  londonWallClock,
  mappingsOf,
  reviewMapping,
  runsAt,
  secondAfter,
  seedLegacyFact,
  sendFinding,
  slotRead,
  slotRevision,
  uuid,
} from "./helpers/knowledge-b03-ef-world"
import {
  addPlace,
  stepFreeAccessibilityVersion,
} from "./helpers/knowledge-b03-ab-world"
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
const LEGACY_MANAGE = amenityHrefs("/staff/manage")
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

/**
 * After a document load, until React moves a streamed boundary into the page:
 * meanwhile the boundary sits both in the page and in a hidden `<div id="S:n">`
 * (tests/e2e/visual.spec.ts), so strict id locators would match twice.
 */
async function settled(page: Page) {
  await expect(page.locator('body > div[hidden][id^="S:"]')).toHaveCount(0)
}

/**
 * Once the page has settled, the check page renders each of its sections
 * once: the #main scoping below can't hide a duplicate rendered elsewhere.
 */
async function singleSections(page: Page) {
  await expect(page.locator("#amenity-status")).toHaveCount(1)
  await expect(page.locator("#amenity-history")).toHaveCount(1)
}

/** The To confirm panel (CoverageSection id amenity-to-confirm). */
const toConfirm = (page: Page) => page.locator("#main #amenity-to-confirm")
/** Where it stands (CoverageSection id amenity-status). */
const whereItStands = (page: Page) => page.locator("#main #amenity-status")

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

/** A refused RPC, by its exact SQLSTATE and exception message. */
function expectRefusal(
  result: { error: { code: string; message: string } | null },
  refusal: { code: string; message: string },
  label: string
) {
  expect(
    result.error && { code: result.error.code, message: result.error.message },
    label
  ).toEqual(refusal)
}

/** History (CoverageSection id amenity-history), for readers allowed it. */
const history = (page: Page) => page.locator("#main #amenity-history")
/** See the answer on a date (CoverageSection id amenity-at-date). */
const atDate = (page: Page) => page.locator("#main #amenity-at-date")

/**
 * The /manager check's not-found screen (tests/e2e/amenities-isolation.spec):
 * the shared "This check isn't here", or the workspace's own not-found.
 */
const managerNotFound = (page: Page): Locator =>
  page
    .getByRole("heading", { name: "This check isn't here", exact: true })
    .or(page.getByText(MANAGER_COPY.notFound.title, { exact: true }))
    .first()

/**
 * Asks "See the answer on a date" for an instant, typed as its London date
 * and HH:MM:SS; returns the words the result names it by.
 */
async function answerOn(page: Page, iso: string): Promise<string> {
  const { date, time } = londonWallClock(iso)
  const section = atDate(page)
  await section.getByLabel(AT_DATE_COPY.date, { exact: true }).fill(date)
  await section.getByLabel(AT_DATE_COPY.time, { exact: true }).fill(time)
  await section.getByRole("button", { name: AT_DATE_COPY.show }).click()
  return whenWords(date, time)
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
    await settled(manager)
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
    await settled(admin)
    facts = await openOldFacts(admin, 1)
    await expect(facts).toContainText(TOILETS_NOTE)
    await expect(facts).not.toContainText(OLDER_NOTE)
    await expect(facts).not.toContainText(PARKING_NOTE)

    // ---- 3. Conflict: the parking import card is held open in the manager's
    // page while manager A, in another context, records a competing answer.
    await manager.goto(MANAGER.check(parking))
    await settled(manager)
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
    // The revision the held-open card was rendered at.
    const staleRevision = slotRevision(w.venueA, "onsite_parking")

    // The competing answer comes from manager A, not the admin who ran the
    // import: under the one-undecided-finding-per-person rule, the importer's
    // own later answer would replace their import, and no card would remain.
    const COMPETING_REASON = `DEV FIXTURE B03-E no guest parking now ${w.tag}`
    const competitor = await signedInPage(browser, w.managerA, DESK)
    await competitor.goto(MANAGER.capture(parking))
    await settled(competitor)
    const capture = captureForm(competitor)
    await capture.answer("no")
    await capture.reason.fill(COMPETING_REASON)
    await capture.submit.click()
    await expect
      .poll(() => slotRead(w.venueA, parking).currentSubmissionId)
      .not.toBeNull()
    const recorded = slotRead(w.venueA, parking)
    expect(recorded).toMatchObject({
      currentAnswer: "no",
      submittedBy: w.managerA.id,
      progress: "complete",
    })
    await competitor.context().close()
    expect(recorded.sourceContributionId).not.toBe(parkingImport.contributionId)
    expect(slotRevision(w.venueA, "onsite_parking")).not.toBe(staleRevision)

    // What the browser can show, and what it cannot. knowledge_decide checks
    // the slot revision (amenity_conflict) before the recorded-answer rule
    // (NLK14, import_slot_has_answer), so a card held open across a competing
    // answer always meets the revision check first: the person sees the
    // generic stale words, never the dedicated NLK14 toast. The refreshed card
    // then carries the dedicated recorded-answer wording and no Confirm. The
    // NLK14 branch is proven separately below, by RPC at the CURRENT revision
    // in the manager's own session; a dedicated stale-action toast in the
    // browser stays unproven by this spec. Nothing about the answer moves.
    await staleConfirm.click()
    await expect(
      toConfirm(manager).getByText(KNOWLEDGE_FAILURE_COPY.decision.stale, {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      manager.getByText(KNOWLEDGE_FAILURE_COPY.decision.importSlotHasAnswer, {
        exact: true,
      }),
      "the stale card meets the revision check, not NLK14"
    ).toHaveCount(0)
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
    expect(importOf(w.venueA, parkingFact)).toEqual(parkingImport)

    // The two server branches, each in the same manager's own session. At
    // the card's stale revision: the generic conflict the browser showed. At
    // the CURRENT revision: the dedicated recorded-answer refusal (NLK14).
    const managerDb = await sessionOf(w.managerA)
    const confirmImportAt = (revision: number) =>
      knowledgeCall(managerDb, "knowledge_decide", {
        p_target_type: "contribution",
        p_target_id: parkingImport.contributionId,
        p_decision: "confirm",
        p_slot_revision: revision,
        p_idempotency_key: randomUUID(),
        p_note: null,
      })
    expectRefusal(
      await confirmImportAt(staleRevision),
      { code: "P0001", message: "amenity_conflict" },
      "import confirm at the card's stale revision"
    )
    expectRefusal(
      await confirmImportAt(slotRevision(w.venueA, "onsite_parking")),
      { code: "NLK14", message: "import_slot_has_answer" },
      "import confirm at the current revision"
    )
    // Persisted state after both refusals: the recorded answer, its
    // decisions and revision, and the import's provenance, all as they were.
    expect(slotRead(w.venueA, parking)).toEqual(recorded)
    expect(
      recorded.decisions.filter(
        (d) =>
          d.contributionId === parkingImport.contributionId &&
          (d.decision === "adopted" || d.decision === "confirmed")
      ),
      "the refused import was never adopted"
    ).toEqual([])
    expect(importOf(w.venueA, parkingFact)).toEqual(parkingImport)

    // ---- 4. Staff at 390: the approved source attribution, no private notes.
    const staff = await signedInPage(browser, w.staffA, PHONE)
    await staff.goto(staffCaptureHref(toilets))
    await settled(staff)
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
        await settled(page)
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
    await settled(admin)
    // The page title; the runs list below has its own "Runs" heading.
    await expect(
      admin.getByRole("heading", {
        name: RECONCILE_COPY.runsTitle,
        exact: true,
        level: 1,
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
    // Released and passed on even if a pending assertion fails.
    try {
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
    } finally {
      await held.settle()
    }
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
  })

  test("B03-F correction and withdrawal keep authorized historical answers", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const ADMIN = adminHrefs(w.venueA.id)
    // step_free_entrance needs a manager's confirmation (rule v1), so a
    // material correction has to be confirmed again.
    const KEY = "step_free_entrance"
    // On the disposable B03 lane the step-free key is accessibility.v1
    // (B03-A appends it; pinned here so F doesn't depend on run order). A No
    // then needs every listed entrance marked as having steps, so venue A
    // gets one entrance for the correction below to mark.
    stepFreeAccessibilityVersion()
    const ENTRANCE = `DEV FIXTURE B03-F Front door ${w.tag}`
    const entranceId = await addPlace(w.managerA, "entrance", ENTRANCE)
    const a = (await knowledgeChecks(w, w.venueA, [KEY]))[KEY]!
    const b = (await knowledgeChecks(w, w.venueB, [KEY]))[KEY]!
    // staffA sent the answer; staffA2 holds a legacy grant (history only);
    // the reader is ordinary staff who sent nothing here.
    await legacyManagerGrant(w, w.staffA2, w.venueA)
    const reader = addStaff(w, w.venueA, "B03F Reader")

    // Recorded history: staffA's Yes, confirmed by venue A's manager.
    const video = await seedVideo(w.staffA, w.venueA, `b03f-${w.tag}`)
    const sent = await sendFinding(
      await sessionOf(w.staffA),
      w.venueA,
      a,
      KEY,
      "yes",
      { assets: [video] }
    )
    expect(sent.outcome).toBe("awaiting_confirmation")
    await confirmFinding(
      await sessionOf(w.managerA),
      w.venueA,
      KEY,
      sent.contributionId
    )
    const NOTE = `DEV FIXTURE B03-F private manager note ${w.tag}`
    await amenityOk(await sessionOf(w.managerA), "amenity_set_check_notes", {
      p_check_id: a,
      p_notes: NOTE,
      p_revision: checkState(a).revision,
    })
    const first = slotRead(w.venueA, a)
    expect(first).toMatchObject({ currentAnswer: "yes", progress: "complete" })
    const firstConfirmed = first.decisions.find(
      (d) => d.decision === "confirmed"
    )!
    expect(firstConfirmed).toMatchObject({
      decidedBy: w.managerA.id,
      basis: "venue_manager",
      submissionId: first.currentSubmissionId,
    })

    // Venue B holds its own, different answer for the same question.
    const B_REASON = `DEV FIXTURE B03-F venue B has steps at every door ${w.tag}`
    const sentB = await sendFinding(
      await sessionOf(w.staffB),
      w.venueB,
      b,
      KEY,
      "no",
      { reason: B_REASON }
    )
    await confirmFinding(
      await sessionOf(w.managerB),
      w.venueB,
      KEY,
      sentB.contributionId
    )
    const venueBSlot = slotRead(w.venueB, b)
    expect(venueBSlot.currentAnswer).toBe("no")

    const CORRECTION_REASON = `DEV FIXTURE B03-F ramp removed ${w.tag}`
    const WITHDRAW_REASON = `DEV FIXTURE B03-F entrance under works ${w.tag}`
    const venueASecrets = [
      w.venueA.name,
      NOTE,
      video,
      w.staffA.name,
      CORRECTION_REASON,
      WITHDRAW_REASON,
    ]

    // ---- 1. Capability boundaries, before anything changes.
    const manager = await signedInPage(browser, w.managerA, DESK)
    await manager.goto(MANAGER.check(a))
    await settled(manager)
    await singleSections(manager)
    await expect(
      whereItStands(manager).getByRole("link", { name: CORRECT_COPY.open })
    ).toBeVisible()
    await expect(
      whereItStands(manager).getByRole("button", { name: WITHDRAW_COPY.open })
    ).toBeVisible()
    await expect(history(manager)).toBeVisible()
    await expect(atDate(manager)).toBeVisible()

    const admin = await signedInPage(browser, w.admin, DESK)
    await admin.goto(ADMIN.check(a))
    await settled(admin)
    await singleSections(admin)
    await expect(
      whereItStands(admin).getByRole("link", { name: CORRECT_COPY.open })
    ).toBeVisible()
    await expect(
      whereItStands(admin).getByRole("button", { name: WITHDRAW_COPY.open })
    ).toBeVisible()
    await expect(history(admin)).toBeVisible()

    // A staff account with a legacy grant reads history but cannot correct
    // or withdraw, even by opening the correction URL directly.
    const legacy = await signedInPage(browser, w.staffA2, DESK)
    await legacy.goto(LEGACY_MANAGE.check(a))
    await settled(legacy)
    await singleSections(legacy)
    await expect(history(legacy)).toBeVisible()
    await expect(atDate(legacy)).toBeVisible()
    await expect(
      legacy.getByRole("link", { name: CORRECT_COPY.open })
    ).toHaveCount(0)
    await expect(
      legacy.getByRole("button", { name: WITHDRAW_COPY.open })
    ).toHaveCount(0)
    await legacy.goto(`${LEGACY_MANAGE.capture(a)}?correct=1`)
    await settled(legacy)
    await expect(
      legacy.getByText(CORRECT_COPY.notPermitted, { exact: true })
    ).toBeVisible()
    await expect(
      legacy.getByRole("button", { name: CORRECT_COPY.save })
    ).toHaveCount(0)

    // Ordinary staff at 390: no history, correction or withdrawal anywhere.
    const staff = await signedInPage(browser, reader, PHONE)
    for (const path of [
      staffCaptureHref(a),
      `${staffCaptureHref(a)}?correct=1`,
    ]) {
      await staff.goto(path)
      await settled(staff)
      await expect(
        staff.getByRole("heading", {
          level: 1,
          name: question(KEY),
          exact: true,
        })
      ).toBeVisible()
      await expect(history(staff)).toHaveCount(0)
      await expect(atDate(staff)).toHaveCount(0)
      await expect(
        staff.getByRole("link", { name: CORRECT_COPY.open })
      ).toHaveCount(0)
      await expect(
        staff.getByRole("button", { name: CORRECT_COPY.save })
      ).toHaveCount(0)
      await expect(
        staff.getByRole("button", { name: WITHDRAW_COPY.open })
      ).toHaveCount(0)
    }
    await staff.goto(LEGACY_MANAGE.check(a))
    await settled(staff)
    await expect(history(staff)).toHaveCount(0)
    await expectNone(staff, [NOTE, video], "staff /staff/manage check")

    // Venue B's manager: venue A's check, correction and history are not
    // there, and nothing of venue A shows.
    const managerB = await signedInPage(browser, w.managerB, DESK)
    for (const path of [MANAGER.check(a), `${MANAGER.capture(a)}?correct=1`]) {
      await managerB.goto(path)
      // A refusal page, not settled(): notFound() thrown inside the capture
      // route's own loading boundary leaves an empty hidden placeholder
      // (S:n) that is never moved into the page.
      await expect(managerNotFound(managerB), `manager B ${path}`).toBeVisible()
      await expect(history(managerB)).toHaveCount(0)
      await expectNone(managerB, venueASecrets, `manager B ${path}`)
    }

    // Denied mutations and history reads in each person's own session, by
    // the exact contract (B03-g knowledge_correct as replaced by A40,
    // knowledge_withdraw; history as replaced by the B03 review repairs).
    // knowledge_corrector_basis refuses a same-venue staff account, with or
    // without a legacy grant: 42501 not_venue_manager. A person with no basis
    // at the venue, and a staff reader asking for history, are told the
    // check isn't there: P0002 amenity_check_not_found.
    const NOT_MANAGER = { code: "42501", message: "not_venue_manager" }
    const NOT_FOUND = { code: "P0002", message: "amenity_check_not_found" }
    const quiet = slotRead(w.venueA, a)
    for (const [person, mutation, historyRead] of [
      [w.staffA2, NOT_MANAGER, null],
      [reader, NOT_MANAGER, NOT_FOUND],
      [w.managerB, NOT_FOUND, NOT_FOUND],
      [w.staffB, NOT_FOUND, NOT_FOUND],
    ] as const) {
      const db = await sessionOf(person)
      expectRefusal(
        await knowledgeCall(db, "knowledge_correct", {
          p_check_id: a,
          p_slot_revision: slotRevision(w.venueA, KEY),
          p_idempotency_key: randomUUID(),
          p_headline: "no",
          p_detail: null,
          p_reason: `DEV FIXTURE B03-F denied ${w.tag}`,
        }),
        mutation,
        `${person.name} correct`
      )
      expectRefusal(
        await knowledgeCall(db, "knowledge_withdraw", {
          p_check_id: a,
          p_slot_revision: slotRevision(w.venueA, KEY),
          p_idempotency_key: randomUUID(),
          p_reason: `DEV FIXTURE B03-F denied ${w.tag}`,
        }),
        mutation,
        `${person.name} withdraw`
      )
      const read = await knowledgeCall(db, "knowledge_slot_history", {
        p_check_id: a,
        p_at: new Date().toISOString(),
      })
      if (historyRead === null)
        expect(read.error, `${person.name} history`).toBeNull()
      else {
        expectRefusal(read, historyRead, `${person.name} history`)
        expect(JSON.stringify(read.data ?? null)).not.toContain(video)
      }
    }
    expect(slotRead(w.venueA, a), "denied attempts change nothing").toEqual(
      quiet
    )

    // ---- 2. Manager correction at 1280: What changes, then a held save.
    await manager.goto(MANAGER.check(a))
    await settled(manager)
    await whereItStands(manager)
      .getByRole("link", { name: CORRECT_COPY.open })
      .click()
    await expect(manager).toHaveURL(/\/capture\?correct=1$/)
    const correction = manager.getByRole("form", { name: CORRECT_COPY.open })
    await correction
      .getByRole("radio", { name: ANSWER_LABEL.no, exact: true })
      .check()
    // The valid No: the venue's one listed entrance has steps (UI §3.3).
    await correction
      .getByRole("group", { name: ENTRANCE, exact: true })
      .getByRole("radio", { name: ACCESS_COPY.entranceValue.no, exact: true })
      .check()
    const why = correction.getByLabel(`${CORRECT_COPY.why} (required)`)
    await why.fill(CORRECTION_REASON)
    const changes = correction.getByRole("region", {
      name: CORRECT_COPY.whatChanges,
    })
    // The answer, and the entrances the Yes was sent without.
    await expect(changes.getByRole("listitem")).toHaveCount(2)
    const answerRow = changes
      .getByRole("listitem")
      .filter({ hasText: /^Answer · / })
    await expect(answerRow).toContainText(`Answer · ${CORRECT_COPY.material}`)
    await expect(answerRow).toContainText(
      `${CORRECT_COPY.before}: ${ANSWER_LABEL.yes}`
    )
    await expect(answerRow).toContainText(
      `${CORRECT_COPY.after}: ${ANSWER_LABEL.no}`
    )
    const entranceRow = changes
      .getByRole("listitem")
      .filter({ hasText: /^Entrances/ })
    await expect(entranceRow).toContainText(
      `${CORRECT_COPY.before}: Not recorded`
    )
    await expect(entranceRow).toContainText(
      `${CORRECT_COPY.after}: a place at the venue`
    )
    await expect(
      changes.getByText(CORRECT_COPY.materialLine, { exact: true })
    ).toBeVisible()

    const beforeCorrection = slotRead(w.venueA, a)
    const heldCorrection = await holdServerAction(manager, (body) =>
      body.includes(CORRECTION_REASON)
    )
    const save = correction.getByRole("button", { name: CORRECT_COPY.save })
    // Released and passed on even if a pending assertion fails.
    try {
      await save.click()
      await heldCorrection.arrived
      await expect(save).toBeDisabled()
      await expect(save).toHaveAttribute("aria-busy", "true")
      await expect(
        correction.getByRole("radio", { name: ANSWER_LABEL.no, exact: true })
      ).toBeDisabled()
      await expect(why).toBeDisabled()
      expect(slotRead(w.venueA, a), "nothing saved while held").toEqual(
        beforeCorrection
      )
    } finally {
      await heldCorrection.settle()
    }
    const done = manager
      .getByRole("status")
      .filter({ hasText: CORRECT_COPY.doneMaterial })
    await expect(
      manager.getByText(CORRECT_COPY.doneMaterial, { exact: true })
    ).toBeVisible()
    // The completion panel's link, which follows its notice; the page's own
    // "Back to the check" breadcrumb sits above the form.
    const back = done.locator(
      "xpath=following::a[normalize-space(.)='Back to the check'][1]"
    )
    await expect(back).toBeVisible()
    // The saved form is gone: focus must land somewhere usable, not the body.
    // This is the app's own focus, before the test moves it anywhere.
    await expect
      .soft(manager.locator("body"), "focus after the correction is saved")
      .not.toBeFocused()
    expect(heldCorrection.count(), "one correction request").toBe(1)

    await expect
      .poll(
        () =>
          slotRead(w.venueA, a).decisions.filter(
            (d) => d.decision === "corrected"
          ).length
      )
      .toBe(1)
    const corrected = slotRead(w.venueA, a)
    const correctionRow = corrected.decisions.find(
      (d) => d.decision === "corrected"
    )!
    expect(correctionRow).toMatchObject({
      decidedBy: w.managerA.id,
      basis: "venue_manager",
      detail: {
        before: { headline: "yes" },
        after: {
          headline: "no",
          detail: { entrances: [{ subjectId: entranceId, stepFree: "no" }] },
        },
        material: true,
        selectionRule: "correction",
      },
    })
    expect(corrected.currentAnswer).toBe("no")
    expect(corrected.currentSubmissionId).not.toBe(first.currentSubmissionId)
    expect(
      corrected.decisions.filter(
        (d) =>
          d.decision === "confirmed" &&
          d.submissionId === corrected.currentSubmissionId
      ),
      "a material correction waits for confirmation"
    ).toEqual([])
    // Headline-only: the material path adds a submission, never an overlay.
    expect(detailCorrections(w.venueA, a)).toBe(0)

    // Keyboard activation of Back. The test places focus itself here, so this
    // proves the link works from the keyboard, not that the app restored focus.
    await back.focus()
    await manager.keyboard.press("Enter")
    await expect(manager).toHaveURL(new RegExp(`${MANAGER.check(a)}(\\?|$)`))
    await expect(whereItStands(manager)).toContainText(
      `Recorded answer: ${ANSWER_LABEL.no}. Awaiting confirmation.`
    )
    await expect(
      toConfirm(manager).getByRole("heading", {
        name: "Answer in use, not confirmed",
      })
    ).toBeVisible()

    // ---- 3. Admin confirms the corrected answer through the To confirm card.
    await admin.goto(ADMIN.check(a))
    await settled(admin)
    const unconfirmed = toConfirm(admin)
      .getByRole("article")
      .filter({
        has: admin.getByRole("heading", {
          name: "Answer in use, not confirmed",
        }),
      })
    await unconfirmed
      .getByRole("button", { name: "Confirm", exact: true })
      .click()
    await expect(
      toConfirm(admin).getByText(
        `Confirmed. This is now the answer for ${w.venueA.name}.`,
        { exact: true }
      )
    ).toBeVisible()
    await expect
      .poll(
        () =>
          slotRead(w.venueA, a).decisions.filter(
            (d) =>
              d.decision === "confirmed" &&
              d.submissionId === corrected.currentSubmissionId
          ).length
      )
      .toBe(1)
    const reconfirmed = slotRead(w.venueA, a).decisions.find(
      (d) =>
        d.decision === "confirmed" &&
        d.submissionId === corrected.currentSubmissionId
    )!
    expect(reconfirmed).toMatchObject({ decidedBy: w.admin.id, basis: "admin" })

    // ---- 4. Admin withdraws, with the real response held.
    await admin.goto(ADMIN.check(a))
    await settled(admin)
    await expect(whereItStands(admin)).toContainText(
      `Current answer: ${ANSWER_LABEL.no}.`
    )
    await whereItStands(admin)
      .getByRole("button", { name: WITHDRAW_COPY.open })
      .click()
    const dialog = admin.getByRole("dialog", { name: WITHDRAW_COPY.title })
    await expect(dialog).toContainText(WITHDRAW_COPY.body(ANSWER_LABEL.no))
    const reason = dialog.getByLabel(WITHDRAW_COPY.why, { exact: true })
    await reason.fill(WITHDRAW_REASON)
    const beforeWithdraw = slotRead(w.venueA, a)
    const heldWithdraw = await holdServerAction(admin, (body) =>
      body.includes(WITHDRAW_REASON)
    )
    // Released and passed on even if a pending assertion fails.
    try {
      await dialog.getByRole("button", { name: WITHDRAW_COPY.confirm }).click()
      await heldWithdraw.arrived
      const withdrawing = dialog.getByRole("button", {
        name: WITHDRAW_COPY.pending,
      })
      await expect(withdrawing).toBeDisabled()
      await expect(withdrawing).toHaveAttribute("aria-busy", "true")
      await expect(
        dialog.getByRole("button", { name: "Cancel" })
      ).toBeDisabled()
      await expect(reason).toBeDisabled()
      expect(slotRead(w.venueA, a), "nothing withdrawn while held").toEqual(
        beforeWithdraw
      )
    } finally {
      await heldWithdraw.settle()
    }
    await expect(dialog).toBeHidden()
    // WithdrawControl's declared focus target is Where it stands' heading.
    await expect
      .soft(admin.locator("#amenity-status-title"), "focus after withdrawal")
      .toBeFocused()
    await expect
      .poll(
        () =>
          slotRead(w.venueA, a).decisions.filter(
            (d) => d.decision === "withdrawn"
          ).length
      )
      .toBe(1)
    expect(heldWithdraw.count(), "one withdrawal request").toBe(1)
    const withdrawnSlot = slotRead(w.venueA, a)
    const withdrawal = withdrawnSlot.decisions.find(
      (d) => d.decision === "withdrawn"
    )!
    expect(withdrawal).toMatchObject({ decidedBy: w.admin.id, basis: "admin" })
    // A withdrawal is a decision only: the stored answer stays as it was.
    expect(withdrawnSlot.currentSubmissionId).toBe(
      beforeWithdraw.currentSubmissionId
    )
    expect(withdrawnSlot.revision).toBe(beforeWithdraw.revision)

    const withdrawnLine = `Withdrawn by an admin on ${longDate(withdrawal.at)}.`
    await expect(whereItStands(admin)).toContainText(withdrawnLine)
    await expect(whereItStands(admin)).toContainText(
      `Previous answer: ${ANSWER_LABEL.no}.`
    )
    await expect(
      whereItStands(admin).getByRole("button", { name: WITHDRAW_COPY.open })
    ).toHaveCount(0)
    await expect(
      whereItStands(admin).getByRole("link", { name: CORRECT_COPY.open })
    ).toHaveCount(0)

    // ---- 5. History: who (and in what role) did what, and when.
    await manager.goto(MANAGER.check(a))
    await settled(manager)
    await expect(whereItStands(manager)).toContainText(withdrawnLine)
    const line = (page: Page, text: string, at: string) =>
      history(page)
        .getByRole("listitem")
        .filter({ hasText: text })
        .filter({ hasText: dateAndTime(at) })
    // The first confirmation adopted the finding too, so its line may read
    // "In use. Confirmed by …"; the later lines carry the actor's role.
    await expect(
      line(
        manager,
        `Confirmed by ${w.managerA.name}`,
        firstConfirmed.at
      ).first()
    ).toBeVisible()
    for (const [text, at] of [
      [
        `Corrected by ${w.managerA.name} (venue manager): ${ANSWER_LABEL.yes} → ${ANSWER_LABEL.no}. Needs confirming again.`,
        correctionRow.at,
      ],
      [`Confirmed by ${w.admin.name} (admin).`, reconfirmed.at],
      [`Withdrawn by ${w.admin.name} (admin).`, withdrawal.at],
    ] as const)
      await expect(line(manager, text, at), text).toHaveCount(1)

    // ---- 6. Answer on a date: the earlier Yes, then the withdrawn No.
    const earlier = secondAfter(firstConfirmed.at)
    expect(Date.parse(earlier)).toBeLessThan(Date.parse(correctionRow.at))
    const later = secondAfter(withdrawal.at)
    for (const page of [manager, legacy]) {
      if (page === legacy) {
        await legacy.goto(LEGACY_MANAGE.check(a))
        await settled(page)
      }
      const then = await answerOn(page, earlier)
      await expect(
        atDate(page).getByText(AT_DATE_COPY.was(then, ANSWER_LABEL.yes), {
          exact: true,
        })
      ).toBeVisible()
      await expect(
        atDate(page).getByText(AT_DATE_COPY.confirmed, { exact: true })
      ).toBeVisible()
    }
    const now = await answerOn(manager, later)
    await expect(
      atDate(manager).getByText(AT_DATE_COPY.was(now, ANSWER_LABEL.no), {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      atDate(manager).getByText(AT_DATE_COPY.withdrawn, { exact: true })
    ).toBeVisible()
    // The same instant read in the manager's own session.
    const snapshot = await knowledgeOk<{
      answerInUse: { answer: string; confirmationState: string } | null
    }>(await sessionOf(w.managerA), "knowledge_slot_history", {
      p_check_id: a,
      p_at: earlier,
    })
    expect(snapshot.answerInUse).toMatchObject({
      answer: "yes",
      confirmationState: "confirmed",
    })

    // ---- 7. Staff read at 390 and the legacy list fallback agree.
    await staff.goto(staffCaptureHref(a))
    await settled(staff)
    await expect(
      staff.getByText(`${withdrawnLine} Previous answer: ${ANSWER_LABEL.no}.`, {
        exact: true,
      })
    ).toBeVisible()
    await expect(history(staff)).toHaveCount(0)
    await expect(atDate(staff)).toHaveCount(0)
    await expectNone(
      staff,
      [NOTE, CORRECTION_REASON, WITHDRAW_REASON, w.admin.name, B_REASON],
      "staff 390 after withdrawal"
    )
    await manager.goto(MANAGER.list)
    await settled(manager)
    await expect(
      checkItem(manager.getByRole("main"), KEY)
        .filter({
          hasText: `Answer: ${LEGACY_QUALIFICATION_WORD.withdrawn}`,
        })
        .first()
    ).toBeVisible()

    // ---- 8. Still nothing for venue B's people, and venue B's answer stands.
    for (const path of [MANAGER.check(a), `${MANAGER.capture(a)}?correct=1`]) {
      await managerB.goto(path)
      // A refusal page, not settled(): notFound() thrown inside the capture
      // route's own loading boundary leaves an empty hidden placeholder
      // (S:n) that is never moved into the page.
      await expect(managerNotFound(managerB), `manager B ${path}`).toBeVisible()
      await expectNone(managerB, venueASecrets, `manager B ${path}`)
    }
    await managerB.goto(MANAGER.check(b))
    await settled(managerB)
    await expect(whereItStands(managerB)).toContainText(`${ANSWER_LABEL.no}.`)
    await expectNone(managerB, venueASecrets, "manager B own check")
    expect(slotRead(w.venueB, b), "venue B untouched").toEqual(venueBSlot)
  })
})
