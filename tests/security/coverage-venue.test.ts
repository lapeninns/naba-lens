// Venue coverage contract: amenity facts (unknown blocks confirmation,
// exclusions need reasons and leave the denominator), requirement
// configuration and revisions, menu coverage plans with explicit
// reconciliation after a menu change, and venue completion. Real identities.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  accept,
  assign,
  createRequirement,
  currentMonth,
  fails,
  legacyStaffGrant,
  ok,
  requestKey,
  requirementProgress,
  staffProgress,
  submit,
} from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  reserveReady,
  section,
} from "./menus-fixtures"

const service = serviceClient()
let venue: string
let otherVenue: string
let admin: TestIdentity
let manager: TestIdentity
let staffer: TestIdentity
let outsider: TestIdentity

async function summary(who: TestIdentity, venueId = venue) {
  const [row] = await ok(
    who.client.rpc("venue_coverage_summary", { p_venue_id: venueId })
  )
  return row!
}

async function requirementByKey(venueId: string, key: string) {
  const { data, error } = await service
    .from("coverage_requirements")
    .select("id, revision, status")
    .eq("venue_id", venueId)
    .eq("amenity_key", key)
    .neq("status", "retired")
    .single()
  if (error) throw error
  return data
}

async function setStatus(
  who: TestIdentity,
  requirementId: string,
  status: string,
  reason: string | null = null
) {
  const { data } = await service
    .from("coverage_requirements")
    .select("revision")
    .eq("id", requirementId)
    .single()
  return who.client.rpc("set_coverage_requirement_status", {
    p_requirement_id: requirementId,
    p_expected_revision: data!.revision,
    p_status: status,
    p_reason: reason as string,
  })
}

async function factRevision(venueId: string, key: string) {
  const { data } = await service
    .from("venue_amenity_facts")
    .select("revision")
    .eq("venue_id", venueId)
    .eq("amenity_key", key)
    .single()
  return data!.revision
}

beforeAll(async () => {
  venue = (await createVenue(service, "cov-venue")).id
  otherVenue = (await createVenue(service, "cov-venue-other")).id
  admin = await createIdentity(service, {
    label: "cov-venue-admin",
    role: "admin",
  })
  manager = await createIdentity(service, {
    label: "cov-venue-mgr",
    role: "staff",
    venueId: venue,
  })
  staffer = await createIdentity(service, {
    label: "cov-venue-staff",
    role: "staff",
    venueId: venue,
  })
  outsider = await createIdentity(service, {
    label: "cov-venue-outsider",
    role: "staff",
    venueId: otherVenue,
  })
  await service
    .from("profiles")
    .update({ department: "foh" })
    .in("id", [manager.id, staffer.id])
  await legacyStaffGrant(service, admin, manager.id, venue)
})

