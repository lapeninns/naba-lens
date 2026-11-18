// S2-ADMIN (spec §8 A1, A2; FA-23, FA-33; AC23, AC29, AC39): admin venues,
// reviewers, setup checklist, templates, scope impact, MFA reset and the
// group overview. Real signed-in identities; the service role only builds
// fixtures and reads state back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  signIn,
  type TestIdentity,
} from "../support/identities"
import { fails, insertAsset, makeManager, ok, psql } from "./coverage-fixtures"

type Obj = Record<string, unknown>
type Reviewer = { profileId: string; eligible: boolean; revision: number }
type Setup = { items: { key: string; done: boolean }[]; done: number }

/** ok() for functions that return jsonb: the caller names the shape. */
const okAs = async <T>(call: PromiseLike<unknown>): Promise<T> =>
  (await ok(call as never)) as T

const service = serviceClient()
let venueA: string
let venueB: string
let admin: TestIdentity
let otherAdmin: TestIdentity
let aal1Admin: TestIdentity
let inactiveAdmin: TestIdentity
let managerA: TestIdentity
// Coordinator merge: reviewers follow S2-MGR's rule (managers of the venue).
let managerA2: { id: string }
let managerB: TestIdentity
let staffA: TestIdentity

const venue = async (id: string) => {
  const { data, error } = await service
    .from("venues")
    .select("*")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

const activity = async (venueId: string, action: string) => {
  const { data, error } = await service
    .from("activity_events")
    .select("action, reason, before, after, actor_id")
    .eq("venue_id", venueId)
    .eq("action", action)
  if (error) throw error
  return data
}

/** Every public function of this task, with arguments valid for venueA. */
const calls = (db: TestIdentity["client"]) => [
  () => db.rpc("admin_venues_list", {}),
  () => db.rpc("admin_venue_detail", { p_venue_id: venueA }),
  () => db.rpc("admin_venue_archive_impact", { p_venue_id: venueA }),
  () =>
    db.rpc("admin_venue_save", {
      p_venue_id: venueA,
      p_name: "TEST denied",
      p_locality: "",
      p_address: "",
      p_timezone: "Europe/London",
      p_revision: 1,
    }),
  () =>
    db.rpc("admin_venue_set_status", {
      p_venue_id: venueA,
      p_status: "temporarily_closed",
      p_reason: "TEST",
      p_revision: 1,
    }),
  () =>
    db.rpc("admin_set_venue_reviewer", {
      p_venue_id: venueA,
      p_responsibility: "main",
      p_profile_id: managerA.id,
      p_reason: "TEST",
      p_revision: 0,
    }),
  () => db.rpc("admin_venue_template_preview", { p_venue_id: venueA }),
  () =>
    db.rpc("admin_venue_apply_template", {
      p_venue_id: venueA,
      p_source_venue_id: null as unknown as string,
      p_reason: "TEST",
    }),
  () =>
    db.rpc("venue_scope_impact", {
      p_venue_id: venueA,
      p_key: "accommodation",
      p_applicable: true,
    }),
  () =>
    db.rpc("admin_reset_mfa_authorise", {
      p_profile_id: managerA.id,
      p_reason: "TEST",
    }),
  () => db.rpc("admin_group_overview", {}),
]

beforeAll(async () => {
  venueA = (await createVenue(service, "admin-venues-a")).id
  venueB = (await createVenue(service, "admin-venues-b")).id
  admin = await createIdentity(service, { label: "av-admin", role: "admin" })
  otherAdmin = await createIdentity(service, {
    label: "av-admin2",
    role: "admin",
  })
  inactiveAdmin = await createIdentity(service, {
    label: "av-admin-off",
    role: "admin",
    active: false,
  })
  // Signed in as staff (aal1), then made an admin: no second factor.
  aal1Admin = await createIdentity(service, {
    label: "av-admin-aal1",
    role: "staff",
    venueId: venueA,
  })
  await service
    .from("profiles")
    .update({ role: "admin", venue_id: null })
    .eq("id", aal1Admin.id)
  staffA = await createIdentity(service, {
    label: "av-staff-a",
    role: "staff",
    venueId: venueA,
  })
  const mA = await createIdentity(service, {
    label: "av-mgr-a",
    role: "staff",
    venueId: venueA,
  })
  await makeManager(admin, mA, venueA)
  managerA = { ...mA, client: await signIn(service, mA.email) }
  const mB = await createIdentity(service, {
    label: "av-mgr-b",
    role: "staff",
    venueId: venueB,
  })
  await makeManager(admin, mB, venueB)
  managerB = { ...mB, client: await signIn(service, mB.email) }
  // A second manager at A, for the backup reviewer.
  const mA2 = await createIdentity(service, {
    label: "av-mgr-a2",
    role: "staff",
    venueId: venueA,
  })
  await makeManager(admin, mA2, venueA)
  managerA2 = mA2
})

describe("who may call", () => {
  it("refuses anon, staff, managers (own venue too), inactive and aal1 admins", async () => {
    const callers: [string, TestIdentity["client"]][] = [
      ["anon", anonClient()],
      ["staff", staffA.client],
      ["manager own venue", managerA.client],
      ["manager other venue", managerB.client],
      ["inactive admin", inactiveAdmin.client],
      ["aal1 admin", aal1Admin.client],
    ]
    for (const [who, db] of callers) {
      for (const call of calls(db)) {
        const { error } = await call()
        expect(error, who).not.toBeNull()
        expect(["42501", "PGRST301"], who).toContain(error!.code)
      }
    }
    // Nothing changed.
    expect((await venue(venueA)).revision).toBe(1)
  })
})

describe("venues", () => {
  it("creates a venue with a timezone and records it", async () => {
    const name = `TEST Created ${crypto.randomUUID().slice(0, 6)}`
    const created = await okAs<Obj>(
      admin.client.rpc("admin_venue_save", {
        p_venue_id: null as unknown as string,
        p_name: name,
        p_locality: "Cambridge",
        p_address: "1 High Street, CB1 1AA",
        p_timezone: "",
        p_revision: 0,
      })
    )
    expect(created.created).toBe(true)
    expect(created.timezone).toBe("Europe/London")
    const row = await venue(created.id as string)
    expect(row).toMatchObject({
      name,
      locality: "Cambridge",
      active: true,
      operating_status: "open",
    })
    expect(row.slug).toMatch(/^test-created-/)
    expect(await activity(row.id, "venue_created")).toHaveLength(1)
  })

  it("edits with a stale check, validates timezone and names", async () => {
    const before = await venue(venueA)
    await fails(
      admin.client.rpc("admin_venue_save", {
        p_venue_id: venueA,
        p_name: before.name,
        p_locality: "",
        p_address: "",
        p_timezone: "Mars/Olympus",
        p_revision: before.revision,
      }),
      "invalid_timezone",
      "22023"
    )
    const other = await venue(venueB)
    await fails(
      admin.client.rpc("admin_venue_save", {
        p_venue_id: venueA,
        p_name: other.name.toUpperCase(),
        p_locality: "",
        p_address: "",
        p_timezone: "Europe/London",
        p_revision: before.revision,
      }),
      "venue_name_taken",
      "23505"
    )
    const saved = await okAs<Obj>(
      admin.client.rpc("admin_venue_save", {
        p_venue_id: venueA,
        p_name: before.name,
        p_locality: "Ely",
        p_address: "",
        p_timezone: "Europe/Dublin",
        p_revision: before.revision,
        p_reason: "TEST move",
      })
    )
    expect(saved).toMatchObject({ changed: true, timezone: "Europe/Dublin" })
    await fails(
      admin.client.rpc("admin_venue_save", {
        p_venue_id: venueA,
        p_name: before.name,
        p_locality: "Ely",
        p_address: "",
        p_timezone: "Europe/London",
        p_revision: before.revision,
      }),
      "venue_conflict",
      "40001"
    )
    const [event] = await activity(venueA, "venue_updated")
    expect(event).toMatchObject({
      reason: "TEST move",
      actor_id: admin.id,
      before: { timezone: "Europe/London" },
      after: { timezone: "Europe/Dublin", locality: "Ely" },
    })
    // Same values again change nothing.
    const again = await okAs<Obj>(
      admin.client.rpc("admin_venue_save", {
        p_venue_id: venueA,
        p_name: before.name,
        p_locality: "Ely",
        p_address: "",
        p_timezone: "Europe/Dublin",
        p_revision: saved.revision as number,
      })
    )
    expect(again.changed).toBe(false)
  })

  it("archives a closed venue with a reason, keeping its rows, and restores it", async () => {
    const v = (await createVenue(service, "admin-venues-close")).id
    const s = await createIdentity(service, {
      label: "av-staff-close",
      role: "staff",
      venueId: v,
    })
    const asset = await insertAsset(service, { uploader: s.id, venue: v })
    const impact = await okAs<Obj>(
      admin.client.rpc("admin_venue_archive_impact", { p_venue_id: v })
    )
    expect(impact).toMatchObject({ members: 1, onlyVenue: 1, photos: 1 })

    await fails(
      admin.client.rpc("admin_venue_set_status", {
        p_venue_id: v,
        p_status: "permanently_closed",
        p_reason: "  ",
        p_revision: 1,
      }),
      "reason_required"
    )
    await ok(
      admin.client.rpc("admin_venue_set_status", {
        p_venue_id: v,
        p_status: "permanently_closed",
        p_reason: "TEST sold",
        p_revision: 1,
      })
    )
    const closed = await venue(v)
    expect(closed).toMatchObject({
      active: false,
      operating_status: "permanently_closed",
    })
    expect(closed.archived_at).not.toBeNull()
    // History stays (access ends: private.venue_role_of needs an active venue).
    const { data: kept } = await service
      .from("media_assets")
      .select("id")
      .eq("id", asset.id)
    expect(kept).toHaveLength(1)
    expect(await activity(v, "venue_archived")).toHaveLength(1)
    // Not listed unless asked for.
    const list = await okAs<{ items: Obj[] }>(
      admin.client.rpc("admin_venues_list", {})
    )
    expect(list.items.some((i) => i.id === v)).toBe(false)
    const all = await okAs<{ items: Obj[] }>(
      admin.client.rpc("admin_venues_list", { p_include_archived: true })
    )
    expect(all.items.some((i) => i.id === v)).toBe(true)
    // Reviewers can't be named at an archived venue.
    await fails(
      admin.client.rpc("admin_set_venue_reviewer", {
        p_venue_id: v,
        p_responsibility: "main",
        p_profile_id: admin.id,
        p_reason: "TEST",
        p_revision: 0,
      }),
      "venue_not_found"
    )

    await ok(
      admin.client.rpc("admin_venue_set_status", {
        p_venue_id: v,
        p_status: "open",
        p_reason: "TEST reopened",
        p_revision: closed.revision,
      })
    )
    expect(await venue(v)).toMatchObject({ active: true, archived_at: null })
    expect(await activity(v, "venue_restored")).toHaveLength(1)
  })
})

describe("reviewers and setup", () => {
  it("names a main and backup who review there, and the checklist follows", async () => {
    const detail = await okAs<{ candidates: { profileId: string }[] }>(
      admin.client.rpc("admin_venue_detail", { p_venue_id: venueA })
    )
    const ids = detail.candidates.map((c) => c.profileId)
    expect(ids).toContain(managerA.id)
    expect(ids).toContain(managerA2.id)
    // Admins review every venue without being named (S2-MGR's rule).
    expect(ids).not.toContain(admin.id)
    expect(ids).not.toContain(staffA.id)
    expect(ids).not.toContain(managerB.id)

    const set = (
      who: string | null,
      responsibility: "main" | "backup",
      revision: number
    ) =>
      admin.client.rpc("admin_set_venue_reviewer", {
        p_venue_id: venueA,
        p_responsibility: responsibility,
        p_profile_id: who as string,
        p_reason: "TEST reviewers",
        p_revision: revision,
      })
    await fails(set(staffA.id, "main", 0), "reviewer_not_eligible")
    await fails(set(managerB.id, "main", 0), "reviewer_not_eligible")
    await ok(set(managerA.id, "main", 0))
    await fails(set(managerA.id, "backup", 0), "reviewer_same_person")
    await fails(set(managerA2.id, "main", 0), "reviewer_conflict", "40001")
    await fails(set(admin.id, "backup", 0), "reviewer_not_eligible")
    await ok(set(managerA2.id, "backup", 0))

    const after = await okAs<{
      reviewers: { main: Reviewer; backup: Reviewer }
      setup: Setup
    }>(admin.client.rpc("admin_venue_detail", { p_venue_id: venueA }))
    expect(after.reviewers.main).toMatchObject({
      profileId: managerA.id,
      eligible: true,
    })
    expect(after.reviewers.backup.profileId).toBe(managerA2.id)
    const reviewers = after.setup.items.find((i) => i.key === "reviewers")
    expect(reviewers?.done).toBe(true)
    expect(after.setup.items.find((i) => i.key === "staff")?.done).toBe(true)

    // Clearing the backup reopens the item.
    await ok(set(null, "backup", 1))
    const cleared = await okAs<{ setup: Setup }>(
      admin.client.rpc("admin_venue_detail", { p_venue_id: venueA })
    )
    expect(cleared.setup.items.find((i) => i.key === "reviewers")?.done).toBe(
      false
    )
    expect(await activity(venueA, "venue_reviewer_set")).toHaveLength(3)
  })
})

describe("templates (AC23)", () => {
  it("copies the catalogue's core questions as unanswered checks", async () => {
    const v = (await createVenue(service, "admin-venues-tpl")).id
    const preview = await okAs<{ questions: { key: string }[] }>(
      admin.client.rpc("admin_venue_template_preview", { p_venue_id: v })
    )
    expect(preview.questions.length).toBeGreaterThan(0)
    await fails(
      admin.client.rpc("admin_venue_apply_template", {
        p_venue_id: v,
        p_source_venue_id: null as unknown as string,
        p_reason: "",
      }),
      "reason_required"
    )
    const result = await okAs<{ questions: number; places: number }>(
      admin.client.rpc("admin_venue_apply_template", {
        p_venue_id: v,
        p_source_venue_id: null as unknown as string,
        p_reason: "TEST new venue",
      })
    )
    expect(result.questions).toBe(preview.questions.length)
    const { data: checks } = await service
      .from("venue_amenity_checks")
      .select("template_key, answer, current_submission_id")
      .eq("venue_id", v)
    expect(checks).toHaveLength(preview.questions.length)
    expect(checks!.every((c) => c.answer === "to_check")).toBe(true)
    // Applying again adds nothing.
    const again = await okAs<{ questions: number }>(
      admin.client.rpc("admin_venue_apply_template", {
        p_venue_id: v,
        p_source_venue_id: null as unknown as string,
        p_reason: "TEST again",
      })
    )
    expect(again.questions).toBe(0)
  })

  it("copies another venue's questions and places, never its answers or photos", async () => {
    const source = (await createVenue(service, "admin-venues-src")).id
    const target = (await createVenue(service, "admin-venues-dst")).id
    await ok(
      admin.client.rpc("admin_venue_apply_template", {
        p_venue_id: source,
        p_source_venue_id: null as unknown as string,
        p_reason: "TEST source",
      })
    )
    // Places are written by their own commands; the owner adds one here.
    psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${source}', 'area', 'TEST Garden', '${admin.id}')`
    )
    const sourceStaff = await createIdentity(service, {
      label: "av-src-staff",
      role: "staff",
      venueId: source,
    })
    await insertAsset(service, { uploader: sourceStaff.id, venue: source })

    await fails(
      admin.client.rpc("admin_venue_template_preview", {
        p_venue_id: target,
        p_source_venue_id: target,
      }),
      "template_source_invalid"
    )
    const preview = await okAs<{ places: { label: string }[] }>(
      admin.client.rpc("admin_venue_template_preview", {
        p_venue_id: target,
        p_source_venue_id: source,
      })
    )
    expect(preview.places.map((p) => p.label)).toEqual(["TEST Garden"])
    await ok(
      admin.client.rpc("admin_venue_apply_template", {
        p_venue_id: target,
        p_source_venue_id: source,
        p_reason: "TEST copy",
      })
    )
    const { data: places } = await service
      .from("knowledge_subjects")
      .select("label, created_by")
      .eq("venue_id", target)
    expect(places).toEqual([{ label: "TEST Garden", created_by: admin.id }])
    const { data: assets } = await service
      .from("media_assets")
      .select("id")
      .eq("venue_id", target)
    expect(assets).toEqual([])
    const { data: checks } = await service
      .from("venue_amenity_checks")
      .select("answer, current_submission_id")
      .eq("venue_id", target)
    expect(checks!.length).toBeGreaterThan(0)
    expect(
      checks!.every(
        (c) => c.answer === "to_check" && c.current_submission_id === null
      )
    ).toBe(true)
  })
})

