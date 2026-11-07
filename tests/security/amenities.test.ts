// Amenity catalogue and per-venue evidence checks
// (supabase/migrations/20261107120000_amenity_catalogue.sql, contract
// lib/amenities/contract.ts). Every assertion runs as a real signed-in
// identity through the RPCs; the service role only builds fixtures (assets,
// legacy Coverage evidence, transfers) and reads state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { CORE_CHECK_KEYS } from "../../lib/amenities/contract"
import type { Json } from "../../lib/db/types"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  fails,
  grantManager,
  insertAsset,
  insertSubmittedItem,
  ok,
} from "./coverage-fixtures"

const service = serviceClient()

let venue: string
let otherVenue: string
let admin: TestIdentity
let manager: TestIdentity
let staffA: TestIdentity
let staffB: TestIdentity
let otherManager: TestIdentity
let otherStaff: TestIdentity

type SubmitArgs = {
  revision?: number
  key?: string
  answer?: "yes" | "no" | "not_applicable"
  reason?: string | null
  finding?: string | null
  assets?: string[]
  metadata?: { [key: string]: Json | undefined } | null
  redaction?: boolean
}

async function checkRow(who: TestIdentity, checkId: string) {
  const [row] = await ok(
    who.client.rpc("amenity_check", { p_check_id: checkId })
  )
  return row!
}

async function revisionOf(checkId: string): Promise<number> {
  const { data, error } = await service
    .from("venue_amenity_checks")
    .select("revision")
    .eq("id", checkId)
    .single()
  if (error) throw error
  return data!.revision
}

async function events(who: TestIdentity, checkId: string) {
  return ok(who.client.rpc("amenity_check_events", { p_check_id: checkId }))
}

async function addCheck(who: TestIdentity, venueId: string, key: string) {
  const [id] = await ok(
    who.client.rpc("amenity_add_checks", { p_venue_id: venueId, p_keys: [key] })
  )
  return id!
}

async function assign(
  who: TestIdentity,
  checkId: string,
  assigneeId: string | null
) {
  return who.client.rpc("amenity_assign_check", {
    p_check_id: checkId,
    p_assignee_id: assigneeId as string,
    p_revision: await revisionOf(checkId),
  })
}

async function submit(
  who: TestIdentity,
  checkId: string,
  args: SubmitArgs = {}
) {
  return who.client.rpc("amenity_submit_finding", {
    p_check_id: checkId,
    p_revision: args.revision ?? (await revisionOf(checkId)),
    p_idempotency_key: args.key ?? randomUUID(),
    p_answer: args.answer ?? "yes",
    p_finding: (args.finding ?? null) as string,
    p_limitations: null as unknown as string,
    p_reason: (args.reason ?? null) as string,
    p_asset_ids: args.assets ?? [],
    p_internal_metadata: (args.metadata ?? null) as Json,
    p_redaction_confirmed: args.redaction ?? false,
  })
}

async function reopen(
  who: TestIdentity,
  checkId: string,
  preset: string,
  reason: string | null = null
) {
  return who.client.rpc("amenity_reopen_check", {
    p_check_id: checkId,
    p_revision: await revisionOf(checkId),
    p_preset: preset as "other",
    p_reason: reason as string,
  })
}

async function photo(uploader: string, venueId = venue) {
  return (await insertAsset(service, { uploader, venue: venueId })).id
}

async function video(uploader: string, venueId = venue) {
  return (
    await insertAsset(service, { uploader, venue: venueId, mediaType: "video" })
  ).id
}

const londonToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    new Date()
  )

const wifi = () => ({
  testSpot: "Back bar",
  testedOn: londonToday(),
  downloadMbps: 54.5,
  uploadMbps: 12,
})

beforeAll(async () => {
  venue = (await createVenue(service, "amen")).id
  otherVenue = (await createVenue(service, "amen-other")).id
  admin = await createIdentity(service, { label: "amen-admin", role: "admin" })
  manager = await createIdentity(service, {
    label: "amen-mgr",
    role: "staff",
    venueId: venue,
  })
  staffA = await createIdentity(service, {
    label: "amen-a",
    role: "staff",
    venueId: venue,
  })
  staffB = await createIdentity(service, {
    label: "amen-b",
    role: "staff",
    venueId: venue,
  })
  otherManager = await createIdentity(service, {
    label: "amen-other-mgr",
    role: "staff",
    venueId: otherVenue,
  })
  otherStaff = await createIdentity(service, {
    label: "amen-other-staff",
    role: "staff",
    venueId: otherVenue,
  })
  await grantManager(admin, manager.id, venue)
  await grantManager(admin, otherManager.id, otherVenue)
})

describe("catalogue", () => {
  it("is readable by signed-in users and not writable", async () => {
    const rows = await ok(
      staffA.client.from("amenity_catalogue").select("key, is_core")
    )
    expect(rows).toHaveLength(39)
    expect(
      rows
        .filter((r: { is_core: boolean }) => r.is_core)
        .map((r: { key: string }) => r.key)
        .sort()
    ).toEqual([...CORE_CHECK_KEYS].sort())
    const insert = await admin.client.from("amenity_catalogue").insert({
      key: "test_key",
      category: "Test",
      question: "Test?",
      capture_brief: "Test",
      evidence_rule: "photo",
      position: 99,
      catalogue_version: 1,
    } as never)
    expect(insert.error?.code).toBe("42501")
  })
})

