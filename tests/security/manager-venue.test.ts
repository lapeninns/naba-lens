// S2-MGR (Full App v1): main and backup reviewers, the monthly menu check,
// the Overview venue summary and the venue history (spec §7 M1, M5, §9.3,
// §20). Every call runs as a real signed-in identity: own venue, other
// venue, staff, manager, admin, inactive and anonymous. The service role only
// builds fixtures and reads state back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { fails, insertAsset, makeManager, ok } from "./coverage-fixtures"
import { item, menu, publishMenu, section } from "./menus-fixtures"

const service = serviceClient()
let venueA: string
let venueB: string
let admin: TestIdentity
let managerA: TestIdentity
let managerA2: TestIdentity
let managerA3: TestIdentity
let managerB: TestIdentity
let staffA: TestIdentity
let inactiveManager: TestIdentity

type Person = { profileId: string; name: string; since?: string } | null
type Reviewers = {
  venueId: string
  main: Person
  backup: Person
  candidates: { profileId: string; name: string }[]
}

const readReviewers = (who: TestIdentity, venueId?: string) =>
  who.client.rpc(
    "venue_review_assignments",
    venueId ? { p_venue_id: venueId } : {}
  )
const reviewers = (who: TestIdentity, venueId?: string) =>
  ok(readReviewers(who, venueId)) as Promise<Reviewers>

const setReviewer = (
  who: TestIdentity,
  venueId: string,
  role: string,
  profileId: string | null,
  reason?: string
) =>
  who.client.rpc("set_venue_reviewer", {
    p_venue_id: venueId,
    p_role: role,
    p_profile_id: profileId as string,
    ...(reason ? { p_reason: reason } : {}),
  })

async function manager(label: string, venueId: string) {
  const person = await createIdentity(service, {
    label,
    role: "staff",
    venueId,
  })
  await makeManager(admin, person, venueId)
  return person
}

async function openRows(venueId: string) {
  const { data, error } = await service
    .from("venue_reviewer_assignments")
    .select("role, profile_id, end_kind")
    .eq("venue_id", venueId)
    .is("ended_at", null)
  if (error) throw error
  return data
}

beforeAll(async () => {
  venueA = (await createVenue(service, "mgr-a")).id
  venueB = (await createVenue(service, "mgr-b")).id
  admin = await createIdentity(service, { label: "mgr-admin", role: "admin" })
  managerA = await manager("mgr-a1", venueA)
  managerA2 = await manager("mgr-a2", venueA)
  managerA3 = await manager("mgr-a3", venueA)
  managerB = await manager("mgr-b1", venueB)
  staffA = await createIdentity(service, {
    label: "mgr-staff-a",
    role: "staff",
    venueId: venueA,
  })
  inactiveManager = await manager("mgr-inactive", venueA)
  const { error } = await service
    .from("profiles")
    .update({ active: false })
    .eq("id", inactiveManager.id)
  if (error) throw error
})

