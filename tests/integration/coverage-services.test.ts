// Coverage services (contracts/services.md v1) against an owned local stack,
// as real signed-in identities: every call goes through the caller's RLS and
// the coverage RPCs exactly as the Server Actions make it. The service role
// only builds fixtures (identities, venues, assets, a transfer).
import { beforeAll, describe, expect, it } from "vitest"

import {
  attachPhotos,
  confirmMenuCoverage,
  createRequirement,
  getCoverageScope,
  getGroupOverview,
  getManagerReviewCount,
  getMenuCoverage,
  getMyMonth,
  getMyTasks,
  getVenueCoverage,
  getVenueRoster,
  grantVenueManager,
  listAmenityFacts,
  listGrantCandidates,
  listManagerGrants,
  listMySubmittablePhotos,
  listPreparationRuns,
  listReviewQueue,
  listSelfReviews,
  prepareMonth,
  reconcileMenuRequirement,
  reviewSubmission,
  revokeVenueManager,
  runScheduledPreparation,
  setAmenityFact,
  setMonthlyTarget,
  setRequirementAssignees,
  setRequirementStatus,
  signEvidence,
  startMenuCoverage,
  submitPhotos,
  updateRequirement,
} from "@/lib/server/coverage"
import { coverageRpcFailure } from "@/lib/server/coverage/errors"
import { periodKeyOf, shiftPeriod } from "@/lib/server/coverage/time"
import type { CoverageResult, MyAssignment } from "@/lib/server/coverage/types"
import type { MediaActor } from "@/lib/server/media/types"

import { seedAsset } from "../library/seed"
import {
  insertAsset,
  legacyStaffGrant,
  makeManager,
  monthOffset,
} from "../security/coverage-fixtures"
import { item, menu, publishMenu, section } from "../security/menus-fixtures"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

const key = () => crypto.randomUUID()

function okOf<T extends object>(result: CoverageResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result
}