describe("enable and add", () => {
  it("enables once (admin only) with the four core checks, unassigned", async () => {
    await fails(
      manager.client.rpc("amenity_enable_venue", { p_venue_id: venue }),
      "not_active_admin"
    )
    await fails(
      manager.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: ["darts"],
      }),
      "amenities_not_enabled"
    )
    const [before] = await ok(
      manager.client.rpc("amenity_venue_state", { p_venue_id: venue })
    )
    expect(before).toMatchObject({ enabled: false, can_enable: false })

    expect(
      await ok(admin.client.rpc("amenity_enable_venue", { p_venue_id: venue }))
    ).toBe(4)
    expect(
      await ok(admin.client.rpc("amenity_enable_venue", { p_venue_id: venue }))
    ).toBe(0)
    await fails(
      admin.client.rpc("amenity_enable_venue", { p_venue_id: randomUUID() }),
      "venue_not_found",
      "P0002"
    )

    const [state] = await ok(
      admin.client.rpc("amenity_venue_state", { p_venue_id: venue })
    )
    expect(state).toMatchObject({
      venue_id: venue,
      enabled: true,
      can_enable: true,
    })

    const checks = await ok(
      manager.client.rpc("amenity_checks_for_venue", {
        p_venue_id: venue,
        p_include_archived: false,
      })
    )
    expect(
      checks.map((c: { template_key: string }) => c.template_key).sort()
    ).toEqual([...CORE_CHECK_KEYS].sort())
    for (const c of checks) {
      expect(c).toMatchObject({
        status: "active",
        progress: "needs_capture",
        answer: "to_check",
        assignee_user_id: null,
        current_submission_id: null,
        revision: 1,
        is_core: true,
        catalogue_version: 1,
      })
      const history = await events(manager, c.id)
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        kind: "added",
        detail: { source: "enable" },
      })
    }
  })

  it("returns the existing check for a duplicate key and rejects bad lists", async () => {
    const first = await addCheck(manager, venue, "darts")
    const [again, other] = await ok(
      manager.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: ["darts", "pool_table"],
      })
    )
    expect(again).toBe(first)
    expect(other).not.toBe(first)
    expect(await revisionOf(first)).toBe(1)
    expect(
      (await events(manager, first)).map((e: { kind: string }) => e.kind)
    ).toEqual(["added"])

    await fails(
      manager.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: ["no_such_key"],
      }),
      "amenity_key_not_found",
      "P0002"
    )
    await fails(
      manager.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: [],
      }),
      "invalid_key_list"
    )
    await fails(
      manager.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: ["darts", "darts"],
      }),
      "invalid_key_list"
    )
    await fails(
      staffA.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: ["arcade"],
      }),
      "not_venue_manager"
    )
    await fails(
      otherManager.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: ["arcade"],
      }),
      "not_venue_manager"
    )

    const catalogue = await ok(
      manager.client.rpc("amenity_catalogue_for_venue", { p_venue_id: venue })
    )
    expect(catalogue).toHaveLength(39)
    expect(
      catalogue.find((r: { key: string }) => r.key === "darts")
    ).toMatchObject({
      check_id: first,
      check_status: "active",
    })
    expect(
      catalogue.find((r: { key: string }) => r.key === "arcade")
    ).toMatchObject({
      check_id: null,
      check_status: null,
    })
  })

  it("archives and restores the same row, keeping its history", async () => {
    const id = await addCheck(manager, venue, "board_games")
    await ok(assign(manager, id, staffA.id))
    const archived = await ok(
      manager.client.rpc("amenity_archive_check", {
        p_check_id: id,
        p_revision: await revisionOf(id),
      })
    )
    expect(archived).toBe(3)
    await fails(
      manager.client.rpc("amenity_archive_check", {
        p_check_id: id,
        p_revision: archived,
      }),
      "amenity_check_archived"
    )
    await fails(submit(manager, id), "amenity_check_archived")

    const active = await ok(
      manager.client.rpc("amenity_checks_for_venue", {
        p_venue_id: venue,
        p_include_archived: false,
      })
    )
    expect(active.some((c: { id: string }) => c.id === id)).toBe(false)
    const all = await ok(
      manager.client.rpc("amenity_checks_for_venue", {
        p_venue_id: venue,
        p_include_archived: true,
      })
    )
    expect(all.find((c: { id: string }) => c.id === id)).toMatchObject({
      status: "archived",
    })

    // Re-adding the key restores the same row.
    expect(await addCheck(manager, venue, "board_games")).toBe(id)
    expect(await checkRow(manager, id)).toMatchObject({
      status: "active",
      revision: 4,
      assignee_user_id: staffA.id,
    })

    await ok(
      manager.client.rpc("amenity_archive_check", {
        p_check_id: id,
        p_revision: 4,
      })
    )
    await fails(
      manager.client.rpc("amenity_restore_check", {
        p_check_id: id,
        p_revision: 4,
      }),
      "amenity_conflict"
    )
    expect(
      await ok(
        manager.client.rpc("amenity_restore_check", {
          p_check_id: id,
          p_revision: 5,
        })
      )
    ).toBe(6)
    expect(
      (await events(manager, id)).map((e: { kind: string }) => e.kind)
    ).toEqual([
      "added",
      "assigned",
      "archived",
      "restored",
      "archived",
      "restored",
    ])
  })
})