describe("amenities and template candidates", () => {
  it("adds every template once, with unknown facts", async () => {
    await fails(
      staffer.client.rpc("prepare_coverage_month", { p_venue_id: venue }),
      "not_venue_manager"
    )
    for (const added of [12, 0]) {
      const [run] = await ok(
        manager.client.rpc("prepare_coverage_month", { p_venue_id: venue })
      )
      expect(run).toMatchObject({
        status: "succeeded",
        candidates_added: added,
      })
    }
    const facts = await ok(
      staffer.client
        .from("venue_amenity_facts")
        .select("amenity_key, presence")
        .eq("venue_id", venue)
    )
    expect(facts).toHaveLength(7)
    expect(facts.every((f) => f.presence === "unknown")).toBe(true)
    const s = await summary(manager)
    expect(s).toMatchObject({
      applicable_count: 12,
      needs_setup_count: 12,
      amenity_unknown_count: 7,
      complete: false,
      menu_state: "no_menu",
    })
  })

  it("blocks confirmation while unknown and requires a confirmed presence", async () => {
    const toilets = await requirementByKey(venue, "toilets")
    await fails(
      setStatus(manager, toilets.id, "active"),
      "amenity_unconfirmed",
      "P0001"
    )
    await fails(
      manager.client.rpc("set_amenity_fact", {
        p_venue_id: venue,
        p_amenity_key: "toilets",
        p_expected_revision: 1,
        p_presence: "unknown",
        p_facts: null as unknown as string,
        p_policy: null as unknown as string,
        p_confirm: true,
      }),
      "amenity_unknown",
      "P0001"
    )
    const foreign = await reserveReady(service, outsider)
    await fails(
      manager.client.rpc("set_amenity_fact", {
        p_venue_id: venue,
        p_amenity_key: "toilets",
        p_expected_revision: 1,
        p_presence: "present",
        p_facts: "Two guest toilets",
        p_policy: null as unknown as string,
        p_confirm: true,
        p_asset_ids: [foreign.id],
      }),
      "media_asset_not_found"
    )
    const support = await reserveReady(service, staffer)
    const [saved] = await ok(
      manager.client.rpc("set_amenity_fact", {
        p_venue_id: venue,
        p_amenity_key: "toilets",
        p_expected_revision: 1,
        p_presence: "present",
        p_facts: "Two guest toilets",
        p_policy: null as unknown as string,
        p_confirm: true,
        p_asset_ids: [support.id],
      })
    )
    expect(saved!.revision).toBe(2)
    const [retry] = await ok(
      manager.client.rpc("set_amenity_fact", {
        p_venue_id: venue,
        p_amenity_key: "toilets",
        p_expected_revision: 2,
        p_presence: "present",
        p_facts: "Two guest toilets",
        p_policy: null as unknown as string,
        p_confirm: true,
        p_asset_ids: [support.id],
      })
    )
    expect(retry!.revision).toBe(2)
    const [evidence] = await ok(
      manager.client.rpc("task_evidence_asset", { p_asset_id: support.id })
    )
    expect(evidence!.asset_id).toBe(support.id)
    await ok(setStatus(manager, toilets.id, "active"))
    expect((await requirementByKey(venue, "toilets")).status).toBe("active")
  })

  it("needs reasons for exclusions, which leave the denominator but stay listed", async () => {
    const parking = await requirementByKey(venue, "parking")
    await fails(
      setStatus(manager, parking.id, "not_applicable"),
      "reason_required",
      "22023"
    )
    await ok(
      setStatus(manager, parking.id, "not_applicable", "TEST no car park")
    )
    const rows = await requirementProgress(staffer, venue)
    expect(rows.find((r) => r.requirement_id === parking.id)).toMatchObject({
      status: "not_applicable",
      status_reason: "TEST no car park",
      is_current: false,
    })
    const s = await summary(manager)
    expect(s).toMatchObject({ applicable_count: 11, not_applicable_count: 1 })
  })

  it("returns an amenity requirement to setup when its fact is no longer present", async () => {
    await ok(
      manager.client.rpc("set_amenity_fact", {
        p_venue_id: venue,
        p_amenity_key: "toilets",
        p_expected_revision: await factRevision(venue, "toilets"),
        p_presence: "unknown",
        p_facts: null as unknown as string,
        p_policy: null as unknown as string,
        p_confirm: false,
      })
    )
    const toilets = await requirementByKey(venue, "toilets")
    expect(toilets.status).toBe("needs_setup")
    const { data: fact } = await service
      .from("venue_amenity_facts")
      .select("confirmed_at")
      .eq("venue_id", venue)
      .eq("amenity_key", "toilets")
      .single()
    expect(fact!.confirmed_at).toBeNull()
  })
})