describe("coverage services", () => {
  const service = serviceClient()
  const thisMonth = periodKeyOf(new Date())
  let venueA: string
  let venueB: string
  let admin: TestIdentity
  let manager: TestIdentity
  let staff1: TestIdentity
  let staff2: TestIdentity
  let other: TestIdentity
  const actors = {} as Record<
    "admin" | "manager" | "staff1" | "staff2" | "other",
    MediaActor
  >
  let requirementId: string
  let assetA1: string

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      createVenue(service, "coverage-svc-a"),
      createVenue(service, "coverage-svc-b"),
    ])
    venueA = a.id
    venueB = b.id
    ;[admin, manager, staff1, staff2, other] = await Promise.all([
      createIdentity(service, { label: "cov-admin", role: "admin" }),
      createIdentity(service, {
        label: "cov-manager",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "cov-staff1",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "cov-staff2",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "cov-other",
        role: "staff",
        venueId: venueB,
      }),
    ])
    const team = await service
      .from("profiles")
      .update({ department: "foh" })
      .in("id", [manager.id, staff1.id, staff2.id, other.id])
    if (team.error) throw team.error
    // A staff-held grant (pre-manager-account): the legacy coverage tools.
    await legacyStaffGrant(service, admin, manager.id, venueA)
    actors.admin = await actorFor(admin)
    actors.manager = await actorFor(manager)
    actors.staff1 = await actorFor(staff1)
    actors.staff2 = await actorFor(staff2)
    actors.other = await actorFor(other)
    assetA1 = (
      await seedAsset(service, {
        uploaderId: staff1.id,
        venueId: venueA,
        derivatives: true,
      })
    ).id
  })

  it("derives scope from the database for each role", async () => {
    const staff = okOf(await getCoverageScope(actors.staff1)).scope
    expect(staff).toMatchObject({
      role: "staff",
      canSubmit: true,
      canManageVenue: false,
      managedVenue: null,
      setup: { complete: true, missing: [] },
    })
    expect(staff.venue?.id).toBe(venueA)
    const mgr = okOf(await getCoverageScope(actors.manager)).scope
    expect(mgr.managedVenue?.id).toBe(venueA)
    expect(mgr.canManageVenue).toBe(true)
    const adm = okOf(await getCoverageScope(actors.admin)).scope
    expect(adm).toMatchObject({
      role: "admin",
      canManageGrants: true,
      canSubmit: false,
    })
  })

  it("checks the venue: staff refused, managers held to their venue, admins must choose", async () => {
    expect(await getVenueCoverage(actors.staff1, {})).toMatchObject({
      code: "not_permitted",
    })
    expect(
      await getVenueCoverage(actors.manager, { venueId: venueB })
    ).toMatchObject({
      code: "wrong_venue",
    })
    expect(await getVenueCoverage(actors.admin, {})).toMatchObject({
      code: "invalid_input",
      fieldErrors: { venueId: expect.any(String) },
    })
    const coverage = okOf(await getVenueCoverage(actors.manager, {})).coverage
    expect(coverage.summary.venue.id).toBe(venueA)
    expect(
      okOf(await getVenueCoverage(actors.admin, { venueId: venueA })).coverage
        .summary.venue.id
    ).toBe(venueA)
  })

  it("lets only assigned staff submit to a task, skipping ineligible photos (D3)", async () => {
    const createInput = {
      requestId: key(),
      kind: "venue_specific",
      title: "TEST Bar back",
      photoTarget: 1,
    }
    const created = okOf(await createRequirement(actors.manager, createInput))
    expect(created.replayed).toBe(false)
    requirementId = created.requirementId
    // A retried create returns the same task instead of adding another.
    expect(
      okOf(await createRequirement(actors.manager, createInput))
    ).toMatchObject({
      requirementId,
      replayed: true,
    })
    expect(
      await createRequirement(actors.manager, {
        ...createInput,
        title: "TEST Other",
      })
    ).toMatchObject({ code: "state_conflict" })
    expect(
      await createRequirement(actors.manager, {
        ...createInput,
        requestId: undefined,
      })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { requestId: expect.any(String) },
    })
    okOf(
      await setRequirementAssignees(actors.manager, {
        requirementId,
        assigneeIds: [staff1.id],
      })
    )

    const tasks = okOf(await getMyTasks(actors.staff1)).tasks
    const mine = tasks.assignments.find(
      (a) => a.requirement.id === requirementId
    )
    expect(mine).toMatchObject({ assigned: true, canSubmit: true })

    const asset2 = (
      await seedAsset(service, { uploaderId: staff2.id, venueId: venueA })
    ).id
    expect(
      await submitPhotos(actors.staff2, {
        requestId: key(),
        requirementId,
        assetIds: [asset2],
      })
    ).toMatchObject({ code: "not_permitted" })

    const requestId = key()
    const first = okOf(
      await submitPhotos(actors.staff1, {
        requestId,
        requirementId,
        assetIds: [assetA1, asset2],
      })
    )
    expect(first.submitted).toHaveLength(1)
    expect(first.submitted[0]).toMatchObject({
      assetId: assetA1,
      state: "submitted",
      reused: false,
    })
    expect(first.skipped).toEqual([{ assetId: asset2, reason: "not_found" }])
    expect(first.replayed).toBe(false)

    const retry = okOf(
      await submitPhotos(actors.staff1, {
        requestId,
        requirementId,
        assetIds: [assetA1, asset2],
      })
    )
    expect(retry.replayed).toBe(true)
    expect(retry.submitted[0]!.submissionId).toBe(
      first.submitted[0]!.submissionId
    )
    expect(
      await submitPhotos(actors.staff1, {
        requestId,
        requirementId: null,
        assetIds: [assetA1],
      })
    ).toMatchObject({ code: "state_conflict" })

    const picker = okOf(
      await listMySubmittablePhotos(actors.staff1, { requirementId })
    )
    expect(picker.items.find((p) => p.assetId === assetA1)).toMatchObject({
      eligible: false,
      reason: "already_submitted",
    })
  })

  it("makes one task from concurrent creates with one key and reports the rest as replays", async () => {
    const input = {
      requestId: key(),
      kind: "service",
      title: "TEST Patio",
      photoTarget: 1,
    }
    const results = (
      await Promise.all(
        [1, 2, 3].map(() => createRequirement(actors.manager, input))
      )
    ).map((r) => okOf(r))
    expect(new Set(results.map((r) => r.requirementId)).size).toBe(1)
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true, true])
  })

  it("reports concurrent submit and attach retries with one key as replays", async () => {
    const thrice = <T extends object>(call: () => Promise<CoverageResult<T>>) =>
      Promise.all([1, 2, 3].map(call)).then((all) => all.map((r) => okOf(r)))

    const own = (
      await seedAsset(service, { uploaderId: staff1.id, venueId: venueA })
    ).id
    const submit = { requestId: key(), requirementId, assetIds: [own] }
    const sent = await thrice(() => submitPhotos(actors.staff1, submit))
    expect(new Set(sent.map((r) => r.submitted[0]!.submissionId)).size).toBe(1)
    expect(sent.map((r) => r.replayed).sort()).toEqual([false, true, true])

    const colleague = (
      await seedAsset(service, { uploaderId: staff2.id, venueId: venueA })
    ).id
    const attach = { requestId: key(), requirementId, assetIds: [colleague] }
    const attached = await thrice(() => attachPhotos(actors.manager, attach))
    expect(
      new Set(attached.map((r) => r.submitted[0]!.submissionId)).size
    ).toBe(1)
    expect(attached.map((r) => r.replayed).sort()).toEqual([false, true, true])
  })

  it("refuses a monthly-only photo uploaded in an earlier month", async () => {
    const old = await insertAsset(service, {
      uploader: staff1.id,
      venue: venueA,
      createdAt: `${monthOffset(-1).slice(0, 8)}15T12:00:00Z`,
    })
    expect(
      await submitPhotos(actors.staff1, {
        requestId: key(),
        requirementId: null,
        assetIds: [old.id],
      })
    ).toMatchObject({
      code: "asset_ineligible",
      assetErrors: [{ assetId: old.id, reason: "outside_period" }],
    })
    // A direct call is refused by the database too, and maps the same way.
    const direct = await actors.staff1.db.rpc("submit_coverage_photos", {
      p_asset_ids: [old.id],
      p_client_request_key: key(),
    })
    expect(direct.data).toBeNull()
    expect(
      coverageRpcFailure(direct.error, "submit photos", [old.id])
    ).toMatchObject({
      code: "asset_ineligible",
      assetErrors: [{ assetId: old.id, reason: "outside_period" }],
    })
  })

  it("counts the manager's photos to review and refuses everyone else", async () => {
    const queue = okOf(await listReviewQueue(actors.manager, {}))
    expect(queue.nextCursor).toBeNull()
    expect(okOf(await getManagerReviewCount(actors.manager)).count).toBe(
      queue.items.length
    )
    expect(queue.items.length).toBeGreaterThan(0)
    expect(await getManagerReviewCount(actors.staff1)).toMatchObject({
      ok: false,
      code: "not_permitted",
    })
    expect(await getManagerReviewCount(actors.admin)).toMatchObject({
      ok: false,
      code: "invalid_input",
    })
  })

  it("reviews with revisions; decisions are final (D4) and replays write nothing", async () => {
    const queue = okOf(await listReviewQueue(actors.manager, {}))
    const item = queue.items.find((i) => i.asset.id === assetA1)!
    expect(item).toMatchObject({
      state: "submitted",
      origin: "submitted",
      countsTowardMonthly: true,
      author: { id: staff1.id },
    })
    expect(item.asset.thumbnailUrl).toBe(
      `/api/coverage/evidence/${assetA1}/thumb`
    )

    const stale = await reviewSubmission(actors.manager, {
      requestId: key(),
      submissionId: item.id,
      expectedRevision: item.revision + 1,
      decision: "accept",
    })
    expect(stale).toMatchObject({
      code: "revision_conflict",
      currentRevision: item.revision,
    })
    expect(
      await reviewSubmission(actors.staff2, {
        requestId: key(),
        submissionId: item.id,
        expectedRevision: item.revision,
        decision: "accept",
      })
    ).toMatchObject({ code: "not_found" })
    expect(
      await reviewSubmission(actors.manager, {
        requestId: key(),
        submissionId: item.id,
        expectedRevision: item.revision,
        decision: "needs_another_photo",
      })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { reason: expect.any(String) },
    })

    const requestId = key()
    const accepted = okOf(
      await reviewSubmission(actors.manager, {
        requestId,
        submissionId: item.id,
        expectedRevision: item.revision,
        decision: "accept",
      })
    )
    expect(accepted).toMatchObject({
      replayed: false,
      submission: { state: "accepted", selfReview: false },
    })
    const replay = okOf(
      await reviewSubmission(actors.manager, {
        requestId,
        submissionId: item.id,
        expectedRevision: item.revision,
        decision: "accept",
      })
    )
    expect(replay.replayed).toBe(true)
    const revision = accepted.submission.revision
    expect(
      okOf(
        await reviewSubmission(actors.manager, {
          requestId: key(),
          submissionId: item.id,
          expectedRevision: revision,
          decision: "accept",
        })
      ).replayed
    ).toBe(true)
    expect(
      await reviewSubmission(actors.manager, {
        requestId: key(),
        submissionId: item.id,
        expectedRevision: revision,
        decision: "needs_another_photo",
        reason: "Too dark",
      })
    ).toMatchObject({ code: "state_conflict" })
  })

  it("credits the monthly target and shows narrow roster rows", async () => {
    expect(
      await setMonthlyTarget(actors.manager, {
        staffId: staff1.id,
        period: shiftPeriod(thisMonth, -1),
        targetCount: 3,
        expectedRevision: null,
      })
    ).toMatchObject({ code: "not_permitted" })
    const set = okOf(
      await setMonthlyTarget(actors.manager, {
        staffId: staff1.id,
        period: thisMonth,
        targetCount: 1,
        expectedRevision: null,
      })
    )
    expect(
      await setMonthlyTarget(actors.manager, {
        staffId: staff1.id,
        period: thisMonth,
        targetCount: 2,
        expectedRevision: set.revision,
      })
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { reason: expect.any(String) },
    })

    const monthly = okOf(await getMyTasks(actors.staff1)).tasks.monthly!
    expect(monthly).toMatchObject({
      status: "set",
      targetCount: 1,
      accepted: 1,
      complete: true,
      venue: { id: venueA },
    })
    expect(monthly.period.key).toBe(thisMonth)
    const month = okOf(
      await getMyMonth(actors.staff1, { period: thisMonth })
    ).month
    expect(
      month.submissions.some(
        (s) => s.asset.id === assetA1 && s.state === "accepted"
      )
    ).toBe(true)

    const roster = okOf(await getVenueRoster(actors.manager, {}))
    const row = roster.roster.find((r) => r.person.id === staff1.id)!
    expect(row).toMatchObject({
      accepted: 1,
      complete: true,
      isCurrentMember: true,
    })
    expect(JSON.stringify(roster)).not.toContain(staff1.email)
    expect(JSON.stringify(roster)).not.toMatch(/"email"/)
  })

  it("records self-review when a manager decides their own photo (D5)", async () => {
    const ownTask = okOf(
      await createRequirement(actors.manager, {
        requestId: key(),
        kind: "service",
        title: "TEST Terrace",
        photoTarget: 1,
      })
    ).requirementId
    okOf(
      await setRequirementAssignees(actors.manager, {
        requirementId: ownTask,
        assigneeIds: [manager.id],
      })
    )
    const asset = (
      await seedAsset(service, { uploaderId: manager.id, venueId: venueA })
    ).id
    const sent = okOf(
      await submitPhotos(actors.manager, {
        requestId: key(),
        requirementId: ownTask,
        assetIds: [asset],
      })
    ).submitted[0]!
    const decided = okOf(
      await reviewSubmission(actors.manager, {
        requestId: key(),
        submissionId: sent.submissionId,
        expectedRevision: sent.revision,
        decision: "accept",
      })
    )
    expect(decided.submission.selfReview).toBe(true)
    const reviews = okOf(
      await listSelfReviews(actors.admin, { venueId: venueA })
    )
    expect(
      reviews.items.find((r) => r.submissionId === sent.submissionId)
    ).toMatchObject({
      author: { id: manager.id },
      decision: "accept",
    })
    expect(await listSelfReviews(actors.manager, {})).toMatchObject({
      code: "not_permitted",
    })
  })

  it("attaches a colleague's photo as coverage only, never monthly credit (D1)", async () => {
    const asset = (
      await seedAsset(service, { uploaderId: staff2.id, venueId: venueA })
    ).id
    const attached = okOf(
      await attachPhotos(actors.manager, {
        requestId: key(),
        requirementId,
        assetIds: [asset],
        acceptNow: true,
      })
    )
    expect(attached.submitted[0]).toMatchObject({
      assetId: asset,
      state: "accepted",
    })
    const accepted = okOf(
      await listReviewQueue(actors.manager, {
        state: "accepted",
        requirementId,
      })
    )
    expect(accepted.items.find((i) => i.asset.id === asset)).toMatchObject({
      origin: "attached",
      countsTowardMonthly: false,
      author: { id: staff2.id },
    })
    const elsewhere = (
      await seedAsset(service, { uploaderId: other.id, venueId: venueB })
    ).id
    expect(
      await attachPhotos(actors.manager, {
        requestId: key(),
        requirementId,
        assetIds: [elsewhere],
      })
    ).toMatchObject({ code: "asset_ineligible" })
    expect(
      await attachPhotos(actors.manager, {
        venueId: venueB,
        requestId: key(),
        requirementId,
        assetIds: [asset],
      })
    ).toMatchObject({ code: "wrong_venue" })
  })

  it("signs task evidence only for its author, the venue's manager and admins", async () => {
    for (const who of ["staff1", "manager", "admin"] as const) {
      const signed = await signEvidence(actors[who], assetA1, "thumbnail")
      expect(signed.ok, who).toBe(true)
    }
    const signed = await signEvidence(actors.staff1, assetA1, "preview")
    if (!signed.ok) throw new Error(signed.message)
    expect((await fetch(signed.url)).status).toBe(200)
    for (const who of ["staff2", "other"] as const) {
      expect(
        await signEvidence(actors[who], assetA1, "thumbnail"),
        who
      ).toMatchObject({ status: 404 })
    }
    const unsubmitted = (
      await seedAsset(service, {
        uploaderId: staff1.id,
        venueId: venueA,
        derivatives: true,
      })
    ).id
    expect(
      await signEvidence(actors.manager, unsubmitted, "thumbnail")
    ).toMatchObject({ status: 404 })
  })

  it("prepares the month idempotently, adding the checklist once (D9)", async () => {
    const first = okOf(await prepareMonth(actors.manager, {})).runs[0]!
    expect(first).toMatchObject({
      status: "succeeded",
      venueId: venueA,
      trigger: "manual",
    })
    expect(first.candidatesAdded).toBeGreaterThan(0)
    const second = okOf(await prepareMonth(actors.manager, {})).runs[0]!
    expect(second).toMatchObject({
      status: "succeeded",
      candidatesAdded: 0,
      targetsCopied: 0,
      placeholdersCreated: 0,
    })
    expect(await prepareMonth(actors.staff1, {})).toMatchObject({
      code: "not_permitted",
    })
    const scheduled = await runScheduledPreparation(serviceClient())
    expect(scheduled).toMatchObject({ ok: true, failed: false })
    const runs = okOf(
      await listPreparationRuns(actors.admin, { venueId: venueA })
    )
    expect(runs.items.length).toBeGreaterThanOrEqual(3)
  })

  it("needs a confirmed present fact before an amenity task is active (D7)", async () => {
    const facts = okOf(await listAmenityFacts(actors.manager, {})).facts
    expect(facts.length).toBe(7)
    expect(facts.every((f) => f.presence === "unknown" && !f.confirmed)).toBe(
      true
    )
    const toilets = facts.find((f) => f.templateKey === "toilets")!
    const coverage = okOf(await getVenueCoverage(actors.manager, {})).coverage
    const task = coverage.requirements.find((r) => r.templateKey === "toilets")!
    expect(task.setupIssues).toEqual(
      expect.arrayContaining(["unconfirmed", "fact_unknown"])
    )
    expect(
      await setRequirementStatus(actors.manager, {
        requirementId: task.id,
        expectedRevision: task.revision,
        status: "active",
      })
    ).toMatchObject({ code: "needs_setup" })
    expect(
      await setAmenityFact(actors.manager, {
        templateKey: "toilets",
        expectedRevision: toilets.revision,
        presence: "unknown",
        confirm: true,
      })
    ).toMatchObject({ code: "invalid_input" })
    okOf(
      await setAmenityFact(actors.manager, {
        templateKey: "toilets",
        expectedRevision: toilets.revision,
        presence: "present",
        confirm: true,
      })
    )
    okOf(
      await setRequirementStatus(actors.manager, {
        requirementId: task.id,
        expectedRevision: task.revision,
        status: "active",
      })
    )
  })

  it("rejects a stale task edit with the current revision", async () => {
    const coverage = okOf(await getVenueCoverage(actors.manager, {})).coverage
    const task = coverage.requirements.find((r) => r.id === requirementId)!
    okOf(
      await updateRequirement(actors.manager, {
        requirementId,
        expectedRevision: task.revision,
        patch: { guidance: "From the till side." },
      })
    )
    expect(
      await updateRequirement(actors.manager, {
        requirementId,
        expectedRevision: task.revision,
        patch: { title: "TEST Bar back again" },
      })
    ).toMatchObject({
      code: "revision_conflict",
      currentRevision: task.revision + 1,
    })
  })

  it("shows admins the group overview with effective managers", async () => {
    const overview = okOf(await getGroupOverview(actors.admin, {}))
    const row = overview.venues.find((v) => v.venue.id === venueA)!
    expect(row.managers.map((m) => m.id)).toContain(manager.id)
    expect(row.selfReviews).toBeGreaterThanOrEqual(1)
    expect(overview.period.key).toBe(thisMonth)
    expect(await getGroupOverview(actors.manager, {})).toMatchObject({
      code: "not_permitted",
    })
  })

  it("grants and revokes manager rights; revocation applies on the next call", async () => {
    // New grants go to venue manager accounts only; staff become managers by
    // conversion. A manager account without an open grant is a candidate.
    const cand = await createIdentity(service, {
      label: "cov-cand",
      role: "staff",
      venueId: venueA,
    })
    const converted = await makeManager(admin, cand, venueA)
    okOf(
      await revokeVenueManager(actors.admin, {
        grantId: converted,
        reason: "TEST pause",
      })
    )
    const candidates = okOf(
      await listGrantCandidates(actors.admin, { venueId: venueA })
    ).people.map((p) => p.id)
    expect(candidates).toContain(cand.id)
    expect(candidates).not.toContain(staff2.id)
    expect(candidates).not.toContain(manager.id)
    expect(
      await grantVenueManager(actors.admin, {
        staffId: other.id,
        venueId: venueA,
      })
    ).toMatchObject({ code: "state_conflict" })
    expect(
      await grantVenueManager(actors.admin, {
        staffId: staff2.id,
        venueId: venueA,
      })
    ).toMatchObject({ code: "state_conflict" })
    expect(
      await grantVenueManager(actors.manager, {
        staffId: cand.id,
        venueId: venueA,
      })
    ).toMatchObject({ code: "not_permitted" })
    okOf(
      await grantVenueManager(actors.admin, {
        staffId: cand.id,
        venueId: venueA,
      })
    )

    // A staff-held (legacy) grant still opens the legacy tools until revoked.
    const grantId = await legacyStaffGrant(service, admin, staff2.id, venueA)
    expect(
      okOf(await getVenueCoverage(actors.staff2, {})).coverage.summary.venue.id
    ).toBe(venueA)
    okOf(
      await revokeVenueManager(actors.admin, {
        grantId,
        reason: "TEST cover ended",
      })
    )
    expect(await getVenueCoverage(actors.staff2, {})).toMatchObject({
      code: "not_permitted",
    })
  })

  it("gives a manager account no legacy coverage tools", async () => {
    const acct = await createIdentity(service, {
      label: "cov-mgr-account",
      role: "staff",
      venueId: venueA,
    })
    await makeManager(admin, acct, venueA)
    const actor = await actorFor(acct)
    const scope = okOf(await getCoverageScope(actor)).scope
    expect(scope).toMatchObject({
      role: "manager",
      managedVenue: null,
      canManageVenue: false,
      canSubmit: false,
    })
    expect(await getVenueCoverage(actor, {})).toMatchObject({
      code: "not_permitted",
    })
    expect(await getManagerReviewCount(actor)).toMatchObject({
      code: "not_permitted",
    })
  })

  it("drops manager rights when the manager moves venue", async () => {
    const moved = await service
      .from("profiles")
      .update({ venue_id: venueB })
      .eq("id", manager.id)
    if (moved.error) throw moved.error
    expect(await getVenueCoverage(actors.manager, {})).toMatchObject({
      code: "not_permitted",
    })
    expect(
      await getVenueCoverage(actors.manager, { venueId: venueB })
    ).toMatchObject({
      code: "not_permitted",
    })
    const grants = okOf(
      await listManagerGrants(actors.admin, {
        venueId: venueA,
        includeRevoked: true,
      })
    )
    expect(grants.grants.find((g) => g.staff.id === manager.id)).toMatchObject({
      effective: false,
      revokeKind: "venue_changed",
      revokedByName: null,
    })
  })
})