describe("assignment", () => {
  let check: string

  beforeAll(async () => {
    check = await addCheck(manager, venue, "arcade")
  })

  it("assigns, reassigns and unassigns active staff of the venue", async () => {
    await fails(
      assign(staffA, check, staffA.id),
      "amenity_check_not_found",
      "P0002"
    )
    expect(await ok(assign(manager, check, staffA.id))).toBe(2)
    // The assignee can now read it, and it is one of their tasks.
    expect(await checkRow(staffA, check)).toMatchObject({
      assignee_user_id: staffA.id,
      assignee_name: "TEST amen-a",
    })
    await fails(assign(staffA, check, staffB.id), "not_venue_manager")
    const mine = await ok(staffA.client.rpc("amenity_my_checks"))
    expect(mine.map((c: { id: string }) => c.id)).toContain(check)

    expect(await ok(assign(admin, check, staffB.id))).toBe(3)
    await fails(
      staffA.client.rpc("amenity_check", { p_check_id: check }),
      "amenity_check_not_found"
    )
    // Same assignee again changes nothing.
    expect(await ok(assign(manager, check, staffB.id))).toBe(3)
    expect(await ok(assign(manager, check, null))).toBe(4)

    const kinds = (await events(manager, check)).map((e) => [e.kind, e.detail])
    expect(kinds).toEqual([
      ["added", { source: "manager" }],
      ["assigned", { assigneeId: staffA.id, previousAssigneeId: null }],
      ["assigned", { assigneeId: staffB.id, previousAssigneeId: staffA.id }],
      ["unassigned", { cause: "manager", previousAssigneeId: staffB.id }],
    ])
  })

  it("rejects staff of another venue, inactive staff and admins", async () => {
    const inactive = await createIdentity(service, {
      label: "amen-inactive",
      role: "staff",
      venueId: venue,
      active: false,
    })
    for (const who of [otherStaff.id, inactive.id, admin.id, randomUUID()]) {
      await fails(assign(manager, check, who), "staff_not_eligible")
    }
    await fails(
      manager.client.rpc("amenity_assign_check", {
        p_check_id: check,
        p_assignee_id: staffA.id,
        p_revision: 1,
      }),
      "amenity_conflict"
    )
    const options = await ok(
      manager.client.rpc("amenity_assignee_options", { p_check_id: check })
    )
    const ids = options.map((o: { id: string }) => o.id)
    expect(ids).toEqual(
      expect.arrayContaining([manager.id, staffA.id, staffB.id])
    )
    expect(ids).not.toContain(otherStaff.id)
    expect(ids).not.toContain(inactive.id)
    await fails(
      staffA.client.rpc("amenity_assignee_options", { p_check_id: check }),
      "amenity_check_not_found"
    )
  })

  it("updates notes with a revision and clears them when blank", async () => {
    const r1 = await revisionOf(check)
    const r2 = await ok(
      manager.client.rpc("amenity_set_check_notes", {
        p_check_id: check,
        p_notes: "  Ask the duty lead first. ",
        p_revision: r1,
      })
    )
    expect(r2).toBe(r1 + 1)
    expect((await checkRow(manager, check)).notes).toBe(
      "Ask the duty lead first."
    )
    await fails(
      manager.client.rpc("amenity_set_check_notes", {
        p_check_id: check,
        p_notes: "x".repeat(2001),
        p_revision: r2,
      }),
      "invalid_notes"
    )
    await ok(
      manager.client.rpc("amenity_set_check_notes", {
        p_check_id: check,
        p_notes: " ",
        p_revision: r2,
      })
    )
    expect((await checkRow(manager, check)).notes).toBeNull()
  })
})