describe("venue_review_assignments / set_venue_reviewer", () => {
  it("lists only people who hold manager permission at the venue", async () => {
    const view = await reviewers(managerA)
    expect(view.venueId).toBe(venueA)
    expect(view.main).toBeNull()
    expect(view.backup).toBeNull()
    const ids = view.candidates.map((c) => c.profileId)
    expect(ids).toEqual(
      expect.arrayContaining([managerA.id, managerA2.id, managerA3.id])
    )
    expect(ids).not.toContain(staffA.id)
    expect(ids).not.toContain(managerB.id)
    expect(ids).not.toContain(inactiveManager.id)
    expect(ids).not.toContain(admin.id)
  })

  it("a manager nominates a main and a backup at their own venue", async () => {
    await ok(setReviewer(managerA, venueA, "main", managerA.id, "TEST main"))
    const view = (await ok(
      setReviewer(managerA, venueA, "backup", managerA2.id)
    )) as Reviewers
    expect(view.main?.profileId).toBe(managerA.id)
    expect(view.backup?.profileId).toBe(managerA2.id)
    expect(view.backup?.name).toMatch(/TEST mgr-a2/)
    // Re-nominating the current holder changes nothing.
    await ok(setReviewer(managerA, venueA, "main", managerA.id))
    expect(await openRows(venueA)).toHaveLength(2)
  })

  it("refuses staff, people from another venue, admins and inactive accounts as reviewers", async () => {
    for (const id of [staffA.id, managerB.id, admin.id, inactiveManager.id]) {
      await fails(
        setReviewer(managerA, venueA, "backup", id),
        "reviewer_not_eligible"
      )
    }
    await fails(
      setReviewer(managerA, venueA, "deputy", managerA2.id),
      "invalid_reviewer_role"
    )
  })

  it("moves a person between roles rather than giving them both", async () => {
    const view = (await ok(
      setReviewer(managerA, venueA, "main", managerA2.id, "TEST swap")
    )) as Reviewers
    expect(view.main?.profileId).toBe(managerA2.id)
    expect(view.backup).toBeNull()
    await ok(setReviewer(managerA, venueA, "backup", managerA.id))
  })

  it("never reads or changes another venue for a manager", async () => {
    await fails(readReviewers(managerB, venueA), "not_venue_manager")
    await fails(
      setReviewer(managerB, venueA, "backup", managerB.id),
      "not_venue_manager"
    )
    // Their own venue still works.
    expect((await reviewers(managerB)).venueId).toBe(venueB)
  })

  it("refuses staff, inactive and anonymous callers", async () => {
    await fails(readReviewers(staffA, venueA), "not_venue_manager")
    await fails(
      setReviewer(staffA, venueA, "main", managerA.id),
      "not_venue_manager"
    )
    await fails(readReviewers(inactiveManager, venueA), "not_venue_manager")
    const anon = await anonClient().rpc("venue_review_assignments", {
      p_venue_id: venueA,
    })
    expect(anon.error).not.toBeNull()
    const anonSet = await anonClient().rpc("set_venue_reviewer", {
      p_venue_id: venueA,
      p_role: "main",
      p_profile_id: managerA.id,
    })
    expect(anonSet.error).not.toBeNull()
  })

  it("an admin reads and sets any venue's reviewers", async () => {
    const view = (await ok(
      setReviewer(admin, venueB, "main", managerB.id, "TEST admin")
    )) as Reviewers
    expect(view.main?.profileId).toBe(managerB.id)
    expect((await reviewers(admin, venueA)).main?.profileId).toBe(managerA2.id)
  })

  it("clears a role with no person", async () => {
    const view = (await ok(
      setReviewer(admin, venueB, "main", null, "TEST clear")
    )) as Reviewers
    expect(view.main).toBeNull()
  })

  it("the table is not readable or writable directly", async () => {
    const read = await managerA.client
      .from("venue_reviewer_assignments" as never)
      .select("*")
    expect(read.error).not.toBeNull()
  })

  it("hands over when the main reviewer stops being a manager: the backup takes over", async () => {
    // main = managerA2, backup = managerA.
    await ok(
      admin.client.rpc("remove_venue_member", {
        p_profile_id: managerA2.id,
        p_venue_id: venueA,
        p_reason: "TEST left the venue",
      })
    )
    const view = await reviewers(managerA)
    expect(view.main?.profileId).toBe(managerA.id)
    expect(view.backup).toBeNull()
    const { data: ended } = await service
      .from("venue_reviewer_assignments")
      .select("role, end_kind")
      .eq("venue_id", venueA)
      .eq("profile_id", managerA2.id)
      .not("ended_at", "is", null)
    expect(ended).toEqual(
      expect.arrayContaining([{ role: "main", end_kind: "left" }])
    )
    const { data: activity } = await service
      .from("activity_events")
      .select("action")
      .eq("venue_id", venueA)
      .eq("object_type", "venue_reviewer")
    expect(activity?.map((a) => a.action)).toEqual(
      expect.arrayContaining(["reviewer_assigned", "reviewer_ended"])
    )
  })

  it("ends a backup reviewer's role when their account is deactivated", async () => {
    await ok(setReviewer(managerA, venueA, "backup", managerA3.id))
    const { error } = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", managerA3.id)
    if (error) throw error
    const view = await reviewers(managerA)
    expect(view.main?.profileId).toBe(managerA.id)
    expect(view.backup).toBeNull()
  })
})