describe("menu coverage plan", () => {
  const service = serviceClient()

  /** Starts and confirms a plan for the active version: `keep` sections active, the rest excluded. */
  async function planActiveMenu(
    actor: MediaActor,
    versionId: string,
    keep: string[]
  ) {
    const started = okOf(
      await startMenuCoverage(actor, { menuVersionId: versionId })
    )
    expect(
      okOf(await startMenuCoverage(actor, { menuVersionId: versionId })).planId
    ).toBe(started.planId)
    const draft = okOf(await getMenuCoverage(actor, {})).menu
    expect(draft.draftPlan?.id).toBe(started.planId)
    expect(draft.draft).toHaveLength(draft.activeVersion!.sections.length)
    expect(
      draft.draft.every((r) => r.status === "needs_setup" && r.menuSection)
    ).toBe(true)
    expect(
      await confirmMenuCoverage(actor, {
        planId: started.planId,
        expectedRevision: draft.draftPlan!.revision,
      })
    ).toMatchObject({ code: "needs_setup" })
    for (const r of draft.draft) {
      okOf(
        await setRequirementStatus(actor, {
          requirementId: r.id,
          expectedRevision: r.revision,
          ...(keep.includes(r.menuSection!.sectionSlug ?? "")
            ? { status: "active" as const }
            : {
                status: "not_applicable" as const,
                reason: "TEST not photographed this season",
              }),
        })
      )
    }
    const confirmed = okOf(
      await confirmMenuCoverage(actor, {
        planId: started.planId,
        expectedRevision: draft.draftPlan!.revision,
      })
    )
    expect(confirmed.planId).toBe(started.planId)
    return confirmed
  }

  it("plans each active menu by section and reconciles evidence explicitly after a change", async () => {
    const venueId = (await createVenue(service, "coverage-menu")).id
    const admin = await createIdentity(service, {
      label: "cov-menu-admin",
      role: "admin",
    })
    const mgr = await createIdentity(service, {
      label: "cov-menu-mgr",
      role: "staff",
      venueId,
    })
    const cook = await createIdentity(service, {
      label: "cov-menu-cook",
      role: "staff",
      venueId,
    })
    await legacyStaffGrant(service, admin, mgr.id, venueId)
    const actor = await actorFor(mgr)

    expect(okOf(await getMenuCoverage(actor, {})).menu.menuState).toBe(
      "no_menu"
    )
    const v1 = await publishMenu(
      admin,
      venueId,
      menu("TEST Autumn", [
        section("starters", "Starters", [item("soup", "Soup")]),
        section("mains", "Mains", [item("pie", "Pie")]),
      ])
    )
    expect(okOf(await getMenuCoverage(actor, {})).menu).toMatchObject({
      menuState: "needs_setup",
      activeVersion: { id: v1 },
    })
    const first = await planActiveMenu(actor, v1, ["starters"])
    expect(first).toMatchObject({ reconciliationRequired: false })
    const planned = okOf(await getMenuCoverage(actor, {})).menu
    expect(planned.menuState).toBe("current")
    const oldStarters = planned.current.find(
      (r) => r.menuSection?.sectionSlug === "starters"
    )!

    const photo = (await seedAsset(service, { uploaderId: cook.id, venueId }))
      .id
    okOf(
      await attachPhotos(actor, {
        requestId: key(),
        requirementId: oldStarters.id,
        assetIds: [photo],
        acceptNow: true,
      })
    )

    const v2 = await publishMenu(
      admin,
      venueId,
      menu("TEST Winter", [
        section("starters", "Starters", [item("broth", "Broth")]),
        section("desserts", "Desserts", [item("crumble", "Crumble")], "food"),
      ])
    )
    expect(okOf(await getMenuCoverage(actor, {})).menu.menuState).toBe(
      "menu_changed"
    )
    const second = await planActiveMenu(actor, v2, ["starters", "desserts"])
    expect(second.reconciliationRequired).toBe(true)
    const pending = okOf(await getMenuCoverage(actor, {})).menu
    expect(pending.menuState).toBe("reconciliation_pending")
    expect(pending.superseded.map((r) => r.id)).toEqual([oldStarters.id])
    const newStarters = pending.current.find(
      (r) => r.menuSection?.sectionSlug === "starters"
    )!
    expect(newStarters.id).not.toBe(oldStarters.id)

    const reconciled = okOf(
      await reconcileMenuRequirement(actor, {
        fromRequirementId: oldStarters.id,
        toRequirementId: newStarters.id,
        submissionIds: null,
        reason: "TEST same dish photographed",
      })
    )
    expect(reconciled).toMatchObject({
      carried: 1,
      reconciliationComplete: true,
    })
    expect(okOf(await getMenuCoverage(actor, {})).menu.menuState).toBe(
      "current"
    )
    const carried = okOf(
      await listReviewQueue(actor, {
        state: "accepted",
        requirementId: newStarters.id,
      })
    ).items
    expect(
      carried.map((i) => [i.asset.id, i.origin, i.countsTowardMonthly])
    ).toEqual([[photo, "reconciled", false]])
    expect(
      await reconcileMenuRequirement(actor, {
        fromRequirementId: oldStarters.id,
        toRequirementId: null,
        submissionIds: [],
        reason: "TEST again",
      })
    ).toMatchObject({ code: "state_conflict" })
  })
})

