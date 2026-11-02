// Coverage rules a direct PostgREST call must not get round (schema v6):
// amenity-fact media follows attach's rules (R-03), review replays check scope
// and decision (R-04), monthly-only photos come from the current month (R-05),
// monthly progress ignores archived requests and self-attached photos (R-06),
// submit and attach say when they replayed (R-07), a blank assignment reason is
// no reason (R-09), and the service role cannot delete or truncate coverage
// rows (R-10). Real identities; the service role builds fixtures and reads back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  assign,
  createRequirement,
  currentMonth,
  fails,
  grantManager,
  insertAsset,
  midMonth,
  monthOffset,
  ok,
  psql,
  requestKey,
  review,
  staffProgress,
  submit,
} from "./coverage-fixtures"
import { reserveReady } from "./menus-fixtures"

const service = serviceClient()
let admin: TestIdentity
let venue: string
let manager: TestIdentity
let author: TestIdentity

function staff(label: string, venueId: string) {
  return createIdentity(service, { label, role: "staff", venueId })
}

async function managedVenue(label: string) {
  const venueId = (await createVenue(service, label)).id
  const m = await staff(`${label}-mgr`, venueId)
  const grantId = await grantManager(admin, m.id, venueId)
  return { venueId, manager: m, grantId }
}

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "cov-hard-admin",
    role: "admin",
  })
  ;({ venueId: venue, manager } = await managedVenue("cov-hard"))
  author = await staff("cov-hard-author", venue)
})

describe("R-03: amenity-fact media", () => {
  it("takes images only, and from managers only active staff's photos; linked ones stay", async () => {
    const photo = (await reserveReady(service, author)).id
    const video = (await reserveReady(service, author, "video")).id
    const leaver = await staff("cov-hard-leaver", venue)
    const retained = (await reserveReady(service, leaver)).id
    const left = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", leaver.id)
    if (left.error) throw left.error

    let revision: number | null = null
    const save = (who: TestIdentity, ids: string[], facts = "TEST two") =>
      who.client.rpc("set_amenity_fact", {
        p_venue_id: venue,
        p_amenity_key: "toilets",
        p_expected_revision: revision as number,
        p_presence: "present",
        p_facts: facts,
        p_policy: null as unknown as string,
        p_confirm: false,
        p_asset_ids: ids,
      })
    const saved = async (who: TestIdentity, ids: string[], facts?: string) => {
      revision = (await ok(save(who, ids, facts)))[0]!.revision
    }
    const evidence = async (assetId: string) =>
      (
        await ok(
          manager.client.rpc("task_evidence_asset", { p_asset_id: assetId })
        )
      ).map((r) => r.asset_id)

    const notImage = await fails(
      save(manager, [video]),
      "evidence_not_eligible",
      "P0001"
    )
    expect(notImage.details).toBe("not_image")
    const departed = await fails(
      save(manager, [photo, retained]),
      "evidence_not_eligible",
      "P0001"
    )
    expect(departed.details).toBe("inactive_uploader")
    // So the evidence route stays closed to the manager.
    expect(await evidence(retained)).toEqual([])

    // Admins may link retained photos; the manager then sees them as evidence
    // and can keep editing the fact without removing them.
    await saved(admin, [photo, retained])
    expect(await evidence(retained)).toEqual([retained])
    await saved(manager, [photo, retained], "TEST three")
    // Once removed, the manager cannot add it back.
    await saved(manager, [photo])
    expect(await evidence(retained)).toEqual([])
    expect(
      (await fails(save(manager, [photo, retained]), "evidence_not_eligible"))
        .details
    ).toBe("inactive_uploader")
    expect(
      (await fails(save(admin, [photo, video]), "evidence_not_eligible"))
        .details
    ).toBe("not_image")
  })
})