describe("submitting findings", () => {
  it("lets the assignee, manager and admin submit, nobody else", async () => {
    const check = await addCheck(manager, venue, "fruit_machine")
    await ok(assign(manager, check, staffA.id))
    await fails(
      submit(staffB, check, { assets: [await photo(staffB.id)] }),
      "amenity_check_not_found"
    )
    await fails(
      submit(otherManager, check, {
        assets: [await photo(otherManager.id, otherVenue)],
      }),
      "amenity_check_not_found"
    )

    const own = await photo(staffA.id)
    const [first] = await ok(
      submit(staffA, check, { assets: [own], finding: " By the door " })
    )
    expect(first).toMatchObject({ revision: 3, replayed: false })
    expect(await checkRow(staffA, check)).toMatchObject({
      progress: "complete",
      answer: "yes",
      answered_by: staffA.id,
      current_submission_id: first!.submission_id,
      recheck_reason: null,
    })
    // Complete checks leave the assignee's task list.
    const mine = await ok(staffA.client.rpc("amenity_my_checks"))
    expect(mine.map((c: { id: string }) => c.id)).not.toContain(check)

    await ok(
      submit(manager, check, { answer: "no", reason: "Removed last week" })
    )
    await ok(
      submit(admin, check, {
        answer: "not_applicable",
        reason: "Venue closed area",
      })
    )
    const subs = await ok(
      manager.client.rpc("amenity_check_submissions", { p_check_id: check })
    )
    expect(subs).toHaveLength(3)
    expect(
      subs.find((s: { id: string }) => s.id === first!.submission_id)
    ).toMatchObject({
      finding: "By the door",
      template_version: 1,
      evidence_rule: "photo",
    })
    expect(await checkRow(manager, check)).toMatchObject({
      answer: "not_applicable",
      answered_by: admin.id,
    })
  })

  it("applies the evidence rules for photo, video, either and both", async () => {
    // pool_table photo, step_free_entrance video, live_music either, accessible_toilet both
    const [pool, entrance, music, toilet] = await ok(
      manager.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: [
          "pool_table",
          "step_free_entrance",
          "live_music",
          "accessible_toilet",
        ],
      })
    )
    const p = () => photo(manager.id)
    const v = () => video(manager.id)

    let err = await fails(
      submit(manager, pool!, { assets: [await v()] }),
      "evidence_rule_unmet"
    )
    expect(err.details).toBe("photo")
    await ok(submit(manager, pool!, { assets: [await p()] }))

    err = await fails(
      submit(manager, entrance!, { assets: [await p()] }),
      "evidence_rule_unmet"
    )
    expect(err.details).toBe("video")
    await ok(submit(manager, entrance!, { assets: [await v()] }))

    await fails(submit(manager, music!, { assets: [] }), "evidence_rule_unmet")
    await ok(submit(manager, music!, { assets: [await v()] }))
    await ok(submit(manager, music!, { assets: [await p()] }))

    for (const assets of [[await p()], [await v()], [await p(), await p()]]) {
      err = await fails(
        submit(manager, toilet!, { assets }),
        "evidence_rule_unmet"
      )
      expect(err.details).toBe("both")
    }
    const [done] = await ok(
      submit(manager, toilet!, { assets: [await p(), await v()] })
    )
    const assets = await ok(
      manager.client.rpc("amenity_check_submission_assets", {
        p_check_id: toilet!,
      })
    )
    expect(
      assets
        .filter(
          (a: { submission_id: string }) =>
            a.submission_id === done!.submission_id
        )
        .map((a: { evidence_kind: string; available: boolean }) => [
          a.evidence_kind,
          a.available,
        ])
        .sort()
    ).toEqual([
      ["photo", true],
      ["video", true],
    ])
  })

  it("needs a reason for No and Not applicable; evidence is optional", async () => {
    const check = await addCheck(manager, venue, "snooker")
    await fails(submit(manager, check, { answer: "no" }), "reason_required")
    await fails(
      submit(manager, check, { answer: "not_applicable", reason: "   " }),
      "reason_required"
    )
    await fails(
      submit(manager, check, { answer: "no", reason: "x".repeat(501) }),
      "invalid_reason"
    )
    await fails(
      submit(manager, check, { answer: "maybe" as "no", reason: "x" }),
      "invalid_answer"
    )
    const [done] = await ok(
      submit(manager, check, { answer: "no", reason: " No table " })
    )
    expect(done!.replayed).toBe(false)
    expect(await checkRow(manager, check)).toMatchObject({
      answer: "no",
      progress: "complete",
    })
  })

  it("checks every asset: venue, owner, deleted, ready, list shape", async () => {
    const check = await addCheck(manager, venue, "sports_screen")
    await ok(assign(manager, check, staffA.id))
    const reason = async (assetId: string, who = staffA) => {
      const err = await fails(
        submit(who, check, { assets: [assetId] }),
        "evidence_not_eligible"
      )
      return JSON.parse(err.details!)
    }
    expect(await reason(randomUUID())).toMatchObject({ reason: "not_found" })
    expect(await reason(await photo(otherStaff.id, otherVenue))).toMatchObject({
      reason: "other_venue",
    })
    // Another person's media at the same venue, also for a manager unless it is legacy Coverage evidence.
    const staffBPhoto = await photo(staffB.id)
    expect(await reason(staffBPhoto)).toEqual({
      assetId: staffBPhoto,
      reason: "not_own",
    })
    expect(await reason(staffBPhoto, manager)).toMatchObject({
      reason: "not_own",
    })
    const pending = (
      await insertAsset(service, { uploader: staffA.id, venue, ready: false })
    ).id
    expect(await reason(pending)).toMatchObject({ reason: "not_ready" })
    const gone = await photo(staffA.id)
    await ok(staffA.client.rpc("delete_media_asset", { p_asset_id: gone }))
    expect(await reason(gone)).toMatchObject({ reason: "deleted" })

    const own = await photo(staffA.id)
    await fails(
      submit(staffA, check, { assets: [own, own] }),
      "invalid_asset_list"
    )
    const eleven = await Promise.all(
      Array.from({ length: 11 }, () => photo(staffA.id))
    )
    await fails(submit(staffA, check, { assets: eleven }), "invalid_asset_list")

    const listed = await ok(
      staffA.client.rpc("amenity_submittable_assets", { p_check_id: check })
    )
    const ids = listed.map((a: { asset_id: string }) => a.asset_id)
    expect(ids).toContain(own)
    expect(ids).not.toContain(staffBPhoto)
    expect(ids).not.toContain(gone)
    expect(ids).not.toContain(pending)
    expect(
      listed.find((a: { asset_id: string }) => a.asset_id === own)
    ).toMatchObject({
      source: "own",
      media_type: "image",
    })
  })

  it("lets a manager or admin, not staff, attach matching legacy Coverage media", async () => {
    const check = await addCheck(manager, venue, "guest_toilets")
    await ok(assign(manager, check, staffA.id))
    // A photo staff B submitted to the venue's "toilets" Coverage requirement,
    // and one on the "parking" amenity fact (a different catalogue key).
    const { data: req, error } = await service
      .from("coverage_requirements")
      .insert({
        venue_id: venue,
        kind: "amenity",
        title: "Toilets",
        amenity_key: "toilets",
        status: "active",
      })
      .select("id")
      .single()
    if (error) throw error
    const legacyAsset = await insertAsset(service, {
      uploader: staffB.id,
      venue,
    })
    await insertSubmittedItem(service, {
      asset: legacyAsset,
      venue,
      author: staffB.id,
      submittedAt: new Date().toISOString(),
      requirement: req!.id,
    })
    const { data: fact, error: fError } = await service
      .from("venue_amenity_facts")
      .insert({ venue_id: venue, amenity_key: "parking" })
      .select("id")
      .single()
    if (fError) throw fError
    const parkingAsset = await photo(staffB.id)
    const media = await service
      .from("venue_amenity_fact_media")
      .insert({ fact_id: fact!.id, venue_id: venue, asset_id: parkingAsset })
    if (media.error) throw media.error

    const managerList = await ok(
      manager.client.rpc("amenity_submittable_assets", { p_check_id: check })
    )
    expect(
      managerList.find(
        (a: { asset_id: string }) => a.asset_id === legacyAsset.id
      )
    ).toMatchObject({ source: "legacy_coverage" })
    expect(
      managerList.some((a: { asset_id: string }) => a.asset_id === parkingAsset)
    ).toBe(false)
    const staffList = await ok(
      staffA.client.rpc("amenity_submittable_assets", { p_check_id: check })
    )
    expect(
      staffList.some((a: { asset_id: string }) => a.asset_id === legacyAsset.id)
    ).toBe(false)

    await fails(
      submit(staffA, check, { assets: [legacyAsset.id] }),
      "evidence_not_eligible"
    )
    await fails(
      submit(manager, check, { assets: [parkingAsset] }),
      "evidence_not_eligible"
    )
    await ok(submit(admin, check, { assets: [legacyAsset.id] }))

    // A manager who attached someone else's legacy photo sees it only while
    // they manage, or still work at, the venue.
    const attacher = await createIdentity(service, {
      label: "amen-attacher",
      role: "staff",
      venueId: venue,
    })
    await grantManager(admin, attacher.id, venue)
    const mall = await addCheck(attacher, venue, "dogs_outside")
    const { data: dogReq, error: dogError } = await service
      .from("coverage_requirements")
      .insert({
        venue_id: venue,
        kind: "amenity",
        title: "Dogs",
        amenity_key: "dog_facilities",
        status: "active",
      })
      .select("id")
      .single()
    if (dogError) throw dogError
    const dogAsset = await insertAsset(service, { uploader: staffB.id, venue })
    await insertSubmittedItem(service, {
      asset: dogAsset,
      venue,
      author: staffB.id,
      submittedAt: new Date().toISOString(),
      requirement: dogReq!.id,
    })
    await ok(submit(attacher, mall, { assets: [dogAsset.id] }))
    const gate = () =>
      ok(
        attacher.client.rpc("amenity_evidence_asset", {
          p_asset_id: dogAsset.id,
        })
      )
    expect(await gate()).toHaveLength(1)
    const moved = await service
      .from("profiles")
      .update({ venue_id: otherVenue })
      .eq("id", attacher.id)
    if (moved.error) throw moved.error
    expect(await gate()).toEqual([])

    // The fact media matches onsite_parking.
    const parking = (
      await ok(
        manager.client.rpc("amenity_checks_for_venue", {
          p_venue_id: venue,
          p_include_archived: false,
        })
      )
    ).find(
      (c: { template_key: string }) => c.template_key === "onsite_parking"
    )!
    await ok(submit(manager, parking.id, { assets: [parkingAsset] }))
  })
})