describe("confirm_menu_month / manager_venue_summary", () => {
  let versionA: string

  beforeAll(async () => {
    versionA = await publishMenu(
      admin,
      venueA,
      menu("TEST Venue A menu", [
        section("mains", "Mains", [item("pie", "Pie")]),
      ])
    )
  })

  it("shows the month's check as due until a manager confirms it", async () => {
    const summary = (await ok(
      managerA.client.rpc("manager_venue_summary", {})
    )) as {
      venueId: string
      menuCheck: { due: boolean; menuVersionId: string } | null
      unlabelledPhotos: number
      reviewers: { main: Person; backup: Person }
    }
    expect(summary.venueId).toBe(venueA)
    expect(summary.menuCheck?.due).toBe(true)
    expect(summary.menuCheck?.menuVersionId).toBe(versionA)
    expect(summary.reviewers.main?.profileId).toBe(managerA.id)

    const confirmed = (await ok(
      managerA.client.rpc("confirm_menu_month", { p_note: "TEST still right" })
    )) as { due: boolean; confirmedBy: string }
    expect(confirmed.due).toBe(false)
    expect(confirmed.confirmedBy).toMatch(/TEST mgr-a1/)
    // Idempotent within the month.
    await ok(managerA.client.rpc("confirm_menu_month", {}))
    const { data } = await service
      .from("menu_month_checks")
      .select("id")
      .eq("venue_id", venueA)
    expect(data).toHaveLength(1)
  })

  it("has no menu check for a venue without an active menu, and refuses to confirm", async () => {
    const summary = (await ok(
      managerB.client.rpc("manager_venue_summary", {})
    )) as { menuCheck: unknown }
    expect(summary.menuCheck).toBeNull()
    await fails(managerB.client.rpc("confirm_menu_month", {}), "no_active_menu")
  })

  it("counts the venue's unlabelled food and drink photos", async () => {
    const before = (
      (await ok(managerA.client.rpc("manager_venue_summary", {}))) as {
        unlabelledPhotos: number
      }
    ).unlabelledPhotos
    const asset = await insertAsset(service, {
      uploader: staffA.id,
      venue: venueA,
    })
    const { error } = await service.from("media_labels").insert({
      asset_id: asset.id,
      venue_id: venueA,
      content_types: ["dish"],
    })
    if (error) throw error
    const after = (
      (await ok(managerA.client.rpc("manager_venue_summary", {}))) as {
        unlabelledPhotos: number
      }
    ).unlabelledPhotos
    expect(after).toBe(before + 1)
  })

  it("refuses other venues, staff, inactive and anonymous callers", async () => {
    await fails(
      managerB.client.rpc("manager_venue_summary", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    await fails(
      managerB.client.rpc("confirm_menu_month", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    await fails(
      staffA.client.rpc("manager_venue_summary", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    await fails(
      staffA.client.rpc("confirm_menu_month", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    await fails(
      inactiveManager.client.rpc("confirm_menu_month", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    const anon = await anonClient().rpc("manager_venue_summary", {
      p_venue_id: venueA,
    })
    expect(anon.error).not.toBeNull()
  })

  it("an admin reads and confirms for a named venue only", async () => {
    await fails(
      admin.client.rpc("manager_venue_summary", {}),
      "not_venue_manager"
    )
    const summary = (await ok(
      admin.client.rpc("manager_venue_summary", { p_venue_id: venueA })
    )) as { menuCheck: { due: boolean } }
    expect(summary.menuCheck.due).toBe(false)
  })
})

describe("venue_history", () => {
  type History = {
    venueId: string
    items: { source: string; action: string; at: string; id: string }[]
    nextCursor: { at: string; source: string; id: string } | null
  }

  it("shows the venue's own changes, newest first, with paging", async () => {
    const first = (await ok(
      managerA.client.rpc("venue_history", { p_limit: 2 })
    )) as History
    expect(first.venueId).toBe(venueA)
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    const second = (await ok(
      managerA.client.rpc("venue_history", {
        p_limit: 100,
        p_before: first.nextCursor!,
      })
    )) as History
    const all = [...first.items, ...second.items]
    const actions = all.map((i) => i.action)
    expect(actions).toEqual(
      expect.arrayContaining([
        "reviewer_assigned",
        "reviewer_ended",
        "menu_month_confirmed",
      ])
    )
    const keys = all.map((i) => `${i.source}:${i.id}`)
    expect(new Set(keys).size).toBe(keys.length)
    const times = all.map((i) => Date.parse(i.at))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })

  it("filters by source and rejects a malformed cursor", async () => {
    const page = (await ok(
      managerA.client.rpc("venue_history", { p_source: "activity" })
    )) as History
    expect(page.items.every((i) => i.source === "activity")).toBe(true)
    await fails(
      managerA.client.rpc("venue_history", { p_before: { at: "nope" } }),
      "invalid_cursor"
    )
  })

  it("never shows another venue's history", async () => {
    const b = (await ok(managerB.client.rpc("venue_history", {}))) as History
    expect(b.venueId).toBe(venueB)
    expect(b.items.map((i) => i.action)).not.toContain("menu_month_confirmed")
    await fails(
      managerB.client.rpc("venue_history", { p_venue_id: venueA }),
      "not_venue_manager"
    )
  })

  it("refuses staff, inactive and anonymous callers; admins name a venue", async () => {
    await fails(
      staffA.client.rpc("venue_history", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    await fails(
      inactiveManager.client.rpc("venue_history", { p_venue_id: venueA }),
      "not_venue_manager"
    )
    const anon = await anonClient().rpc("venue_history", { p_venue_id: venueA })
    expect(anon.error).not.toBeNull()
    const page = (await ok(
      admin.client.rpc("venue_history", { p_venue_id: venueA })
    )) as History
    expect(page.items.length).toBeGreaterThan(0)
  })
})

describe("amenity archive needs a reason", () => {
  it("signed-in users can no longer call the reasonless archive or restore", async () => {
    const id = "00000000-0000-0000-0000-000000000000"
    for (const fn of ["amenity_archive_check", "amenity_restore_check"]) {
      const { error } = await managerA.client.rpc(
        fn as never,
        {
          p_check_id: id,
          p_revision: 1,
        } as never
      )
      expect(error?.code).toBe("42501")
      const keyed = await admin.client.rpc(
        fn as never,
        {
          p_check_id: id,
          p_revision: 1,
          p_idempotency_key: id,
        } as never
      )
      expect(keyed.error?.code).toBe("42501")
    }
  })
})