describe("requirement configuration", () => {
  it("uses revisions, keeps retired requirements closed and validates input", async () => {
    const id = await createRequirement(manager, venue, {
      title: "TEST beer garden sunset",
      photoTarget: 2,
    })
    const save = (revision: number, title: string, target = 2) =>
      manager.client.rpc("save_coverage_requirement", {
        p_venue_id: venue,
        p_requirement_id: id,
        p_expected_revision: revision,
        p_kind: null as unknown as string,
        p_title: title,
        p_guidance: "Golden hour" as string,
        p_photo_target: target,
        p_due_on: null as unknown as string,
      })
    const [saved] = await ok(save(1, "TEST garden sunset"))
    expect(saved!.revision).toBe(2)
    await fails(save(1, "stale"), "coverage_conflict", "40001")
    await fails(
      save(2, "TEST garden sunset", 0),
      "invalid_photo_target",
      "22023"
    )
    await fails(save(2, " "), "invalid_title", "22023")
    await fails(
      manager.client.rpc("save_coverage_requirement", {
        p_venue_id: venue,
        p_requirement_id: null as unknown as string,
        p_expected_revision: null as unknown as number,
        p_kind: "menu_section",
        p_title: "sneaky",
        p_guidance: null as unknown as string,
        p_photo_target: 1,
        p_due_on: null as unknown as string,
      }),
      "invalid_kind"
    )
    await fails(
      staffer.client.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: id,
        p_staff_ids: [staffer.id],
      }),
      "coverage_requirement_not_found"
    )
    const assigned = await ok(
      manager.client.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: id,
        p_staff_ids: [staffer.id, manager.id],
      })
    )
    expect(assigned.map((a) => a.staff_id).sort()).toEqual(
      [staffer.id, manager.id].sort()
    )
    const own = await ok(
      staffer.client.from("coverage_requirement_assignees").select("staff_id")
    )
    expect(own.map((a) => a.staff_id)).toEqual([staffer.id])

    await ok(setStatus(manager, id, "retired", "TEST season over"))
    await fails(save(3, "again"), "requirement_closed", "P0001")
    const { data: ended } = await service
      .from("coverage_requirement_assignees")
      .select("end_kind")
      .eq("requirement_id", id)
    expect(ended!.every((a) => a.end_kind === "requirement_closed")).toBe(true)
  })

  it("replays a keyed create once, says so, and refuses a reused key", async () => {
    const title = `TEST keyed ${requestKey()}`
    const create = (who: TestIdentity, key: string, t = title) =>
      who.client.rpc("save_coverage_requirement", {
        p_venue_id: venue,
        p_requirement_id: null as unknown as string,
        p_expected_revision: null as unknown as number,
        p_kind: "venue_specific",
        p_title: t,
        p_guidance: null as unknown as string,
        p_photo_target: 2,
        p_due_on: null as unknown as string,
        p_client_request_key: key,
      })
    const update = (revision: number, key: string) =>
      manager.client.rpc("save_coverage_requirement", {
        p_venue_id: venue,
        p_requirement_id: id,
        p_expected_revision: revision,
        p_kind: null as unknown as string,
        p_title: title,
        p_guidance: "TEST more light",
        p_photo_target: 2,
        p_due_on: null as unknown as string,
        p_client_request_key: key,
      })
    const rows = async (t = title) => {
      const { data, error } = await service
        .from("coverage_requirements")
        .select("id, created_by")
        .eq("venue_id", venue)
        .eq("title", t)
      if (error) throw error
      return data
    }

    const key = requestKey()
    // Three racing submits: one creates; the two that waited on the key's
    // lock replay it and say so.
    const results = await Promise.all(
      [1, 2, 3].map(() => ok(create(manager, key)))
    )
    const id = results[0][0]!.requirement_id
    for (const [r] of results)
      expect(r).toMatchObject({ requirement_id: id, revision: 1 })
    expect(results.map(([r]) => r!.replayed).sort()).toEqual([
      false,
      true,
      true,
    ])
    expect(await rows()).toEqual([{ id, created_by: manager.id }])
    const { count: created } = await service
      .from("coverage_audit_events")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", id)
      .eq("action", "created")
    expect(created).toBe(1)
    const [again] = await ok(create(manager, key))
    expect(again).toEqual({ requirement_id: id, revision: 1, replayed: true })

    await fails(
      create(manager, key, `${title} other`),
      "idempotency_key_reused",
      "22023"
    )
    expect(await rows(`${title} other`)).toEqual([])
    await fails(create(manager, "short"), "invalid_request_key", "22023")

    // Updates keep the revision check; the key does not replace it.
    await fails(update(2, requestKey()), "coverage_conflict", "40001")
    const [updated] = await ok(update(1, key))
    expect(updated).toEqual({
      requirement_id: id,
      revision: 2,
      replayed: false,
    })
    // An identical update is a no-op, not a replay.
    const [same] = await ok(update(2, key))
    expect(same).toEqual({ requirement_id: id, revision: 2, replayed: false })
    // A late retry still returns the create's own result and adds nothing.
    const [late] = await ok(create(manager, key))
    expect(late).toEqual({ requirement_id: id, revision: 1, replayed: true })
    expect(await rows()).toHaveLength(1)

    // Keys belong to one person: the same key from an admin is a new request.
    const [other] = await ok(create(admin, key))
    expect(other).toMatchObject({ revision: 1, replayed: false })
    expect(other!.requirement_id).not.toBe(id)
    expect((await rows()).map((r) => r.created_by).sort()).toEqual(
      [manager.id, admin.id].sort()
    )

    const { error } = await service
      .from("coverage_requirements")
      .update({ client_request_key: requestKey(), revision: 3 })
      .eq("id", id)
    expect(error?.message).toBe("coverage_requirement_identity_immutable")
  })
})