describe("revisions and idempotency", () => {
  it("rejects a stale or concurrent submit with the current revision", async () => {
    const check = await addCheck(manager, venue, "fireplace")
    await ok(assign(manager, check, staffA.id))
    const revision = await revisionOf(check)
    const [a, b] = await Promise.all([
      submit(staffA, check, { revision, assets: [await photo(staffA.id)] }),
      submit(manager, check, { revision, answer: "no", reason: "Bricked up" }),
    ])
    const results = [a, b]
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    const conflict = results.find((r) => r.error !== null)!.error!
    expect(conflict.message).toBe("amenity_conflict")
    expect(JSON.parse(conflict.details!)).toEqual({ revision: revision + 1 })
    expect(await revisionOf(check)).toBe(revision + 1)
    expect(
      await ok(
        manager.client.rpc("amenity_check_submissions", { p_check_id: check })
      )
    ).toHaveLength(1)
  })

  it("replays the same key for the same check even after the revision moved", async () => {
    const check = await addCheck(manager, venue, "charging")
    const other = await addCheck(manager, venue, "cycle_parking")
    const key = randomUUID()
    const asset = await photo(manager.id)
    const [first] = await ok(submit(manager, check, { key, assets: [asset] }))
    await ok(reopen(manager, check, "evidence_unclear"))

    const [again] = await ok(
      submit(manager, check, { key, revision: 1, assets: [asset] })
    )
    expect(again).toEqual({
      submission_id: first!.submission_id,
      revision: first!.revision,
      replayed: true,
    })
    // Nothing was recorded twice and the reopen still stands.
    expect(
      await ok(
        manager.client.rpc("amenity_check_submissions", { p_check_id: check })
      )
    ).toHaveLength(1)
    expect(await checkRow(manager, check)).toMatchObject({
      progress: "needs_recheck",
    })

    await fails(
      submit(manager, other, { key, assets: [await photo(manager.id)] }),
      "idempotency_key_reused"
    )
    await fails(
      submit(admin, check, { key, assets: [asset] }),
      "idempotency_key_reused"
    )
  })

  it("replays for the submitter after they were unassigned", async () => {
    const check = await addCheck(manager, venue, "dogs_inside")
    await ok(assign(manager, check, staffB.id))
    const key = randomUUID()
    const asset = await photo(staffB.id)
    const [first] = await ok(submit(staffB, check, { key, assets: [asset] }))
    await ok(assign(manager, check, null))
    await fails(
      submit(staffB, check, { assets: [asset] }),
      "amenity_not_permitted"
    )
    const [again] = await ok(
      submit(staffB, check, { key, revision: 1, assets: [asset] })
    )
    expect(again).toMatchObject({
      submission_id: first!.submission_id,
      replayed: true,
    })
  })
})

