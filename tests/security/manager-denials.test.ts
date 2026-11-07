// What a venue manager account cannot do, through every database path a
// signed-in client can reach: upload (reservation, signed token, direct
// storage write, finalise), labels, staff community reads, deleting media,
// legacy coverage writes (including self-review of staff-era photos), other
// people's profiles, menu tables, grant and account audit rows, and other
// venues' data by guessed ids. Admin and staff regressions run alongside.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { finaliseAsset } from "../../lib/server/media/finalise"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  TINY_BYTES,
  type TestIdentity,
} from "../support/identities"
import {
  assign,
  createRequirement,
  currentMonth,
  fails,
  makeManager,
  ok,
  psql,
  requestKey,
  review,
  submit,
} from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserve,
  reserveReady,
  saveLabels,
  saveOk,
  section,
} from "./menus-fixtures"

const service = serviceClient()
let venueA: string
let venueB: string
let admin: TestIdentity
let chefA: TestIdentity
let chefB: TestIdentity
let managerA: TestIdentity
let managerB: TestIdentity
/** Converted manager with staff-era media, an open reservation and a submitted item. */
let managerC: TestIdentity
let v1: string
let soup: string
let chefPhoto: string
let chefBPhoto: string
let cPhoto: string
let cItem: string
let cAssignment: string
let cReservation: { id: string; original_path: string; token: string }

const staff = (label: string, venueId: string) =>
  createIdentity(service, { label, role: "staff", venueId })

async function stored(path: string) {
  const { data } = await service.storage.from("media").download(path)
  return data
}

/** Row counts of every legacy coverage table at venue A. */
async function coverageRows() {
  const byVenue = [
    "coverage_requirements",
    "coverage_requirement_assignees",
    "monthly_targets",
    "venue_amenity_facts",
    "venue_amenity_fact_media",
    "menu_coverage_plans",
    "coverage_submissions",
    "coverage_submission_items",
    "coverage_review_events",
  ] as const
  const counts: Record<string, number> = {}
  for (const table of byVenue) {
    const { count, error } = await service
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("venue_id", venueA)
    if (error) throw error
    counts[table] = count ?? 0
  }
  const { count } = await service
    .from("coverage_preparation_runs")
    .select("*", { count: "exact", head: true })
    .eq("scope_venue_id", venueA)
  counts.coverage_preparation_runs = count ?? 0
  // Revisions catch in-place updates as well as inserts.
  const { data: revisions } = await service
    .from("coverage_requirements")
    .select("id, revision, status")
    .eq("venue_id", venueA)
    .order("id")
  return { counts, revisions }
}

/** The call fails as not_venue_manager and no coverage row changes. */
async function denied(call: PromiseLike<{ error: unknown }>) {
  const before = await coverageRows()
  await fails(call as Parameters<typeof fails>[0], "not_venue_manager", "42501")
  expect(await coverageRows()).toEqual(before)
}

beforeAll(async () => {
  venueA = (await createVenue(service, "mgr-deny-a")).id
  venueB = (await createVenue(service, "mgr-deny-b")).id
  admin = await createIdentity(service, {
    label: "mgr-deny-admin",
    role: "admin",
  })
  chefA = await staff("mgr-deny-chef-a", venueA)
  chefB = await staff("mgr-deny-chef-b", venueB)
  managerA = await staff("mgr-deny-mgr-a", venueA)
  managerB = await staff("mgr-deny-mgr-b", venueB)
  await makeManager(admin, managerA, venueA)
  await makeManager(admin, managerB, venueB)

  v1 = await publishMenu(
    admin,
    venueA,
    menu("TEST mgr-deny v1", [
      section("starters", "Starters", [item("soup", "Soup")]),
    ])
  )
  soup = (await readDocument(service, v1)).byKey["soup"]!.itemId
  chefPhoto = (await reserveReady(service, chefA)).id
  await saveOk(chefA, {
    asset: chefPhoto,
    revision: 0,
    items: [{ itemId: soup, variantId: null }],
    catalogue: v1,
  })
  chefBPhoto = (await reserveReady(service, chefB)).id

  // C, while still staff: a ready photo submitted for the month, an
  // assignment, and an open reservation with a signed upload token.
  const c = await staff("mgr-deny-c", venueA)
  cPhoto = (await reserveReady(service, c)).id
  cItem = (await submit(c, [cPhoto]))[0]!.item_id
  const requirement = await createRequirement(admin, venueA, {
    title: "TEST mgr-deny assigned",
  })
  await assign(admin, requirement, [c.id])
  const { data: assignment } = await service
    .from("coverage_requirement_assignees")
    .select("id")
    .eq("staff_id", c.id)
    .is("ended_at", null)
    .single()
  cAssignment = assignment!.id
  const reserved = await reserve(c)
  const { data: row } = await service
    .from("media_assets")
    .select("original_path")
    .eq("id", reserved.id)
    .single()
  const { data: signed, error } = await service.storage
    .from("media")
    .createSignedUploadUrl(row!.original_path)
  if (error) throw error
  cReservation = {
    id: reserved.id,
    original_path: row!.original_path,
    token: signed.token,
  }
  await makeManager(admin, c, venueA)
  managerC = c
})