describe("menu coverage", () => {
  let v1: string
  let plan1: string
  let oldStarters: string
  let oldMains: string

  beforeAll(async () => {
    v1 = await publishMenu(
      admin,
      venue,
      menu("TEST Menu v1", [
        section("starters", "Starters", [
          item("soup", "Soup"),
          item("bread", "Bread"),
        ]),
        section("mains", "Mains", [item("pie", "Pie")]),
      ])
    )
  })

  it("builds a plan from the active version, configured by the venue manager", async () => {
    expect((await summary(manager)).menu_state).toBe("needs_setup")
    await fails(
      staffer.client.rpc("start_menu_coverage_plan", {
        p_venue_id: venue,
        p_menu_version_id: v1,
      }),
      "not_venue_manager"
    )
    const [started] = await ok(
      manager.client.rpc("start_menu_coverage_plan", {
        p_venue_id: venue,
        p_menu_version_id: v1,
      })
    )
    expect(started).toMatchObject({ created: true, revision: 1 })
    plan1 = started!.plan_id
    const [again] = await ok(
      manager.client.rpc("start_menu_coverage_plan", {
        p_venue_id: venue,
        p_menu_version_id: v1,
      })
    )
    expect(again).toMatchObject({ plan_id: plan1, created: false })

    const { data: reqs } = await service
      .from("coverage_requirements")
      .select("id, title, status, section_snapshot, menu_version_id")
      .eq("menu_plan_id", plan1)
      .order("title")
    expect(reqs!.map((r) => [r.title, r.status])).toEqual([
      ["Mains", "needs_setup"],
      ["Starters", "needs_setup"],
    ])
    expect(reqs![1]!.section_snapshot).toMatchObject({
      name: "Starters",
      slug: "starters",
      itemCount: 2,
    })
    oldMains = reqs![0]!.id
    oldStarters = reqs![1]!.id

    await fails(
      manager.client.rpc("confirm_menu_coverage_plan", {
        p_plan_id: plan1,
        p_expected_revision: 1,
      }),
      "plan_incomplete",
      "P0001"
    )
    await ok(setStatus(manager, oldStarters, "active"))
    await ok(
      setStatus(manager, oldMains, "not_applicable", "TEST mains change daily")
    )
    const [confirmed] = await ok(
      manager.client.rpc("confirm_menu_coverage_plan", {
        p_plan_id: plan1,
        p_expected_revision: 1,
      })
    )
    expect(confirmed).toMatchObject({
      reconciliation_required: false,
      auto_retired: 0,
    })
    expect((await summary(manager)).menu_state).toBe("current")
    expect(
      await ok(
        outsider.client.from("menu_coverage_plans").select("id").eq("id", plan1)
      )
    ).toEqual([])
  })

  it("completes a section by accepted photo count, not by dish", async () => {
    const { data: r } = await service
      .from("coverage_requirements")
      .select("revision")
      .eq("id", oldStarters)
      .single()
    await ok(
      manager.client.rpc("save_coverage_requirement", {
        p_venue_id: venue,
        p_requirement_id: oldStarters,
        p_expected_revision: r!.revision,
        p_kind: "menu_section",
        p_title: "Starters",
        p_guidance: null as unknown as string,
        p_photo_target: 2,
        p_due_on: null as unknown as string,
      })
    )
    const photos = [
      await reserveReady(service, staffer),
      await reserveReady(service, staffer),
    ]
    await assign(manager, oldStarters, [staffer.id])
    const items = await submit(
      staffer,
      photos.map((p) => p.id),
      oldStarters
    )
    for (const i of items) await accept(service, manager, i.item_id)
    const [row] = (await requirementProgress(manager, venue)).filter(
      (x) => x.requirement_id === oldStarters
    )
    expect(row).toMatchObject({
      accepted_count: 2,
      photo_target: 2,
      satisfied: true,
    })
  })

  it("requires explicit reconciliation after a new menu, never mapping by name", async () => {
    const v2 = await publishMenu(
      admin,
      venue,
      menu("TEST Menu v2", [
        section("starters", "Starters", [item("soup", "Soup")]),
        section("mains", "Mains", [item("pie", "Pie")]),
      ])
    )
    expect((await summary(manager)).menu_state).toBe("menu_changed")
    await fails(
      manager.client.rpc("start_menu_coverage_plan", {
        p_venue_id: venue,
        p_menu_version_id: v1,
      }),
      "menu_version_not_active"
    )
    const [started] = await ok(
      manager.client.rpc("start_menu_coverage_plan", {
        p_venue_id: venue,
        p_menu_version_id: v2,
      })
    )
    const plan2 = started!.plan_id
    const { data: fresh } = await service
      .from("coverage_requirements")
      .select("id, title, menu_section_id")
      .eq("menu_plan_id", plan2)
      .order("title")
    const newStarters = fresh!.find((r) => r.title === "Starters")!.id
    const newMains = fresh!.find((r) => r.title === "Mains")!.id
    const { data: oldSection } = await service
      .from("coverage_requirements")
      .select("menu_section_id")
      .eq("id", oldStarters)
      .single()
    expect(fresh!.find((r) => r.id === newStarters)!.menu_section_id).not.toBe(
      oldSection!.menu_section_id
    )

    await ok(setStatus(manager, newStarters, "active"))
    await ok(setStatus(manager, newMains, "not_applicable", "TEST still daily"))
    const { data: p2 } = await service
      .from("menu_coverage_plans")
      .select("revision")
      .eq("id", plan2)
      .single()
    const [confirmed] = await ok(
      manager.client.rpc("confirm_menu_coverage_plan", {
        p_plan_id: plan2,
        p_expected_revision: p2!.revision,
      })
    )
    expect(confirmed).toMatchObject({
      reconciliation_required: true,
      auto_retired: 1,
    })
    let s = await summary(manager)
    expect(s).toMatchObject({
      menu_state: "reconciliation_pending",
      pending_reconciliation_count: 1,
      complete: false,
    })
    const [newRow] = (await requirementProgress(manager, venue)).filter(
      (x) => x.requirement_id === newStarters
    )
    expect(newRow).toMatchObject({ accepted_count: 0, satisfied: false })

    const late = await reserveReady(service, staffer)
    await fails(
      staffer.client.rpc("submit_coverage_photos", {
        p_asset_ids: [late.id],
        p_requirement_id: oldStarters,
        p_client_request_key: requestKey(),
      }),
      "requirement_not_open"
    )
    await fails(
      manager.client.rpc("reconcile_menu_requirement", {
        p_old_requirement_id: oldStarters,
        p_target_requirement_id: newStarters,
        p_item_ids: null as unknown as string[],
        p_reason: "",
      }),
      "reason_required"
    )
    const [result] = await ok(
      manager.client.rpc("reconcile_menu_requirement", {
        p_old_requirement_id: oldStarters,
        p_target_requirement_id: newStarters,
        p_item_ids: null as unknown as string[],
        p_reason: "TEST same starters photos still apply",
      })
    )
    expect(result).toEqual({ carried: 2, reconciliation_complete: true })
    s = await summary(manager)
    expect(s.menu_state).toBe("current")
    const [carried] = (await requirementProgress(manager, venue)).filter(
      (x) => x.requirement_id === newStarters
    )
    expect(carried).toMatchObject({ accepted_count: 2, satisfied: true })

    const { data: old } = await service
      .from("coverage_requirements")
      .select("status, retire_kind, replaced_by_requirement_id")
      .eq("id", oldStarters)
      .single()
    expect(old).toEqual({
      status: "retired",
      retire_kind: "reconciled",
      replaced_by_requirement_id: newStarters,
    })
    const { data: oldItems } = await service
      .from("coverage_submission_items")
      .select("archive_kind, state")
      .eq("requirement_id", oldStarters)
    expect(
      oldItems!.every(
        (i) => i.archive_kind === "reconciled" && i.state === "accepted"
      )
    ).toBe(true)
    const { data: newItems } = await service
      .from("coverage_submission_items")
      .select("origin")
      .eq("requirement_id", newStarters)
    expect(newItems!.map((i) => i.origin)).toEqual(["reconciled", "reconciled"])
    // Carrying evidence adds no monthly credit.
    const [me] = await staffProgress(staffer, venue, currentMonth())
    expect(me!.accepted_count).toBe(2)
    await fails(
      manager.client.rpc("reconcile_menu_requirement", {
        p_old_requirement_id: oldStarters,
        p_target_requirement_id: newStarters,
        p_item_ids: null as unknown as string[],
        p_reason: "again",
      }),
      "plan_not_superseded"
    )
  })

  it("discards a draft plan without touching the confirmed one", async () => {
    const v3 = await publishMenu(
      admin,
      venue,
      menu("TEST Menu v3", [
        section("sides", "Sides", [item("chips", "Chips")]),
      ])
    )
    const [draft] = await ok(
      manager.client.rpc("start_menu_coverage_plan", {
        p_venue_id: venue,
        p_menu_version_id: v3,
      })
    )
    await ok(
      manager.client.rpc("discard_menu_coverage_plan", {
        p_plan_id: draft!.plan_id,
        p_expected_revision: 1,
      })
    )
    const { data: plans } = await service
      .from("menu_coverage_plans")
      .select("status")
      .eq("venue_id", venue)
      .order("created_at")
    expect(plans!.map((p) => p.status)).toEqual([
      "superseded",
      "confirmed",
      "discarded",
    ])
    expect((await summary(manager)).menu_state).toBe("menu_changed")
  })
})