describe("reopen", () => {
  it("keeps the answer, needs a preset and a reason for Other, and clears on recapture", async () => {
    const check = await addCheck(manager, venue, "high_chairs")
    await ok(assign(manager, check, staffA.id))
    await ok(submit(staffA, check, { assets: [await photo(staffA.id)] }))

    const fresh = await addCheck(manager, venue, "baby_changing")
    await fails(reopen(manager, fresh, "wrong_area"), "amenity_conflict")
    await fails(reopen(manager, check, "nope"), "invalid_reopen_preset")
    await fails(reopen(manager, check, "other"), "reason_required")
    await fails(reopen(manager, check, "other", "  "), "reason_required")
    await fails(reopen(staffA, check, "wrong_area"), "not_venue_manager")

    await ok(reopen(manager, check, "wrong_area", "Show the family room"))
    expect(await checkRow(staffA, check)).toMatchObject({
      progress: "needs_recheck",
      answer: "yes",
      recheck_reason: "Wrong area: Show the family room",
    })
    const mine = await ok(staffA.client.rpc("amenity_my_checks"))
    expect(mine.find((c: { id: string }) => c.id === check)).toMatchObject({
      progress: "needs_recheck",
    })

    await ok(reopen(admin, check, "other", "Chairs moved upstairs"))
    expect((await checkRow(manager, check)).recheck_reason).toBe(
      "Chairs moved upstairs"
    )
    const reopened = (await events(manager, check)).filter(
      (e: { kind: string }) => e.kind === "reopened"
    )
    expect(reopened.map((e) => [e.reason, e.detail])).toEqual([
      ["Show the family room", { preset: "wrong_area" }],
      ["Chairs moved upstairs", { preset: "other" }],
    ])

    await ok(submit(staffA, check, { assets: [await photo(staffA.id)] }))
    expect(await checkRow(manager, check)).toMatchObject({
      progress: "complete",
      recheck_reason: null,
    })
  })
})

describe("evidence removed and assignee left", () => {
  it("needs a recheck when the current Yes no longer meets its rule", async () => {
    const check = await addCheck(manager, venue, "accessible_parking") // both
    await ok(assign(manager, check, staffA.id))
    const p1 = await photo(staffA.id)
    const p2 = await photo(staffA.id)
    const v1 = await video(staffA.id)
    const [done] = await ok(submit(staffA, check, { assets: [p1, p2, v1] }))
    const revision = await revisionOf(check)

    // One of two photos: the rule still holds.
    await ok(staffA.client.rpc("delete_media_asset", { p_asset_id: p1 }))
    expect(await checkRow(manager, check)).toMatchObject({
      progress: "complete",
      revision,
    })

    await ok(admin.client.rpc("delete_media_asset", { p_asset_id: v1 }))
    expect(await checkRow(manager, check)).toMatchObject({
      progress: "needs_recheck",
      answer: "yes",
      recheck_reason: "Evidence was removed",
      revision: revision + 1,
      current_submission_id: done!.submission_id,
    })
    const lost = (await events(manager, check)).at(-1)
    expect(lost).toMatchObject({
      kind: "evidence_lost",
      actor_id: admin.id,
      detail: { submissionId: done!.submission_id, assetId: v1 },
    })
    const assets = await ok(
      manager.client.rpc("amenity_check_submission_assets", {
        p_check_id: check,
      })
    )
    expect(
      assets
        .map((a: { asset_id: string; available: boolean }) => [
          a.asset_id,
          a.available,
        ])
        .sort()
    ).toEqual(
      [
        [p1, false],
        [p2, true],
        [v1, false],
      ].sort()
    )

    // A No answer with evidence is not affected by deleting it.
    const other = await addCheck(manager, venue, "ev_charging")
    const extra = await photo(manager.id)
    await ok(
      submit(manager, other, { answer: "no", reason: "None", assets: [extra] })
    )
    await ok(manager.client.rpc("delete_media_asset", { p_asset_id: extra }))
    expect(await checkRow(manager, other)).toMatchObject({
      progress: "complete",
      answer: "no",
    })
  })

  it("clears the assignee who moves venue or is deactivated, keeping submissions", async () => {
    const mover = await createIdentity(service, {
      label: "amen-mover",
      role: "staff",
      venueId: venue,
    })
    const leaver = await createIdentity(service, {
      label: "amen-leaver",
      role: "staff",
      venueId: venue,
    })
    const [c1, c2] = await ok(
      manager.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: ["dog_water", "dog_treats"],
      })
    )
    await ok(assign(manager, c1!, mover.id))
    await ok(assign(manager, c2!, leaver.id))
    await ok(submit(mover, c1!, { assets: [await photo(mover.id)] }))
    await ok(reopen(manager, c1!, "conditions_changed"))

    const moved = await service
      .from("profiles")
      .update({ venue_id: otherVenue })
      .eq("id", mover.id)
    if (moved.error) throw moved.error
    const off = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", leaver.id)
    if (off.error) throw off.error

    for (const [check, who] of [
      [c1!, mover.id],
      [c2!, leaver.id],
    ] as const) {
      expect(await checkRow(manager, check)).toMatchObject({
        assignee_user_id: null,
      })
      expect((await events(manager, check)).at(-1)).toMatchObject({
        kind: "unassigned",
        actor_id: null,
        detail: { cause: "assignee_left", previousAssigneeId: who },
      })
    }
    expect(
      await ok(
        manager.client.rpc("amenity_check_submissions", { p_check_id: c1! })
      )
    ).toHaveLength(1)
    // The mover no longer reaches the check from the other venue.
    await fails(
      mover.client.rpc("amenity_check", { p_check_id: c1! }),
      "amenity_check_not_found"
    )
    expect(await ok(mover.client.rpc("amenity_my_checks"))).toEqual([])
  })
})