describe("R-03: linked amenity-fact media stays as it is", () => {
  it("saves the same list plus a new photo after a linked photo is deleted or its uploader leaves", async () => {
    const { venueId, manager: m } = await managedVenue("cov-hard-fact")
    const keeper = await staff("cov-hard-fact-keeper", venueId)
    const leaver = await staff("cov-hard-fact-leaver", venueId)
    const deleted = (await reserveReady(service, keeper)).id
    const leaverPhoto = (await reserveReady(service, leaver)).id
    let revision: number | null = null
    const save = (ids: string[]) =>
      m.client.rpc("set_amenity_fact", {
        p_venue_id: venueId,
        p_amenity_key: "toilets",
        p_expected_revision: revision as number,
        p_presence: "present",
        p_facts: `TEST ${ids.length} photos`,
        p_policy: null as unknown as string,
        p_confirm: false,
        p_asset_ids: ids,
      })
    revision = (await ok(save([deleted, leaverPhoto])))[0]!.revision

    const removed = await keeper.client.rpc("delete_media_asset", {
      p_asset_id: deleted,
    })
    if (removed.error) throw removed.error
    const left = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", leaver.id)
    if (left.error) throw left.error

    const added = (await reserveReady(service, keeper)).id
    revision = (await ok(save([deleted, leaverPhoto, added])))[0]!.revision
    const { data, error } = await service
      .from("venue_amenity_fact_media")
      .select("asset_id")
      .eq("venue_id", venueId)
    if (error) throw error
    expect(data!.map((r) => r.asset_id).sort()).toEqual(
      [deleted, leaverPhoto, added].sort()
    )
    // A new photo still has to be ready and undeleted.
    const gone = (await reserveReady(service, keeper)).id
    const goneDeleted = await keeper.client.rpc("delete_media_asset", {
      p_asset_id: gone,
    })
    if (goneDeleted.error) throw goneDeleted.error
    await fails(
      save([deleted, leaverPhoto, added, gone]),
      "media_asset_not_found",
      "P0002"
    )
  })
})

describe("R-04: review replays", () => {
  it("answer only someone still in scope, and only for the same decision", async () => {
    const { venueId, manager: m, grantId } = await managedVenue("cov-hard-rep")
    const staffer = await staff("cov-hard-rep-staff", venueId)
    const photo = await reserveReady(service, staffer)
    const [item] = await submit(staffer, [photo.id])
    const key = requestKey()
    const decide = (decision: "accepted" | "needs_another_photo") =>
      review(
        m,
        item!.item_id,
        1,
        decision,
        decision === "accepted" ? null : "TEST again",
        key
      )
    expect((await ok(decide("accepted")))[0]).toMatchObject({
      state: "accepted",
      replayed: false,
    })
    expect((await ok(decide("accepted")))[0]).toMatchObject({
      state: "accepted",
      replayed: true,
    })
    await fails(
      decide("needs_another_photo"),
      "idempotency_key_reused",
      "22023"
    )
    await ok(
      admin.client.rpc("revoke_venue_manager", {
        p_grant_id: grantId,
        p_reason: "TEST scope ended",
      })
    )
    await fails(decide("accepted"), "coverage_item_not_found", "P0002")
  })
})

describe("R-05: monthly-only photos", () => {
  it("come from the current London month; a task takes older ones", async () => {
    const old = await insertAsset(service, {
      uploader: author.id,
      venue,
      createdAt: midMonth(monthOffset(-1)),
    })
    const monthly = () =>
      author.client.rpc("submit_coverage_photos", {
        p_asset_ids: [old.id],
        p_client_request_key: requestKey(),
      })
    const refused = await fails(monthly(), "evidence_not_eligible", "P0001")
    expect(refused.details).toBe("outside_period")

    const requirement = await createRequirement(manager, venue, {
      title: "TEST older photos welcome",
    })
    await assign(manager, requirement, [author.id])
    const [item] = await submit(author, [old.id], requirement)
    expect(item).toMatchObject({ state: "submitted", reused: false })
    // Nor can it move from the task to monthly-only.
    expect((await fails(monthly(), "evidence_not_eligible")).details).toBe(
      "outside_period"
    )
  })
})

describe("R-06: monthly progress", () => {
  it("drops archived requests and a manager's self-attached photos", async () => {
    const month = currentMonth()
    const progress = async (who: TestIdentity) =>
      (await staffProgress(manager, venue, month, who.id))[0]!

    const requirement = await createRequirement(manager, venue, {
      title: "TEST soon retired",
    })
    await assign(manager, requirement, [author.id])
    const photo = await reserveReady(service, author)
    const [item] = await submit(author, [photo.id], requirement)
    const open = (await progress(author)).needs_another_photo_count
    await ok(
      review(manager, item!.item_id, 1, "needs_another_photo", "TEST blurry")
    )
    expect((await progress(author)).needs_another_photo_count).toBe(open + 1)
    const { data: current, error } = await service
      .from("coverage_requirements")
      .select("revision")
      .eq("id", requirement)
      .single()
    if (error) throw error
    await ok(
      manager.client.rpc("set_coverage_requirement_status", {
        p_requirement_id: requirement,
        p_expected_revision: current.revision,
        p_status: "retired",
        p_reason: "TEST season over",
      })
    )
    expect((await progress(author)).needs_another_photo_count).toBe(open)

    const own = await reserveReady(service, manager)
    const target = await createRequirement(manager, venue, {
      title: "TEST manager attach",
    })
    const pending = (await progress(manager)).pending_count
    await ok(
      manager.client.rpc("attach_coverage_evidence", {
        p_requirement_id: target,
        p_asset_ids: [own.id],
        p_client_request_key: requestKey(),
      })
    )
    expect((await progress(manager)).pending_count).toBe(pending)
  })
})