describe("uploads", () => {
  it("cannot reserve an upload", async () => {
    for (const who of [managerA, managerC]) {
      await fails(
        who.client.rpc("reserve_media_asset", {
          p_client_upload_key: randomUUID(),
          p_size_bytes: 4,
          p_media_type: "image",
          p_extension: "jpg",
          p_original_filename: "TEST.jpg",
        }),
        "not_active_staff",
        "42501"
      )
    }
  })

  it("cannot finish a reservation made as staff, by signed token, storage write or finalise", async () => {
    const put = await managerC.client.storage
      .from("media")
      .uploadToSignedUrl(
        cReservation.original_path,
        cReservation.token,
        TINY_BYTES,
        {
          contentType: "image/jpeg",
        }
      )
    expect(put.error).not.toBeNull()
    expect(await stored(cReservation.original_path)).toBeNull()

    const direct = await managerC.client.storage
      .from("media")
      .upload(cReservation.original_path, TINY_BYTES, {
        contentType: "image/jpeg",
      })
    expect(direct.error).not.toBeNull()
    expect(await stored(cReservation.original_path)).toBeNull()

    const finalised = await finaliseAsset(await actorFor(managerC), {
      assetId: cReservation.id,
      idempotencyKey: randomUUID(),
    })
    expect(finalised).toMatchObject({ ok: false, status: 403 })
    const { data } = await service
      .from("media_assets")
      .select("upload_state")
      .eq("id", cReservation.id)
      .single()
    expect(data!.upload_state).toBe("uploading")
  })

  it("cannot write anywhere in the media bucket", async () => {
    const path = `${managerA.id}/${randomUUID()}/original.jpg`
    const { error } = await managerA.client.storage
      .from("media")
      .upload(path, TINY_BYTES, { contentType: "image/jpeg" })
    expect(error).not.toBeNull()
    expect(await stored(path)).toBeNull()
  })

  it("cannot delete media, not even their own staff-era photo", async () => {
    for (const [who, asset] of [
      [managerC, cPhoto],
      [managerA, chefPhoto],
    ] as const) {
      await fails(
        who.client.rpc("delete_media_asset", { p_asset_id: asset }),
        "media_asset_not_found",
        "P0002"
      )
    }
    const { data } = await service
      .from("media_assets")
      .select("id, deleted_at")
      .in("id", [cPhoto, chefPhoto])
    expect(data!.every((a) => a.deleted_at === null)).toBe(true)
  })
})