describe("access", () => {
  it("drops a revoked manager at once", async () => {
    const temp = await createIdentity(service, {
      label: "amen-temp-mgr",
      role: "staff",
      venueId: venue,
    })
    const grant = await grantManager(admin, temp.id, venue)
    const check = await addCheck(temp, venue, "takeaway_pickup")
    await ok(temp.client.rpc("amenity_check", { p_check_id: check }))
    await ok(
      admin.client.rpc("revoke_venue_manager", {
        p_grant_id: grant,
        p_reason: "TEST revoke",
      })
    )
    await fails(
      temp.client.rpc("amenity_checks_for_venue", {
        p_venue_id: venue,
        p_include_archived: false,
      }),
      "not_venue_manager"
    )
    await fails(
      temp.client.rpc("amenity_check", { p_check_id: check }),
      "amenity_check_not_found"
    )
    await fails(
      temp.client.rpc("amenity_add_checks", {
        p_venue_id: venue,
        p_keys: ["arcade"],
      }),
      "not_venue_manager"
    )
    await fails(
      submit(temp, check, { assets: [await photo(temp.id)] }),
      "amenity_check_not_found"
    )
    await fails(
      temp.client.rpc("amenity_venue_state", { p_venue_id: venue }),
      "not_venue_manager"
    )
  })

  it("rejects inactive accounts", async () => {
    const gone = await createIdentity(service, {
      label: "amen-gone",
      role: "admin",
      active: false,
    })
    await fails(gone.client.rpc("amenity_my_checks"), "not_active_user")
    await fails(
      gone.client.rpc("amenity_enable_venue", { p_venue_id: venue }),
      "not_active_user"
    )
  })

  it("keeps two venues apart: same key, different answers, no cross reads", async () => {
    await ok(
      admin.client.rpc("amenity_enable_venue", { p_venue_id: otherVenue })
    )
    const here = await addCheck(manager, venue, "outdoor_seating")
    const there = await addCheck(otherManager, otherVenue, "outdoor_seating")
    expect(here).not.toBe(there)
    const herePhoto = await photo(manager.id)
    await ok(submit(manager, here, { assets: [herePhoto] }))
    await ok(submit(otherManager, there, { answer: "no", reason: "No garden" }))
    expect((await checkRow(manager, here)).answer).toBe("yes")
    expect((await checkRow(otherManager, there)).answer).toBe("no")

    for (const call of [
      otherManager.client.rpc("amenity_check", { p_check_id: here }),
      otherManager.client.rpc("amenity_check_submissions", {
        p_check_id: here,
      }),
      otherManager.client.rpc("amenity_check_submission_assets", {
        p_check_id: here,
      }),
      otherManager.client.rpc("amenity_check_events", { p_check_id: here }),
      otherStaff.client.rpc("amenity_check", { p_check_id: here }),
      staffA.client.rpc("amenity_check", { p_check_id: there }),
    ]) {
      await fails(call, "amenity_check_not_found", "P0002")
    }
    await fails(
      otherManager.client.rpc("amenity_checks_for_venue", {
        p_venue_id: venue,
        p_include_archived: true,
      }),
      "not_venue_manager"
    )
    await fails(
      otherManager.client.rpc("amenity_catalogue_for_venue", {
        p_venue_id: venue,
      }),
      "not_venue_manager"
    )
    // Cross-venue writes.
    await fails(
      otherManager.client.rpc("amenity_archive_check", {
        p_check_id: here,
        p_revision: 2,
      }),
      "amenity_check_not_found"
    )
    await fails(
      submit(otherManager, there, { assets: [herePhoto] }),
      "evidence_not_eligible"
    )

    // Media gate: the venue's manager and admins, not the other venue.
    expect(
      await ok(
        manager.client.rpc("amenity_evidence_asset", { p_asset_id: herePhoto })
      )
    ).toHaveLength(1)
    expect(
      await ok(
        admin.client.rpc("amenity_evidence_asset", { p_asset_id: herePhoto })
      )
    ).toHaveLength(1)
    for (const who of [otherManager, otherStaff, staffB]) {
      expect(
        await ok(
          who.client.rpc("amenity_evidence_asset", { p_asset_id: herePhoto })
        )
      ).toEqual([])
    }
    expect(
      await ok(
        manager.client.rpc("amenity_evidence_asset", {
          p_asset_id: randomUUID(),
        })
      )
    ).toEqual([])

    // No direct table access to submissions, assets or events; checks under RLS.
    for (const table of [
      "amenity_submissions",
      "amenity_submission_assets",
      "amenity_check_events",
    ] as const) {
      const { error } = await admin.client.from(table).select("*")
      expect(error?.code, table).toBe("42501")
    }
    const visible = await ok(
      otherManager.client.from("venue_amenity_checks").select("id, venue_id")
    )
    expect(
      visible.every((c: { venue_id: string }) => c.venue_id === otherVenue)
    ).toBe(true)
    const update = await manager.client
      .from("venue_amenity_checks")
      .update({ answer: "no" } as never)
      .eq("id", here)
    expect(update.error?.code).toBe("42501")
  })

  it("opens the media gate to an asset's submitter and to own submittable assets only", async () => {
    const solo = await createIdentity(service, {
      label: "amen-solo",
      role: "staff",
      venueId: venue,
    })
    const check = await addCheck(manager, venue, "covered_seating")
    const mine = await photo(solo.id)
    const unused = await photo(solo.id)
    const elsewhere = await photo(staffB.id)
    const gate = async (who: TestIdentity, assetId: string) =>
      ok(who.client.rpc("amenity_evidence_asset", { p_asset_id: assetId }))

    // Nothing to submit yet, so not even their own uploads pass the gate.
    expect(await gate(solo, unused)).toEqual([])
    await ok(assign(manager, check, solo.id))
    expect(await gate(solo, unused)).toMatchObject([
      { asset_id: unused, media_type: "image" },
    ])
    expect(await gate(solo, elsewhere)).toEqual([])

    await ok(submit(solo, check, { assets: [mine] }))
    await ok(assign(manager, check, staffB.id))
    // Still the submitter of `mine`; `unused` is no longer submittable anywhere.
    expect(await gate(solo, mine)).toHaveLength(1)
    expect(await gate(solo, unused)).toEqual([])
    // Staff B, the new assignee, reads the history but not the other person's media.
    expect(
      await ok(
        staffB.client.rpc("amenity_check_submissions", { p_check_id: check })
      )
    ).toHaveLength(1)
    expect(await gate(staffB, mine)).toEqual([])
    expect(await gate(manager, mine)).toHaveLength(1)

    await ok(solo.client.rpc("delete_media_asset", { p_asset_id: mine }))
    expect(await gate(manager, mine)).toEqual([])
    expect(await gate(solo, mine)).toEqual([])
  })
})