describe("R-07: submit and attach replays", () => {
  it("report replayed on every row, also for calls that waited on the key's lock", async () => {
    const photos = [
      (await reserveReady(service, author)).id,
      (await reserveReady(service, author)).id,
    ]
    const key = requestKey()
    const send = (ids = photos) =>
      author.client.rpc("submit_coverage_photos", {
        p_asset_ids: ids,
        p_client_request_key: key,
      })
    const sent = await Promise.all([1, 2, 3].map(() => ok(send())))
    for (const rows of sent) {
      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((r) => r.replayed)).size).toBe(1)
    }
    expect(sent.map((rows) => rows[0]!.replayed).sort()).toEqual([
      false,
      true,
      true,
    ])
    expect(
      new Set(sent.flatMap((rows) => rows.map((r) => r.item_id))).size
    ).toBe(2)
    await fails(send([photos[0]!]), "idempotency_key_reused", "22023")

    const requirement = await createRequirement(manager, venue, {
      title: "TEST attach race",
    })
    const extra = (await reserveReady(service, author)).id
    const attachKey = requestKey()
    const attach = () =>
      ok(
        manager.client.rpc("attach_coverage_evidence", {
          p_requirement_id: requirement,
          p_asset_ids: [extra],
          p_client_request_key: attachKey,
        })
      )
    const attached = await Promise.all([attach(), attach(), attach()])
    expect(attached.map((rows) => rows[0]!.replayed).sort()).toEqual([
      false,
      true,
      true,
    ])
    expect(new Set(attached.map((rows) => rows[0]!.item_id)).size).toBe(1)
  })
})

describe("R-09: assignment reasons", () => {
  it("stores a blank reason as no reason instead of failing", async () => {
    const requirement = await createRequirement(manager, venue, {
      title: "TEST blank reason",
    })
    const rows = await ok(
      manager.client.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: requirement,
        p_staff_ids: [author.id],
        p_reason: "   ",
      })
    )
    expect(rows.map((r) => r.staff_id)).toEqual([author.id])
    const { data, error } = await service
      .from("coverage_audit_events")
      .select("reason")
      .eq("entity_id", requirement)
      .eq("action", "assignees_set")
    if (error) throw error
    expect(data).toEqual([{ reason: null }])
  })
})

describe("R-10: service-role table privileges", () => {
  const TABLES = [
    "coverage_amenity_templates",
    "venue_amenity_facts",
    "venue_amenity_fact_media",
    "menu_coverage_plans",
    "coverage_requirements",
    "coverage_requirement_assignees",
    "monthly_targets",
    "coverage_submissions",
    "coverage_submission_items",
    "coverage_review_events",
    "coverage_preparation_runs",
  ]
  const granted = (privilege: string) =>
    psql(
      `select string_agg(t, ',') from unnest(array['${TABLES.join("','")}']) t
       where has_table_privilege('service_role', 'public.' || t, '${privilege}')`
    )
      .split(",")
      .filter(Boolean)
      .sort()

  it("keeps only the explicit grants: no delete or truncate, no update on append-only rows", () => {
    expect(granted("DELETE")).toEqual([])
    expect(granted("TRUNCATE")).toEqual([])
    expect(granted("UPDATE")).toEqual(
      [
        "coverage_amenity_templates",
        "venue_amenity_facts",
        "menu_coverage_plans",
        "coverage_requirements",
        "coverage_requirement_assignees",
        "monthly_targets",
        "coverage_submission_items",
      ].sort()
    )
    expect(granted("SELECT")).toEqual([...TABLES].sort())
    expect(granted("INSERT")).toEqual([...TABLES].sort())
  })
})
