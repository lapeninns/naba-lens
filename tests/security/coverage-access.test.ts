// Coverage database access contract: manager grants (effective rule,
// revocation, transfer, deactivation on existing sessions), RLS on every
// coverage table, no direct end-user writes, wrong-venue ids and the narrow
// roster projection. Real signed-in identities throughout.
import { randomUUID } from "node:crypto"

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
  grantManager,
  legacyStaffGrant,
  makeManager,
  insertAsset,
  ok,
  requestKey,
  requirementProgress,
  staffProgress,
  submit,
} from "./coverage-fixtures"
import { reserveReady } from "./menus-fixtures"

const service = serviceClient()
let venueA: string
let venueB: string
let venueC: string
let admin: TestIdentity
let managerA: TestIdentity
let managerB: TestIdentity
let staffA1: TestIdentity
let staffA2: TestIdentity
let staffB1: TestIdentity

async function staff(label: string, venueId: string) {
  return createIdentity(service, { label, role: "staff", venueId })
}

async function setProfile(
  id: string,
  patch: { venue_id?: string; active?: boolean; department?: string }
) {
  const { error } = await service.from("profiles").update(patch).eq("id", id)
  if (error) throw error
}

beforeAll(async () => {
  venueA = (await createVenue(service, "cov-acc-a")).id
  venueB = (await createVenue(service, "cov-acc-b")).id
  venueC = (await createVenue(service, "cov-acc-c")).id
  admin = await createIdentity(service, {
    label: "cov-acc-admin",
    role: "admin",
  })
  managerA = await staff("cov-acc-mgr-a", venueA)
  managerB = await staff("cov-acc-mgr-b", venueB)
  staffA1 = await staff("cov-acc-a1", venueA)
  staffA2 = await staff("cov-acc-a2", venueA)
  staffB1 = await staff("cov-acc-b1", venueB)
  // Staff-held grants made before manager accounts existed: still effective
  // (transitional rule), and the only managers allowed to write coverage.
  await legacyStaffGrant(service, admin, managerA.id, venueA)
  await legacyStaffGrant(service, admin, managerB.id, venueB)
})