describe("scope impact (AC29)", () => {
  it("previews a change without making it", async () => {
    const impact = await okAs<Obj>(
      admin.client.rpc("venue_scope_impact", {
        p_venue_id: venueB,
        p_key: "accommodation",
        p_applicable: true,
      })
    )
    expect(impact).toMatchObject({
      applicableBefore: false,
      applicableAfter: true,
      changes: true,
      slotsAdded: 0,
      slotsRemoved: 0,
    })
    const { data } = await service
      .from("venue_scope")
      .select("venue_id")
      .eq("venue_id", venueB)
    expect(data).toEqual([])
    await fails(
      admin.client.rpc("venue_scope_impact", {
        p_venue_id: venueB,
        p_key: "bedrooms",
        p_applicable: true,
      }),
      "invalid_scope_key"
    )
  })
})

describe("MFA reset", () => {
  it("is recorded with a reason and never for oneself", async () => {
    await fails(
      admin.client.rpc("admin_reset_mfa_authorise", {
        p_profile_id: admin.id,
        p_reason: "TEST",
      }),
      "mfa_reset_self",
      "42501"
    )
    await fails(
      admin.client.rpc("admin_reset_mfa_authorise", {
        p_profile_id: otherAdmin.id,
        p_reason: "",
      }),
      "reason_required"
    )
    const result = await okAs<{ factors: number }>(
      admin.client.rpc("admin_reset_mfa_authorise", {
        p_profile_id: otherAdmin.id,
        p_reason: "TEST lost phone",
      })
    )
    expect(result.factors).toBeGreaterThan(0)
    const { data } = await service
      .from("activity_events")
      .select("reason, actor_id")
      .eq("action", "mfa_reset")
      .eq("object_id", otherAdmin.id)
    expect(data).toEqual([{ reason: "TEST lost phone", actor_id: admin.id }])
  })
})