describe("labels", () => {
  it("save_media_labels refuses manager accounts", async () => {
    const { data: before } = await service
      .from("media_labels")
      .select("revision")
      .eq("asset_id", chefPhoto)
      .single()
    for (const [who, asset, revision] of [
      [managerA, chefPhoto, before!.revision],
      [managerC, cPhoto, 0],
    ] as const) {
      await fails(
        saveLabels(who, {
          asset,
          revision,
          items: [{ itemId: soup, variantId: null }],
          catalogue: v1,
        }),
        "not_active_user",
        "42501"
      )
    }
    const { data: after } = await service
      .from("media_labels")
      .select("revision")
      .eq("asset_id", chefPhoto)
      .single()
    expect(after!.revision).toBe(before!.revision)
    const { count } = await service
      .from("media_label_items")
      .select("*", { count: "exact", head: true })
      .eq("asset_id", cPhoto)
    expect(count).toBe(0)
  })

  it("the guard is in the function body", () => {
    expect(
      psql(
        "select pg_get_functiondef('public.save_media_labels'::regproc) like '%v_role not in (''staff'', ''admin'')%'"
      )
    ).toBe("t")
  })

  it("label tables take no direct writes", async () => {
    for (const table of [
      "media_labels",
      "media_label_items",
      "menu_item_suggestions",
    ] as const) {
      const insert = await managerA.client.from(table).insert({} as never)
      expect(insert.error?.code, `${table} insert`).toBe("42501")
      const update = await managerA.client
        .from(table)
        .update({ asset_id: chefPhoto } as never)
        .eq("asset_id", chefPhoto)
      expect(update.error?.code, `${table} update`).toBe("42501")
      const del = await managerA.client
        .from(table)
        .delete()
        .eq("asset_id", chefPhoto)
      expect(del.error?.code, `${table} delete`).toBe("42501")
    }
  })

  it("menu_label_counts stays admin-only", async () => {
    await fails(
      managerA.client.rpc("menu_label_counts", { p_venue_id: venueA }),
      "not_active_admin",
      "42501"
    )
  })
})

describe("staff community", () => {
  it("returns nothing to a manager account and still serves staff", async () => {
    for (const who of [managerA, managerC]) {
      expect(
        await ok(
          who.client.rpc("community_readable_assets", {
            p_asset_ids: [chefPhoto, cPhoto, chefBPhoto],
          })
        )
      ).toEqual([])
      expect(await ok(who.client.rpc("community_media_page", {}))).toEqual([])
      expect(await ok(who.client.rpc("community_members", {}))).toEqual([])
    }
    const readable = await ok(
      chefA.client.rpc("community_readable_assets", {
        p_asset_ids: [chefPhoto, chefBPhoto],
      })
    )
    expect(readable.map((a) => a.id).sort()).toEqual(
      [chefPhoto, chefBPhoto].sort()
    )
    const page = await ok(
      chefA.client.rpc("community_media_page", { p_venue: venueA })
    )
    expect(page.map((a) => a.id)).toContain(chefPhoto)
    const members = await ok(
      chefA.client.rpc("community_members", { p_venue: venueA })
    )
    expect(members.map((m) => m.id)).toContain(chefA.id)
    expect(members.map((m) => m.id)).not.toContain(managerA.id)
    expect(
      await ok(admin.client.rpc("community_members", { p_venue: venueA }))
    ).not.toEqual([])
  })
})

describe("direct table reads", () => {
  it("show a manager account only its own profile and no media or menu rows", async () => {
    for (const who of [managerA, managerC]) {
      const profiles = await ok(who.client.from("profiles").select("id"))
      expect(profiles.map((p) => p.id)).toEqual([who.id])
      for (const table of [
        "media_assets",
        "media_labels",
        "media_label_items",
        "menu_versions",
        "menu_sections",
        "menu_entries",
        "menu_items",
      ] as const) {
        expect(
          await ok(who.client.from(table).select("*").limit(5)),
          table
        ).toEqual([])
      }
    }
    // Staff still read their venue's menu (regression).
    expect(
      (await ok(chefA.client.from("menu_items").select("id"))).length
    ).toBeGreaterThan(0)
  })

  it("updates to other profiles change nothing", async () => {
    const { data } = await managerA.client
      .from("profiles")
      .update({ display_name: "TEST hijack" })
      .eq("id", chefA.id)
      .select("id")
    expect(data ?? []).toEqual([])
    const { data: chef } = await service
      .from("profiles")
      .select("display_name")
      .eq("id", chefA.id)
      .single()
    expect(chef!.display_name).not.toBe("TEST hijack")
    // Their own display name stays editable.
    const own = await managerA.client
      .from("profiles")
      .update({ display_name: "TEST manager A" })
      .eq("id", managerA.id)
      .select("id")
    expect(own.data).toHaveLength(1)
  })

  it("never reach another venue by guessed ids", async () => {
    await fails(
      managerA.client.rpc("coverage_items_page", { p_venue_id: venueB }),
      "not_venue_manager",
      "42501"
    )
    expect(
      await ok(
        managerA.client.rpc("task_evidence_asset", { p_asset_id: chefBPhoto })
      )
    ).toEqual([])
    expect(
      await ok(
        managerA.client
          .from("venue_manager_grants")
          .select("staff_id")
          .eq("staff_id", managerB.id)
      )
    ).toEqual([])
    expect(
      await ok(
        managerA.client
          .from("coverage_audit_events")
          .select("id")
          .eq("venue_id", venueB)
      )
    ).toEqual([])
    const [scope] = await ok(managerA.client.rpc("manager_workspace_scope"))
    expect(scope).toMatchObject({ user_id: managerA.id, venue_id: venueA })
  })
})