describe("venue completion", () => {
  it("needs every applicable requirement satisfied and nothing left to set up", async () => {
    const w = (await createVenue(service, "cov-venue-complete")).id
    const m = await createIdentity(service, {
      label: "cov-complete-mgr",
      role: "staff",
      venueId: w,
    })
    await legacyStaffGrant(service, admin, m.id, w)
    expect(await summary(m, w)).toMatchObject({
      applicable_count: 0,
      complete: false,
    })
    const requirement = await createRequirement(m, w, {
      title: "TEST frontage",
      photoTarget: 1,
    })
    expect(await summary(m, w)).toMatchObject({
      applicable_count: 1,
      satisfied_count: 0,
      complete: false,
    })
    const photo = await reserveReady(service, m)
    await assign(m, requirement, [m.id])
    const [i] = await submit(m, [photo.id], requirement)
    expect(await summary(m, w)).toMatchObject({ pending_review_count: 1 })
    await accept(service, m, i!.item_id)
    expect(await summary(m, w)).toMatchObject({
      applicable_count: 1,
      satisfied_count: 1,
      complete: true,
      menu_state: "no_menu",
    })
    await ok(m.client.rpc("prepare_coverage_month", { p_venue_id: w }))
    expect(await summary(m, w)).toMatchObject({
      complete: false,
      needs_setup_count: 12,
    })
    const all = await ok(admin.client.rpc("venue_coverage_summary", {}))
    expect(all.some((row) => row.venue_id === w)).toBe(true)
  })
})