describe("group overview (A1)", () => {
  it("returns every number per venue, filters and validates", async () => {
    const v = (await createVenue(service, "admin-venues-ov")).id
    const s = await createIdentity(service, {
      label: "av-ov-staff",
      role: "staff",
      venueId: v,
    })
    await insertAsset(service, { uploader: s.id, venue: v })
    await insertAsset(service, { uploader: s.id, venue: v, ready: false })
    const today = new Date().toISOString().slice(0, 10)
    const read = await okAs<{ rows: Obj[] }>(
      admin.client.rpc("admin_group_overview", {
        p_venue_ids: [v],
        p_from: today,
        p_to: today,
      })
    )
    expect(read.rows).toHaveLength(1)
    const row = read.rows[0] as Obj & {
      categories: { category: string; total: number }[]
      setup: Setup
    }
    expect(row).toMatchObject({
      venueId: v,
      unlabelled: 1,
      added: 1,
      review: { waiting: 0, oldestAt: null },
      checksDue: { total: 0 },
      publication: { total: 0 },
      facts: { confirmed: 0 },
    })
    expect(row.categories.map((c) => c.category)).toEqual([
      "food",
      "drinks",
      "spaces",
      "facilities",
      "other",
    ])
    expect(row.setup.items.find((i) => i.key === "staff")?.done).toBe(true)

    // AC39: the categories are the one slot rule's own counts.
    const slots = await okAs<{ categories: Obj[] }>(
      admin.client.rpc("coverage_slots", { p_venue_id: v })
    )
    expect(row.categories).toEqual(slots.categories)

    const next = await okAs<{ rows: Obj[] }>(
      admin.client.rpc("admin_group_overview", {
        p_venue_ids: [v],
        p_menu: "next",
      })
    )
    expect(next.rows[0]).toMatchObject({ nextMenu: null, added: null })

    await fails(
      admin.client.rpc("admin_group_overview", { p_menu: "past" }),
      "invalid_menu_filter"
    )
    await fails(
      admin.client.rpc("admin_group_overview", { p_from: today }),
      "invalid_period"
    )
  })
})