describe("guest Wi-Fi", () => {
  let check: string

  beforeAll(async () => {
    check = (
      await ok(
        manager.client.rpc("amenity_checks_for_venue", {
          p_venue_id: venue,
          p_include_archived: false,
        })
      )
    ).find((c: { template_key: string }) => c.template_key === "guest_wifi")!.id
    await ok(assign(manager, check, staffA.id))
  })

  it("needs a redaction tick and valid internal test notes for Yes", async () => {
    const evidence = async () => [
      await photo(staffA.id),
      await video(staffA.id),
    ]
    await fails(
      submit(staffA, check, { assets: await evidence(), metadata: wifi() }),
      "redaction_not_confirmed"
    )
    await fails(
      submit(staffA, check, { assets: await evidence(), redaction: true }),
      "invalid_wifi_metadata"
    )
    const tomorrow = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    for (const metadata of [
      { ...wifi(), testSpot: " " },
      { ...wifi(), testSpot: "x".repeat(121) },
      { ...wifi(), testedOn: "2026-02-30" },
      { ...wifi(), testedOn: tomorrow },
      { ...wifi(), downloadMbps: "fast" },
      { ...wifi(), uploadMbps: -1 },
      { ...wifi(), uploadMbps: 10001 },
      { ...wifi(), password: "hunter2" },
      { testSpot: "Bar", testedOn: londonToday(), downloadMbps: 10 },
    ]) {
      await fails(
        submit(staffA, check, {
          assets: await evidence(),
          metadata,
          redaction: true,
        }),
        "invalid_wifi_metadata"
      )
    }
    await fails(
      submit(staffA, check, {
        assets: [await photo(staffA.id)],
        metadata: wifi(),
        redaction: true,
      }),
      "evidence_rule_unmet"
    )
    // A photo with No still needs the tick; notes are only for Wi-Fi.
    await fails(
      submit(staffA, check, {
        answer: "no",
        reason: "Down",
        assets: [await photo(staffA.id)],
      }),
      "redaction_not_confirmed"
    )
    const pool = await addCheck(manager, venue, "swimming_pool")
    await fails(
      submit(manager, pool, {
        assets: [await photo(manager.id)],
        metadata: wifi(),
      }),
      "invalid_wifi_metadata"
    )

    const [done] = await ok(
      submit(staffA, check, {
        assets: await evidence(),
        metadata: { ...wifi(), testSpot: "  Back bar " },
        redaction: true,
      })
    )
    expect(done!.replayed).toBe(false)
    expect(await checkRow(staffA, check)).toMatchObject({
      answer: "yes",
      progress: "complete",
    })
  })

  it("shows the test notes only to the submitter, the venue manager and admins", async () => {
    await ok(assign(manager, check, staffB.id))
    const notes = async (who: TestIdentity) =>
      (
        await ok(
          who.client.rpc("amenity_check_submissions", { p_check_id: check })
        )
      )[0]!.internal_metadata
    const expected = { ...wifi(), testSpot: "Back bar" }
    expect(await notes(staffA)).toEqual(expected)
    expect(await notes(manager)).toEqual(expected)
    expect(await notes(admin)).toEqual(expected)
    expect(await notes(staffB)).toBeNull()
  })
})
