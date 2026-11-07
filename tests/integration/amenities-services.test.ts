// Amenity services against an owned local stack with the amenity migration
// (supabase/migrations/20261107120000_amenity_catalogue.sql) applied, as real
// signed-in identities: every call goes through the caller's RLS and the
// amenity RPCs exactly as the Server Actions make it. The service role only
// builds fixtures (identities, venues, assets). Managers are venue manager
// accounts (converted as an admin does), plus one staff account still holding
// a pre-manager-account grant (the transitional /staff/manage case).
import { beforeAll, describe, expect, it } from "vitest"

import type { AmenityResult } from "@/lib/amenities/contract"
import {
  addChecks,
  amenityVideo,
  archiveCheck,
  assignCheck,
  enableAmenities,
  getCheck,
  getMyAmenityTasks,
  getVenueAmenities,
  listCatalogue,
  listSubmittableAssets,
  reopenCheck,
  restoreCheck,
  setCheckNotes,
  submitFinding,
} from "@/lib/server/amenities"
import { signEvidence } from "@/lib/server/coverage/evidence"
import type { MediaActor } from "@/lib/server/media/types"

import { seedAsset } from "../library/seed"
import { legacyStaffGrant, makeManager } from "../security/coverage-fixtures"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

function okOf<T extends object>(result: AmenityResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result
}

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    new Date()
  )