describe("manager grants", () => {
  it("are admin-only and idempotent", async () => {
    for (const caller of [staffA1, managerA]) {
      await fails(
        caller.client.rpc("grant_venue_manager", {
          p_staff_id: staffA1.id,
          p_venue_id: venueA,
        }),
        "not_active_admin",
        "42501"
      )
    }
    const converted = await staff("cov-acc-idem", venueA)
    const first = await makeManager(admin, converted, venueA)
    const again = await grantManager(admin, converted.id, venueA)
    expect(again).toBe(first)
    const { count } = await service
      .from("venue_manager_grants")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", converted.id)
      .is("revoked_at", null)
    expect(count).toBe(1)
  })

  it("only go to active manager accounts currently assigned to the venue", async () => {
    await fails(
      admin.client.rpc("grant_venue_manager", {
        p_staff_id: staffA1.id,
        p_venue_id: venueA,
      }),
      "staff_not_eligible",
      "P0001"
    )
    await fails(
      admin.client.rpc("grant_venue_manager", {
        p_staff_id: staffB1.id,
        p_venue_id: venueA,
      }),
      "staff_not_eligible",
      "P0001"
    )
    await fails(
      admin.client.rpc("grant_venue_manager", {
        p_staff_id: admin.id,
        p_venue_id: venueA,
      }),
      "staff_not_eligible"
    )
    await fails(
      admin.client.rpc("grant_venue_manager", {
        p_staff_id: randomUUID(),
        p_venue_id: venueA,
      }),
      "staff_not_found",
      "P0002"
    )
  })

  it("report the caller's scope from the database", async () => {
    const [mgr] = await ok(managerA.client.rpc("coverage_access_scope"))
    expect(mgr).toMatchObject({
      user_id: managerA.id,
      role: "staff",
      venue_id: venueA,
      is_admin: false,
      manager_venue_id: venueA,
    })
    const [plain] = await ok(staffA1.client.rpc("coverage_access_scope"))
    expect(plain).toMatchObject({
      manager_venue_id: null,
      manager_grant_id: null,
    })
    const [adm] = await ok(admin.client.rpc("coverage_access_scope"))
    expect(adm).toMatchObject({ is_admin: true, manager_venue_id: null })
  })

  it("are readable by admins and by the person only", async () => {
    const own = await ok(
      managerA.client.from("venue_manager_grants").select("staff_id")
    )
    expect(own.map((g) => g.staff_id)).toEqual([managerA.id])
    expect(
      await ok(staffA1.client.from("venue_manager_grants").select("id"))
    ).toEqual([])
    const all = await ok(
      admin.client.from("venue_manager_grants").select("staff_id")
    )
    expect(all.map((g) => g.staff_id)).toEqual(
      expect.arrayContaining([managerA.id, managerB.id])
    )
    const list = await ok(
      admin.client.rpc("venue_manager_grant_list", { p_venue_id: venueA })
    )
    expect(list.find((g) => g.staff_id === managerA.id)).toMatchObject({
      effective: true,
      venue_id: venueA,
    })
    expect(Object.keys(list[0]!).some((k) => /mail|auth|phone/i.test(k))).toBe(
      false
    )
    await fails(
      managerA.client.rpc("venue_manager_grant_list", {}),
      "not_active_admin",
      "42501"
    )
  })

  it("cannot be written directly by anyone signed in", async () => {
    const insert = await admin.client.from("venue_manager_grants").insert({
      staff_id: staffA1.id,
      venue_id: venueA,
      granted_by: admin.id,
    })
    expect(insert.error).not.toBeNull()
    const update = await admin.client
      .from("venue_manager_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("staff_id", managerA.id)
      .select()
    expect(update.error ?? update.data?.length === 0).toBeTruthy()
    const { count } = await service
      .from("venue_manager_grants")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", managerA.id)
      .is("revoked_at", null)
    expect(count).toBe(1)
  })

  it("revocation applies to an existing manager session immediately", async () => {
    const m = await staff("cov-acc-revoke", venueA)
    const grantId = await makeManager(admin, m, venueA)
    await ok(m.client.rpc("coverage_items_page", { p_venue_id: venueA }))
    await fails(
      admin.client.rpc("revoke_venue_manager", {
        p_grant_id: grantId,
        p_reason: " ",
      }),
      "reason_required",
      "22023"
    )
    await ok(
      admin.client.rpc("revoke_venue_manager", {
        p_grant_id: grantId,
        p_reason: "TEST revoke",
      })
    )
    await ok(
      admin.client.rpc("revoke_venue_manager", {
        p_grant_id: grantId,
        p_reason: "TEST again",
      })
    )
    await fails(
      m.client.rpc("coverage_items_page", { p_venue_id: venueA }),
      "not_venue_manager",
      "42501"
    )
    const { data: audit } = await service
      .from("coverage_audit_events")
      .select("action")
      .eq("entity_id", grantId)
      .order("id")
    expect(audit!.map((a) => a.action)).toEqual(["granted", "revoked"])
  })

  it("a transfer revokes the grant and moving back does not restore it", async () => {
    const m = await staff("cov-acc-transfer", venueA)
    const grantId = await makeManager(admin, m, venueA)
    await setProfile(m.id, { venue_id: venueC })
    await fails(
      m.client.rpc("coverage_items_page", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    await fails(
      m.client.rpc("coverage_items_page", { p_venue_id: venueC }),
      "not_venue_manager"
    )
    await setProfile(m.id, { venue_id: venueA })
    await fails(
      m.client.rpc("coverage_items_page", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    const { data: grant } = await service
      .from("venue_manager_grants")
      .select("revoke_kind, revoked_at")
      .eq("id", grantId)
      .single()
    expect(grant).toMatchObject({ revoke_kind: "venue_changed" })
    const [scope] = await ok(m.client.rpc("coverage_access_scope"))
    expect(scope!.manager_venue_id).toBeNull()
  })

  it("deactivation revokes the grant and ends the existing session's access", async () => {
    const m = await staff("cov-acc-deactivate", venueA)
    const grantId = await makeManager(admin, m, venueA)
    await setProfile(m.id, { active: false })
    await fails(
      m.client.rpc("coverage_items_page", { p_venue_id: venueA }),
      "not_active_user",
      "42501"
    )
    const { data: grant } = await service
      .from("venue_manager_grants")
      .select("revoke_kind")
      .eq("id", grantId)
      .single()
    expect(grant!.revoke_kind).toBe("deactivated")
  })

  it("is ineffective while the venue is inactive", async () => {
    const venueD = (await createVenue(service, "cov-acc-d")).id
    const m = await staff("cov-acc-inactive-venue", venueD)
    await makeManager(admin, m, venueD)
    await ok(m.client.rpc("coverage_items_page", { p_venue_id: venueD }))
    await service.from("venues").update({ active: false }).eq("id", venueD)
    await fails(
      m.client.rpc("coverage_items_page", { p_venue_id: venueD }),
      "not_venue_manager"
    )
    await service.from("venues").update({ active: true }).eq("id", venueD)
    await ok(m.client.rpc("coverage_items_page", { p_venue_id: venueD }))
  })
})

describe("coverage tables", () => {
  const tables = [
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
    "coverage_audit_events",
  ] as const

  it("accept no direct insert, update or delete from any signed-in role", async () => {
    for (const who of [admin, managerA, staffA1]) {
      for (const table of tables) {
        const insert = await who.client.from(table).insert({} as never)
        expect(insert.error, `${table} insert`).not.toBeNull()
        expect(insert.error!.code, `${table} insert`).toBe("42501")
        const column =
          table === "coverage_amenity_templates"
            ? "key"
            : table === "venue_amenity_fact_media"
              ? "asset_id"
              : "id"
        const del = await who.client
          .from(table)
          .delete()
          .not(column as never, "is", null)
        expect(del.error?.code, `${table} delete`).toBe("42501")
      }
      const update = await who.client
        .from("monthly_targets")
        .update({ target_count: 99 })
        .eq("venue_id", venueA)
      expect(update.error?.code).toBe("42501")
    }
  })

  it("show personal records to the person, their venue manager and admins only", async () => {
    await ok(
      managerA.client.rpc("set_monthly_target", {
        p_staff_id: staffA1.id,
        p_venue_id: venueA,
        p_period_month: currentMonth(),
        p_target_count: 3,
      })
    )
    const asset = await reserveReady(service, staffA1)
    const [item] = await submit(staffA1, [asset.id])

    const visible = async (who: TestIdentity) => ({
      targets: (
        await ok(
          who.client
            .from("monthly_targets")
            .select("id")
            .eq("staff_id", staffA1.id)
        )
      ).length,
      items: (
        await ok(
          who.client
            .from("coverage_submission_items")
            .select("id")
            .eq("id", item!.item_id)
        )
      ).length,
      events: (
        await ok(
          who.client
            .from("coverage_review_events")
            .select("id")
            .eq("item_id", item!.item_id)
        )
      ).length,
      submissions: (
        await ok(
          who.client
            .from("coverage_submissions")
            .select("id")
            .eq("submitted_by", staffA1.id)
        )
      ).length,
    })
    expect(await visible(staffA1)).toEqual({
      targets: 1,
      items: 1,
      events: 1,
      submissions: 1,
    })
    expect(await visible(managerA)).toEqual({
      targets: 1,
      items: 1,
      events: 1,
      submissions: 1,
    })
    expect(await visible(admin)).toEqual({
      targets: 1,
      items: 1,
      events: 1,
      submissions: 1,
    })
    for (const other of [staffA2, managerB, staffB1]) {
      expect(await visible(other)).toEqual({
        targets: 0,
        items: 0,
        events: 0,
        submissions: 0,
      })
    }
  })

  it("show venue configuration to that venue's staff and admins only", async () => {
    const requirement = await createRequirement(managerA, venueA, {
      title: "TEST venue-visible",
    })
    const sees = async (who: TestIdentity) =>
      (
        await ok(
          who.client
            .from("coverage_requirements")
            .select("id")
            .eq("id", requirement)
        )
      ).length
    expect(await sees(staffA2)).toBe(1)
    expect(await sees(admin)).toBe(1)
    expect(await sees(staffB1)).toBe(0)
    expect(await sees(managerB)).toBe(0)
    const audit = await ok(
      managerB.client
        .from("coverage_audit_events")
        .select("id")
        .eq("entity_id", requirement)
    )
    expect(audit).toEqual([])
    expect(
      (
        await ok(
          managerA.client
            .from("coverage_audit_events")
            .select("id")
            .eq("entity_id", requirement)
        )
      ).length
    ).toBe(1)
  })
})

describe("wrong-venue ids", () => {
  let requirementA: string
  let requirementB: string
  let itemB: string
  let assetB: string

  beforeAll(async () => {
    requirementA = await createRequirement(managerA, venueA, {
      title: "TEST wrong-venue A",
    })
    requirementB = await createRequirement(managerB, venueB, {
      title: "TEST wrong-venue B",
    })
    assetB = (await reserveReady(service, staffB1)).id
    await assign(managerB, requirementB, [staffB1.id])
    itemB = (await submit(staffB1, [assetB], requirementB))[0]!.item_id
  })

  it("fail through every mutation as not found or not permitted", async () => {
    await fails(
      managerA.client.rpc("set_coverage_requirement_status", {
        p_requirement_id: requirementB,
        p_expected_revision: 1,
        p_status: "not_applicable",
        p_reason: "x",
      }),
      "coverage_requirement_not_found",
      "P0002"
    )
    await fails(
      managerA.client.rpc("save_coverage_requirement", {
        p_venue_id: venueA,
        p_requirement_id: requirementB,
        p_expected_revision: 1,
        p_kind: "venue_specific",
        p_title: "hijack",
        p_guidance: null as unknown as string,
        p_photo_target: 1,
        p_due_on: null as unknown as string,
      }),
      "coverage_requirement_not_found"
    )
    await fails(
      managerA.client.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: requirementA,
        p_staff_ids: [staffB1.id],
      }),
      "staff_not_eligible"
    )
    await fails(
      staffA1.client.rpc("submit_coverage_photos", {
        p_asset_ids: [(await reserveReady(service, staffA1)).id],
        p_requirement_id: requirementB,
        p_client_request_key: requestKey(),
      }),
      "coverage_requirement_not_found"
    )
    await fails(
      staffA1.client.rpc("submit_coverage_photos", {
        p_asset_ids: [assetB],
        p_client_request_key: requestKey(),
      }),
      "media_asset_not_found"
    )
    await fails(
      managerA.client.rpc("attach_coverage_evidence", {
        p_requirement_id: requirementA,
        p_asset_ids: [assetB],
        p_client_request_key: requestKey(),
      }),
      "media_asset_not_found"
    )
    await fails(
      managerA.client.rpc("review_coverage_item", {
        p_item_id: itemB,
        p_expected_revision: 1,
        p_decision: "accepted",
      }),
      "coverage_item_not_found",
      "P0002"
    )
    await fails(
      managerA.client.rpc("set_monthly_target", {
        p_staff_id: staffB1.id,
        p_venue_id: venueB,
        p_period_month: currentMonth(),
        p_target_count: 2,
      }),
      "not_venue_manager",
      "42501"
    )
    await fails(
      managerA.client.rpc("set_monthly_target", {
        p_staff_id: staffB1.id,
        p_venue_id: venueA,
        p_period_month: currentMonth(),
        p_target_count: 2,
      }),
      "staff_not_eligible"
    )
    await fails(
      managerA.client.rpc("prepare_coverage_month", { p_venue_id: venueB }),
      "not_venue_manager"
    )
  })

  it("return nothing through reads", async () => {
    await fails(
      managerA.client.rpc("coverage_items_page", { p_venue_id: venueB }),
      "not_venue_manager"
    )
    await fails(
      managerA.client.rpc("venue_coverage_summary", { p_venue_id: venueB }),
      "not_venue_manager"
    )
    await fails(
      managerA.client.rpc("coverage_requirement_progress", {
        p_venue_id: venueB,
      }),
      "not_venue_manager"
    )
    const roster = await staffProgress(managerA, venueB, currentMonth())
    expect(roster.filter((r) => r.staff_id !== managerA.id)).toEqual([])
    expect(
      await ok(
        managerA.client.rpc("task_evidence_asset", { p_asset_id: assetB })
      )
    ).toEqual([])
    expect(
      await ok(
        staffA1.client.rpc("task_evidence_asset", { p_asset_id: assetB })
      )
    ).toEqual([])
    const [own] = await ok(
      managerB.client.rpc("task_evidence_asset", { p_asset_id: assetB })
    )
    expect(own).toMatchObject({
      asset_id: assetB,
      venue_id: venueB,
      has_preview: false,
    })
    expect(Object.keys(own!)).not.toContain("preview_path")
  })
})

describe("transfer and deactivation", () => {
  it("close assignments, block old-venue submissions and keep past credit", async () => {
    const mover = await staff("cov-acc-mover", venueA)
    await setProfile(mover.id, { department: "foh" })
    const requirement = await createRequirement(managerA, venueA, {
      title: "TEST mover",
      photoTarget: 2,
    })
    await ok(
      managerA.client.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: requirement,
        p_staff_ids: [mover.id],
      })
    )
    await ok(
      managerA.client.rpc("set_monthly_target", {
        p_staff_id: mover.id,
        p_venue_id: venueA,
        p_period_month: currentMonth(),
        p_target_count: 1,
      })
    )
    const accepted = await reserveReady(service, mover)
    const [item] = await submit(mover, [accepted.id], requirement)
    await accept(service, managerA, item!.item_id)
    const later = await reserveReady(service, mover)

    await setProfile(mover.id, { venue_id: venueC })

    const { data: assignment } = await service
      .from("coverage_requirement_assignees")
      .select("end_kind, end_reason, ended_at")
      .eq("requirement_id", requirement)
      .eq("staff_id", mover.id)
      .single()
    expect(assignment).toMatchObject({ end_kind: "transferred" })
    expect(assignment!.ended_at).not.toBeNull()

    const [progress] = (await requirementProgress(managerA, venueA)).filter(
      (r) => r.requirement_id === requirement
    )
    expect(progress).toMatchObject({
      accepted_count: 1,
      satisfied: false,
      needs_reassignment: true,
      assignee_ids: [],
    })

    const err = await fails(
      mover.client.rpc("submit_coverage_photos", {
        p_asset_ids: [later.id],
        p_client_request_key: requestKey(),
      }),
      "evidence_not_eligible"
    )
    expect(err.details).toBe("other_venue")

    const roster = await staffProgress(managerA, venueA, currentMonth())
    expect(roster.find((r) => r.staff_id === mover.id)).toMatchObject({
      is_current_member: false,
      target_count: 1,
      accepted_count: 1,
      complete: true,
    })
  })

  it("keeps a departed author's evidence reviewable and previewable by managers only", async () => {
    const leaver = await staff("cov-acc-leaver", venueA)
    const asset = await reserveReady(service, leaver)
    const [item] = await submit(leaver, [asset.id])
    await setProfile(leaver.id, { active: false })

    await fails(
      leaver.client.rpc("coverage_items_page", {
        p_author_id: leaver.id,
      } as never),
      "not_active_user"
    )
    expect(
      await ok(leaver.client.from("coverage_submission_items").select("id"))
    ).toEqual([])

    const community = await ok(
      managerA.client.from("media_assets").select("id").eq("id", asset.id)
    )
    expect(community).toEqual([])
    const [evidence] = await ok(
      managerA.client.rpc("task_evidence_asset", { p_asset_id: asset.id })
    )
    expect(evidence).toMatchObject({
      asset_id: asset.id,
      uploader_id: leaver.id,
    })
    expect(
      await ok(
        staffA2.client.rpc("task_evidence_asset", { p_asset_id: asset.id })
      )
    ).toEqual([])

    const queue = await ok(
      managerA.client.rpc("coverage_items_page", {
        p_venue_id: venueA,
        p_states: ["submitted"],
      })
    )
    expect(queue.find((q) => q.item_id === item!.item_id)).toMatchObject({
      author_active: false,
      evidence_available: true,
    })
    await accept(service, managerA, item!.item_id)
  })

  it("lets admins attach retained evidence of people who left, but not managers", async () => {
    const leaver = await staff("cov-acc-leaver2", venueA)
    const asset = await insertAsset(service, {
      uploader: leaver.id,
      venue: venueA,
    })
    await setProfile(leaver.id, { active: false })
    const requirement = await createRequirement(managerA, venueA, {
      title: "TEST retained",
    })
    const err = await fails(
      managerA.client.rpc("attach_coverage_evidence", {
        p_requirement_id: requirement,
        p_asset_ids: [asset.id],
        p_client_request_key: requestKey(),
      }),
      "evidence_not_eligible"
    )
    expect(err.details).toBe("inactive_uploader")
    const [row] = await ok(
      admin.client.rpc("attach_coverage_evidence", {
        p_requirement_id: requirement,
        p_asset_ids: [asset.id],
        p_client_request_key: requestKey(),
        p_accept: true,
      })
    )
    expect(row).toMatchObject({ state: "accepted" })
  })
})

describe("roster projection", () => {
  it("carries names, avatar, team and progress, never account data", async () => {
    const rows = await staffProgress(managerA, venueA, currentMonth())
    expect(rows.length).toBeGreaterThan(0)
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "accepted_count",
        "avatar_path",
        "complete",
        "department",
        "display_name",
        "due_on",
        "evidence_removed_count",
        "is_current_member",
        "is_manager",
        "job_title",
        "late_accepted_count",
        "needs_another_photo_count",
        "needs_setup",
        "overdue",
        "pending_count",
        "period_month",
        "setup_missing",
        "staff_id",
        "target_count",
        "target_id",
        "target_revision",
        "target_source",
        "venue_id",
        "venue_name",
      ].sort()
    )
    expect(rows.find((r) => r.staff_id === managerA.id)).toMatchObject({
      is_manager: true,
    })
  })

  it("shows staff only their own row", async () => {
    const rows = await staffProgress(staffA1, venueA, currentMonth())
    expect(rows.map((r) => r.staff_id)).toEqual([staffA1.id])
    await fails(
      staffA1.client.rpc("coverage_staff_progress", { p_staff_id: staffA2.id }),
      "not_venue_manager",
      "42501"
    )
  })
})