describe("moving a replacement photo to another task", () => {
  const service = serviceClient()

  it("re-opens the request a moved photo answered and closes requests on a retired task", async () => {
    const venueId = (await createVenue(service, "coverage-move")).id
    const [admin, mgr, cook] = await Promise.all([
      createIdentity(service, { label: "cov-move-admin", role: "admin" }),
      createIdentity(service, {
        label: "cov-move-mgr",
        role: "staff",
        venueId,
      }),
      createIdentity(service, {
        label: "cov-move-cook",
        role: "staff",
        venueId,
      }),
    ])
    const team = await service
      .from("profiles")
      .update({ department: "boh" })
      .eq("id", cook.id)
    if (team.error) throw team.error
    await legacyStaffGrant(service, admin, mgr.id, venueId)
    const manager = await actorFor(mgr)
    const staff = await actorFor(cook)

    const task = async (title: string) => {
      const id = okOf(
        await createRequirement(manager, {
          requestId: key(),
          kind: "venue_specific",
          title,
          photoTarget: 3,
        })
      ).requirementId
      okOf(
        await setRequirementAssignees(manager, {
          requirementId: id,
          assigneeIds: [cook.id],
        })
      )
      return id
    }
    const taskA = await task("TEST Pass")
    const taskB = await task("TEST Walk-in")
    const photo = async () =>
      (await seedAsset(service, { uploaderId: cook.id, venueId })).id
    const send = async (
      requirementId: string,
      assetId: string,
      replacesSubmissionId?: string
    ) =>
      okOf(
        await submitPhotos(staff, {
          requestId: key(),
          requirementId,
          assetIds: [assetId],
          ...(replacesSubmissionId ? { replacesSubmissionId } : {}),
        })
      ).submitted[0]!
    const decline = async (requirementId: string) => {
      const sent = await send(requirementId, await photo())
      okOf(
        await reviewSubmission(manager, {
          requestId: key(),
          submissionId: sent.submissionId,
          expectedRevision: sent.revision,
          decision: "needs_another_photo",
          reason: "TEST too dark",
        })
      )
      return sent.submissionId
    }
    const view = async () => {
      const tasks = okOf(await getMyTasks(staff)).tasks
      const on = (id: string) =>
        tasks.assignments.find((a) => a.requirement.id === id)!
      return {
        open: tasks.needsAnotherPhoto.map((s) => s.id).sort(),
        monthly: tasks.monthly,
        a: on(taskA),
        b: on(taskB),
      }
    }
    const counts = (a: MyAssignment) => ({
      myPending: a.myPending,
      pending: a.requirement.progress.pending,
      needsAnotherPhoto: a.requirement.progress.needsAnotherPhoto,
    })

    const requestA = await decline(taskA)
    const requestB = await decline(taskB)
    expect((await view()).open).toEqual([requestA, requestB].sort())

    const first = await photo()
    const answer = await send(taskA, first, requestA)
    let now = await view()
    expect(now.open).toEqual([requestB])
    expect(counts(now.a)).toEqual({
      myPending: 1,
      pending: 1,
      needsAnotherPhoto: 0,
    })

    // Moved without naming a request: A's request opens again and the photo counts on B.
    const moved = await send(taskB, first)
    expect(moved).toMatchObject({
      submissionId: answer.submissionId,
      reused: false,
    })
    now = await view()
    expect(now.open).toEqual([requestA, requestB].sort())
    expect(counts(now.a)).toEqual({
      myPending: 0,
      pending: 0,
      needsAnotherPhoto: 1,
    })
    expect(counts(now.b)).toEqual({
      myPending: 1,
      pending: 1,
      needsAnotherPhoto: 1,
    })
    expect(
      now.b.mySubmissions.find((s) => s.id === answer.submissionId)
        ?.replacesSubmissionId
    ).toBeNull()

    // Moved naming B's request: A's opens again and B's is answered by the moved photo.
    const second = await photo()
    const again = await send(taskA, second, requestA)
    expect((await view()).open).toEqual([requestB])
    await send(taskB, second, requestB)
    now = await view()
    expect(now.open).toEqual([requestA])
    expect(counts(now.a)).toEqual({
      myPending: 0,
      pending: 0,
      needsAnotherPhoto: 1,
    })
    expect(counts(now.b)).toEqual({
      myPending: 2,
      pending: 2,
      needsAnotherPhoto: 0,
    })
    expect(
      now.b.mySubmissions.find((s) => s.id === again.submissionId)
        ?.replacesSubmissionId
    ).toBe(requestB)
    expect(now.monthly).toMatchObject({ needsAnotherPhoto: 1 })

    // Retiring A archives its items, so its request can no longer be answered.
    okOf(
      await setRequirementStatus(manager, {
        requirementId: taskA,
        expectedRevision: now.a.requirement.revision,
        status: "retired",
        reason: "TEST pass removed",
      })
    )
    const closed = okOf(await getMyTasks(staff)).tasks
    expect(closed.needsAnotherPhoto).toEqual([])
    expect(closed.assignments.map((a) => a.requirement.id)).toEqual([taskB])
    expect(closed.monthly).toMatchObject({ needsAnotherPhoto: 0 })
  })
})