describe("amenity services", () => {
  const service = serviceClient()
  let venueA: string
  let venueB: string
  let venueC: string
  let admin: TestIdentity
  let manager: TestIdentity
  let staff1: TestIdentity
  let staff2: TestIdentity
  let otherManager: TestIdentity
  let legacyManager: TestIdentity
  const actors = {} as Record<
    | "admin"
    | "manager"
    | "staff1"
    | "staff2"
    | "otherManager"
    | "legacyManager",
    MediaActor
  >
  let photo1: string
  let video1: string
  let managerPhoto: string
  let wifiCheck: { id: string; revision: number }
  let dartsId: string

  beforeAll(async () => {
    const [a, b, c] = await Promise.all([
      createVenue(service, "amenity-svc-a"),
      createVenue(service, "amenity-svc-b"),
      createVenue(service, "amenity-svc-c"),
    ])
    venueA = a.id
    venueB = b.id
    venueC = c.id
    ;[admin, manager, staff1, staff2, otherManager, legacyManager] =
      await Promise.all([
        createIdentity(service, { label: "amen-admin", role: "admin" }),
        createIdentity(service, {
          label: "amen-manager",
          role: "staff",
          venueId: venueA,
        }),
        createIdentity(service, {
          label: "amen-staff1",
          role: "staff",
          venueId: venueA,
        }),
        createIdentity(service, {
          label: "amen-staff2",
          role: "staff",
          venueId: venueA,
        }),
        createIdentity(service, {
          label: "amen-other-mgr",
          role: "staff",
          venueId: venueB,
        }),
        createIdentity(service, {
          label: "amen-legacy-mgr",
          role: "staff",
          venueId: venueC,
        }),
      ])
    const team = await service
      .from("profiles")
      .update({ department: "foh" })
      .in("id", [staff1.id, staff2.id, legacyManager.id])
    if (team.error) throw team.error
    // Venue manager accounts, converted as an admin does in the app.
    await makeManager(admin, manager, venueA)
    await makeManager(admin, otherManager, venueB)
    // A staff account still holding a grant from before manager accounts.
    await legacyStaffGrant(service, admin, legacyManager.id, venueC)
    actors.admin = await actorFor(admin)
    actors.manager = await actorFor(manager)
    actors.staff1 = await actorFor(staff1)
    actors.staff2 = await actorFor(staff2)
    actors.otherManager = await actorFor(otherManager)
    actors.legacyManager = await actorFor(legacyManager)
    expect(actors.manager.profile.role).toBe("manager")
    expect(actors.legacyManager.profile.role).toBe("staff")
    photo1 = (
      await seedAsset(service, {
        uploaderId: staff1.id,
        venueId: venueA,
        derivatives: true,
      })
    ).id
    video1 = (
      await seedAsset(service, {
        uploaderId: staff1.id,
        venueId: venueA,
        type: "video",
      })
    ).id
    managerPhoto = (
      await seedAsset(service, {
        uploaderId: manager.id,
        venueId: venueA,
        derivatives: true,
      })
    ).id
  })

  it("shows a venue as not enabled, and only an admin can enable it (idempotently)", async () => {
    const before = okOf(await getVenueAmenities(actors.manager, {})).view
    expect(before).toMatchObject({
      venue: { id: venueA },
      enabled: false,
      canEnable: false,
      active: [],
    })
    expect(
      okOf(await getVenueAmenities(actors.admin, { venueId: venueA })).view
        .canEnable
    ).toBe(true)
    // The catalogue can be previewed before enabling; adding needs it enabled.
    expect(await listCatalogue(actors.manager, {})).toMatchObject({ ok: true })
    expect(await addChecks(actors.manager, { keys: ["darts"] })).toMatchObject({
      code: "needs_setup",
    })
    expect(
      await enableAmenities(actors.manager, { venueId: venueA })
    ).toMatchObject({ code: "not_permitted" })

    expect(
      okOf(await enableAmenities(actors.admin, { venueId: venueA })).created
    ).toBe(4)
    expect(
      okOf(await enableAmenities(actors.admin, { venueId: venueA })).created
    ).toBe(0)
    const view = okOf(await getVenueAmenities(actors.manager, {})).view
    expect(view.enabled).toBe(true)
    expect(view.active.map((c) => c.entry.key).sort()).toEqual([
      "guest_toilets",
      "guest_wifi",
      "onsite_parking",
      "step_free_entrance",
    ])
    expect(view.counts).toEqual({
      needs_capture: 4,
      complete: 0,
      needs_recheck: 0,
    })
    const wifi = view.active.find((c) => c.entry.key === "guest_wifi")!
    wifiCheck = { id: wifi.id, revision: wifi.revision }
  })

  it("keeps managers to their own venue and staff out of venue lists", async () => {
    expect(await getVenueAmenities(actors.staff1, {})).toMatchObject({
      code: "not_permitted",
    })
    expect(
      await getVenueAmenities(actors.otherManager, { venueId: venueA })
    ).toMatchObject({ code: "wrong_venue" })
    expect(
      await getCheck(actors.otherManager, { checkId: wifiCheck.id })
    ).toMatchObject({ code: "not_found" })
    expect(
      await addChecks(actors.otherManager, {
        venueId: venueA,
        keys: ["darts"],
      })
    ).toMatchObject({ code: "wrong_venue" })
    expect(
      await archiveCheck(actors.otherManager, {
        checkId: wifiCheck.id,
        revision: wifiCheck.revision,
      })
    ).toMatchObject({ code: "not_found" })
    expect(
      await enableAmenities(actors.otherManager, { venueId: venueB })
    ).toMatchObject({ code: "not_permitted" })
    // A manager account is never assigned work, so it has no tasks.
    expect(okOf(await getMyAmenityTasks(actors.manager, {})).tasks).toEqual([])
  })

  it("keeps a staff account's transitional grant working at its venue", async () => {
    expect(
      okOf(await getVenueAmenities(actors.legacyManager, {})).view
    ).toMatchObject({ venue: { id: venueC }, enabled: false })
    expect(
      await getVenueAmenities(actors.legacyManager, { venueId: venueA })
    ).toMatchObject({ code: "wrong_venue" })
    expect(
      await getCheck(actors.legacyManager, { checkId: wifiCheck.id })
    ).toMatchObject({ code: "not_found" })
    okOf(await enableAmenities(actors.admin, { venueId: venueC }))
    const [check] = okOf(
      await addChecks(actors.legacyManager, { keys: ["darts"] })
    ).checkIds
    const detail = okOf(
      await getCheck(actors.legacyManager, { checkId: check })
    ).detail
    expect(detail.check.venueId).toBe(venueC)
    expect(detail.permissions).toMatchObject({
      canAssign: true,
      canArchive: true,
      canSubmit: true,
    })
  })

  it("adds catalogue entries once, restores archived ones and marks them in the catalogue", async () => {
    expect(
      await addChecks(actors.manager, { keys: ["no_such_amenity"] })
    ).toMatchObject({ code: "not_found" })
    const [darts] = okOf(
      await addChecks(actors.manager, { keys: ["darts"] })
    ).checkIds
    dartsId = darts
    expect(
      okOf(await addChecks(actors.manager, { keys: ["darts"] })).checkIds
    ).toEqual([darts])
    const options = okOf(await listCatalogue(actors.manager, {})).options
    expect(options.find((o) => o.key === "darts")?.existing).toEqual({
      checkId: darts,
      status: "active",
    })
    expect(options.find((o) => o.key === "pool_table")?.existing).toBeNull()

    const revision = okOf(await getCheck(actors.manager, { checkId: darts }))
      .detail.check.revision
    okOf(await archiveCheck(actors.manager, { checkId: darts, revision }))
    expect(
      okOf(await addChecks(actors.manager, { keys: ["darts"] })).checkIds
    ).toEqual([darts])
    expect(
      okOf(await getCheck(actors.manager, { checkId: darts })).detail.check
        .status
    ).toBe("active")
  })

  it("assigns with revisions, rejects a stale revision and an ineligible assignee", async () => {
    expect(
      await assignCheck(actors.manager, {
        checkId: wifiCheck.id,
        revision: wifiCheck.revision,
        assigneeId: otherManager.id,
      })
    ).toMatchObject({ code: "state_conflict" })
    // Manager accounts are not assignable, not even at their own venue.
    expect(
      await assignCheck(actors.manager, {
        checkId: wifiCheck.id,
        revision: wifiCheck.revision,
        assigneeId: manager.id,
      })
    ).toMatchObject({ code: "state_conflict" })
    const managed = okOf(
      await getCheck(actors.manager, { checkId: wifiCheck.id })
    ).detail
    expect(managed.permissions).toEqual({
      canAssign: true,
      canArchive: true,
      canRestore: false,
      canReopen: false,
      canSubmit: true,
      canAttachLegacy: false,
    })
    expect(managed.assigneeOptions.map((o) => o.id).sort()).toEqual(
      [staff1.id, staff2.id].sort()
    )
    const assigned = okOf(
      await assignCheck(actors.manager, {
        checkId: wifiCheck.id,
        revision: wifiCheck.revision,
        assigneeId: staff1.id,
      })
    )
    expect(assigned.revision).toBe(wifiCheck.revision + 1)
    expect(
      await assignCheck(actors.manager, {
        checkId: wifiCheck.id,
        revision: wifiCheck.revision,
        assigneeId: staff2.id,
      })
    ).toMatchObject({
      code: "revision_conflict",
      currentRevision: assigned.revision,
    })
    wifiCheck.revision = assigned.revision
    const tasks = okOf(await getMyAmenityTasks(actors.staff1, {})).tasks
    expect(tasks.map((t) => t.id)).toContain(wifiCheck.id)
    expect(
      okOf(await getMyAmenityTasks(actors.staff2, {})).tasks.map((t) => t.id)
    ).not.toContain(wifiCheck.id)
    const detail = okOf(
      await getCheck(actors.staff1, { checkId: wifiCheck.id })
    ).detail
    expect(detail.permissions).toMatchObject({
      canSubmit: true,
      canAssign: false,
    })
    expect(detail.assigneeOptions).toEqual([])
  })

  it("lists the assignee's own uploads as submittable", async () => {
    const assets = okOf(
      await listSubmittableAssets(actors.staff1, { checkId: wifiCheck.id })
    ).assets
    expect(assets.map((a) => a.assetId).sort()).toEqual([photo1, video1].sort())
    expect(assets.find((a) => a.assetId === photo1)).toMatchObject({
      kind: "photo",
      source: "own",
      thumbUrl: `/api/amenities/evidence/${photo1}/thumb`,
    })
  })

  it("enforces the evidence rule, Wi-Fi notes and redaction, then completes and replays", async () => {
    const base = {
      checkId: wifiCheck.id,
      revision: wifiCheck.revision,
      answer: "yes",
      finding: "Guest network by the bar",
      wifi: {
        testSpot: "Bar",
        testedOn: today(),
        downloadMbps: 60,
        uploadMbps: 15,
      },
      redactionConfirmed: true,
    }
    expect(
      await submitFinding(actors.staff1, {
        ...base,
        idempotencyKey: crypto.randomUUID(),
        assetIds: [photo1],
      })
    ).toMatchObject({ code: "evidence_rule_unmet", rule: "both" })
    expect(
      await submitFinding(actors.staff1, {
        ...base,
        idempotencyKey: crypto.randomUUID(),
        assetIds: [photo1, video1],
        redactionConfirmed: false,
      })
    ).toMatchObject({ code: "invalid_input" })
    expect(
      await submitFinding(actors.staff2, {
        ...base,
        idempotencyKey: crypto.randomUUID(),
        assetIds: [],
        answer: "no",
        reason: "Not assigned",
      })
      // A check the caller cannot see is reported as missing, not forbidden.
    ).toMatchObject({ code: "not_found" })

    const input = {
      ...base,
      idempotencyKey: crypto.randomUUID(),
      assetIds: [photo1, video1],
    }
    const first = okOf(await submitFinding(actors.staff1, input))
    expect(first).toMatchObject({
      replayed: false,
      revision: wifiCheck.revision + 1,
    })
    const again = okOf(await submitFinding(actors.staff1, input))
    expect(again).toMatchObject({
      replayed: true,
      submissionId: first.submissionId,
      revision: first.revision,
    })
    wifiCheck.revision = first.revision

    const detail = okOf(
      await getCheck(actors.manager, { checkId: wifiCheck.id })
    ).detail
    expect(detail.check).toMatchObject({
      progress: "complete",
      answer: "yes",
      answeredBy: { id: staff1.id },
    })
    expect(detail.submissions).toHaveLength(1)
    expect(detail.submissions[0]).toMatchObject({
      id: first.submissionId,
      isCurrent: true,
      wifi: { testSpot: "Bar", downloadMbps: 60, uploadMbps: 15 },
    })
    expect(
      detail.submissions[0].evidence.map((e) => [e.assetId, e.kind]).sort()
    ).toEqual(
      [
        [photo1, "photo"],
        [video1, "video"],
      ].sort()
    )
    expect(detail.permissions.canReopen).toBe(true)
    const view = okOf(await getVenueAmenities(actors.manager, {})).view
    expect(view.recentlyCompleted.map((c) => c.id)).toEqual([wifiCheck.id])
  })

  it("serves evidence media to the venue's manager and not to another venue", async () => {
    expect(
      await signEvidence(
        actors.manager,
        photo1,
        "thumbnail",
        "amenity_evidence_asset"
      )
    ).toMatchObject({ ok: true })
    expect(
      await signEvidence(
        actors.otherManager,
        photo1,
        "thumbnail",
        "amenity_evidence_asset"
      )
    ).toMatchObject({ ok: false, status: 404 })
    const played = await amenityVideo(actors.manager, video1)
    expect(played).toMatchObject({
      ok: true,
      asset: { id: video1, mediaType: "video", originalFilename: null },
    })
    expect(await amenityVideo(actors.otherManager, video1)).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(await amenityVideo(actors.manager, photo1)).toMatchObject({
      ok: false,
      status: 404,
    })
  })

  it("lets a manager account capture a check itself, with its own evidence", async () => {
    const before = okOf(await getCheck(actors.manager, { checkId: dartsId }))
      .detail.check
    const own = okOf(
      await listSubmittableAssets(actors.manager, { checkId: dartsId })
    ).assets
    expect(own.find((a) => a.assetId === managerPhoto)).toMatchObject({
      kind: "photo",
      source: "own",
    })
    // Another person's upload is not the manager's to attach.
    expect(own.map((a) => a.assetId)).not.toContain(photo1)
    const input = {
      checkId: dartsId,
      revision: before.revision,
      idempotencyKey: crypto.randomUUID(),
      answer: "yes",
      finding: "Board by the back bar",
      assetIds: [managerPhoto],
    }
    expect(
      await submitFinding(actors.otherManager, {
        ...input,
        idempotencyKey: crypto.randomUUID(),
      })
    ).toMatchObject({ code: "not_found" })
    const done = okOf(await submitFinding(actors.manager, input))
    expect(done).toMatchObject({
      replayed: false,
      revision: before.revision + 1,
    })
    const detail = okOf(
      await getCheck(actors.manager, { checkId: dartsId })
    ).detail
    expect(detail.check).toMatchObject({
      progress: "complete",
      answer: "yes",
      answeredBy: { id: manager.id },
    })
    expect(detail.submissions[0].evidence.map((e) => e.assetId)).toEqual([
      managerPhoto,
    ])
    // The evidence routes' gate: the venue's manager account, not another venue.
    expect(
      await signEvidence(
        actors.manager,
        managerPhoto,
        "preview",
        "amenity_evidence_asset"
      )
    ).toMatchObject({ ok: true })
    expect(
      await signEvidence(
        actors.otherManager,
        managerPhoto,
        "preview",
        "amenity_evidence_asset"
      )
    ).toMatchObject({ ok: false, status: 404 })
  })

  it("reopens with a reason, then records notes, archive and restore", async () => {
    expect(
      await reopenCheck(actors.staff1, {
        checkId: wifiCheck.id,
        revision: wifiCheck.revision,
        preset: "credentials_visible",
      })
    ).toMatchObject({ code: "not_permitted" })
    const reopened = okOf(
      await reopenCheck(actors.manager, {
        checkId: wifiCheck.id,
        revision: wifiCheck.revision,
        preset: "credentials_visible",
      })
    )
    const notes = okOf(
      await setCheckNotes(actors.manager, {
        checkId: wifiCheck.id,
        revision: reopened.revision,
        notes: "Cover the router label",
      })
    )
    const archived = okOf(
      await archiveCheck(actors.manager, {
        checkId: wifiCheck.id,
        revision: notes.revision,
      })
    )
    expect(
      await submitFinding(actors.manager, {
        checkId: wifiCheck.id,
        revision: archived.revision,
        idempotencyKey: crypto.randomUUID(),
        answer: "no",
        reason: "Archived",
        assetIds: [],
      })
    ).toMatchObject({ code: "state_conflict" })
    const restored = okOf(
      await restoreCheck(actors.manager, {
        checkId: wifiCheck.id,
        revision: archived.revision,
      })
    )
    expect(restored.revision).toBe(archived.revision + 1)
    const detail = okOf(
      await getCheck(actors.manager, { checkId: wifiCheck.id })
    ).detail
    expect(detail.check).toMatchObject({
      status: "active",
      progress: "needs_recheck",
      answer: "yes",
      notes: "Cover the router label",
    })
    expect(detail.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        "added",
        "assigned",
        "submitted",
        "reopened",
        "notes_updated",
        "archived",
        "restored",
      ])
    )
  })
})