describe("legacy coverage writes", () => {
  let requirement: string

  beforeAll(async () => {
    requirement = await createRequirement(admin, venueA, {
      title: "TEST mgr-deny target",
    })
  })

  it("are denied for every requirement, assignment, target and amenity RPC", async () => {
    await denied(
      managerA.client.rpc("save_coverage_requirement", {
        p_venue_id: venueA,
        p_requirement_id: null as unknown as string,
        p_expected_revision: null as unknown as number,
        p_kind: "venue_specific",
        p_title: "TEST denied",
        p_guidance: null as unknown as string,
        p_photo_target: 1,
        p_due_on: null as unknown as string,
      })
    )
    const { data: r } = await service
      .from("coverage_requirements")
      .select("revision")
      .eq("id", requirement)
      .single()
    await denied(
      managerA.client.rpc("set_coverage_requirement_status", {
        p_requirement_id: requirement,
        p_expected_revision: r!.revision,
        p_status: "not_applicable",
        p_reason: "TEST denied",
      })
    )
    await denied(
      managerA.client.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: requirement,
        p_staff_ids: [chefA.id],
      })
    )
    await denied(
      managerA.client.rpc("set_amenity_fact", {
        p_venue_id: venueA,
        p_amenity_key: "toilets",
        p_expected_revision: null as unknown as number,
        p_presence: "present",
        p_facts: "TEST denied",
        p_policy: null as unknown as string,
        p_confirm: false,
        p_asset_ids: [],
      })
    )
    await denied(
      managerA.client.rpc("set_monthly_target", {
        p_venue_id: venueA,
        p_staff_id: chefA.id,
        p_period_month: currentMonth(),
        p_target_count: 4,
      })
    )
    await denied(
      managerA.client.rpc("prepare_coverage_month", { p_venue_id: venueA })
    )
    await denied(
      managerA.client.rpc("attach_coverage_evidence", {
        p_requirement_id: requirement,
        p_asset_ids: [chefPhoto],
        p_client_request_key: requestKey(),
        p_accept: true,
      })
    )

    // The same calls as the admin succeed (regression).
    await assign(admin, requirement, [chefA.id])
    await ok(
      admin.client.rpc("set_monthly_target", {
        p_venue_id: venueA,
        p_staff_id: chefA.id,
        p_period_month: currentMonth(),
        p_target_count: 4,
      })
    )
    await ok(
      admin.client.rpc("set_amenity_fact", {
        p_venue_id: venueA,
        p_amenity_key: "toilets",
        p_expected_revision: null as unknown as number,
        p_presence: "present",
        p_facts: "TEST admin",
        p_policy: null as unknown as string,
        p_confirm: false,
        p_asset_ids: [],
      })
    )
    await ok(
      admin.client.rpc("attach_coverage_evidence", {
        p_requirement_id: requirement,
        p_asset_ids: [chefPhoto],
        p_client_request_key: requestKey(),
        p_accept: true,
      })
    )
  })

  it("deny reviews, including the manager's own staff-era photo", async () => {
    await denied(review(managerC, cItem, 1, "accepted"))
    await denied(review(managerA, cItem, 1, "accepted"))
    await denied(
      review(managerA, cItem, 1, "needs_another_photo", "TEST denied")
    )
    const [decided] = await ok(review(admin, cItem, 1, "accepted"))
    expect(decided).toMatchObject({ state: "accepted", self_review: false })
  })

  it("deny menu coverage plans and reconciliation", async () => {
    await denied(
      managerA.client.rpc("start_menu_coverage_plan", {
        p_venue_id: venueA,
        p_menu_version_id: v1,
      })
    )
    const plan = async (versionId: string) => {
      const [started] = await ok(
        admin.client.rpc("start_menu_coverage_plan", {
          p_venue_id: venueA,
          p_menu_version_id: versionId,
        })
      )
      const { data: reqs } = await service
        .from("coverage_requirements")
        .select("id, revision")
        .eq("menu_plan_id", started!.plan_id)
      for (const r of reqs!)
        await ok(
          admin.client.rpc("set_coverage_requirement_status", {
            p_requirement_id: r.id,
            p_expected_revision: r.revision,
            p_status: "active",
          })
        )
      return { id: started!.plan_id, requirements: reqs!.map((r) => r.id) }
    }
    const confirm = (who: TestIdentity, planId: string) =>
      who.client.rpc("confirm_menu_coverage_plan", {
        p_plan_id: planId,
        p_expected_revision: 1,
      })
    const plan1 = await plan(v1)
    await denied(confirm(managerA, plan1.id))
    await denied(
      managerA.client.rpc("discard_menu_coverage_plan", {
        p_plan_id: plan1.id,
        p_expected_revision: 1,
      })
    )
    await ok(confirm(admin, plan1.id))
    // Accepted evidence keeps the old section open for reconciliation.
    await ok(
      admin.client.rpc("attach_coverage_evidence", {
        p_requirement_id: plan1.requirements[0]!,
        p_asset_ids: [(await reserveReady(service, chefA)).id],
        p_client_request_key: requestKey(),
        p_accept: true,
      })
    )

    await publishMenu(
      admin,
      venueA,
      menu("TEST mgr-deny v2", [
        section("starters", "Starters", [item("soup", "Soup")]),
      ]),
      v1
    )
    const { data: v2 } = await service
      .from("menu_versions")
      .select("id")
      .eq("venue_id", venueA)
      .eq("status", "active")
      .single()
    const plan2 = await plan(v2!.id)
    await ok(confirm(admin, plan2.id))
    const reconcile = (who: TestIdentity) =>
      who.client.rpc("reconcile_menu_requirement", {
        p_old_requirement_id: plan1.requirements[0]!,
        p_target_requirement_id: null as unknown as string,
        p_item_ids: null as unknown as string[],
        p_reason: "TEST nothing to carry",
      })
    await denied(reconcile(managerA))
    await ok(reconcile(admin))
  })

  it("the admin conversion still ended the converted account's assignments", async () => {
    const { data } = await service
      .from("coverage_requirement_assignees")
      .select("ended_at, end_kind, ended_by")
      .eq("id", cAssignment)
      .single()
    expect(data).toMatchObject({ end_kind: "unassigned", ended_by: admin.id })
  })
})

describe("grant and account audit rows", () => {
  it("are hidden from managers, other venue audit stays readable", async () => {
    const rows = await ok(
      managerA.client.from("coverage_audit_events").select("entity, venue_id")
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.venue_id === venueA)).toBe(true)
    expect(
      rows.some((r) => ["account_role", "manager_grant"].includes(r.entity))
    ).toBe(false)
    expect(rows.some((r) => r.entity === "requirement")).toBe(true)
    const all = await ok(
      admin.client
        .from("coverage_audit_events")
        .select("entity")
        .eq("venue_id", venueA)
    )
    expect(all.map((r) => r.entity)).toEqual(
      expect.arrayContaining(["account_role", "manager_grant", "requirement"])
    )
  })
})

describe("work profile", () => {
  const present =
    psql(
      "select count(*) from pg_proc where proname = 'save_work_profile' and pronamespace = 'public'::regnamespace"
    ) !== "0"

  it.skipIf(!present)(
    "save_work_profile refuses manager accounts",
    async () => {
      const { error } = await managerA.client.rpc(
        "save_work_profile" as never,
        {} as never
      )
      expect(error?.code).toBe("42501")
    }
  )
})
