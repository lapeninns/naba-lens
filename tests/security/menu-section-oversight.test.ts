// G-8 (goals, not tasks; v0.5 rules 22 and 23, §4 and §5): menu-section
// requirements have no assignees and no due date, oversight counts no overdue
// or reassignment for menu work, history stays readable by admins, and the
// team roster with month progress is visible to the venue manager and admins
// only. Real identities against an isolated local stack.
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
  legacyStaffGrant,
  makeManager,
  ok,
  requirementProgress,
} from "./coverage-fixtures"
import { item, menu, publishMenu, section } from "./menus-fixtures"

const service = serviceClient()
const PAST = "2026-01-15"

let venueA: string
let venueB: string
let admin: TestIdentity
let legacyManager: TestIdentity
let managerAccount: TestIdentity
let managerB: TestIdentity
let staffA: TestIdentity
let colleagueA: TestIdentity
let staffB: TestIdentity
let starters: string

async function revisionOf(requirementId: string) {
  const { data, error } = await service
    .from("coverage_requirements")
    .select("revision")
    .eq("id", requirementId)
    .single()
  if (error) throw error
  return data.revision
}

/** Writes a pre-cut-over due date directly, as the old procedures could. */
async function setOldDueDate(requirementId: string) {
  const { error } = await service
    .from("coverage_requirements")
    .update({ due_on: PAST, revision: (await revisionOf(requirementId)) + 1 })
    .eq("id", requirementId)
  if (error) throw error
}

async function setStatus(
  who: TestIdentity,
  requirementId: string,
  status: string,
  reason: string | null = null
) {
  return who.client.rpc("set_coverage_requirement_status", {
    p_requirement_id: requirementId,
    p_expected_revision: await revisionOf(requirementId),
    p_status: status,
    p_reason: reason as string,
  })
}

async function saveSection(who: TestIdentity, dueOn: string | null) {
  return who.client.rpc("save_coverage_requirement", {
    p_venue_id: venueA,
    p_requirement_id: starters,
    p_expected_revision: await revisionOf(starters),
    p_kind: null as unknown as string,
    p_title: "Starters",
    p_guidance: null as unknown as string,
    p_photo_target: 1,
    p_due_on: dueOn as string,
  })
}

async function openAssignees(requirementId: string) {
  const { data, error } = await service
    .from("coverage_requirement_assignees")
    .select("id")
    .eq("requirement_id", requirementId)
  if (error) throw error
  return data.length
}

async function summary(who: TestIdentity) {
  const [row] = await ok(
    who.client.rpc("venue_coverage_summary", { p_venue_id: venueA })
  )
  return row!
}

async function staff(label: string, venueId: string) {
  return createIdentity(service, { label, role: "staff", venueId })
}

beforeAll(async () => {
  venueA = (await createVenue(service, "g8-a")).id
  venueB = (await createVenue(service, "g8-b")).id
  admin = await createIdentity(service, { label: "g8-admin", role: "admin" })
  legacyManager = await staff("g8-legacy-mgr", venueA)
  managerAccount = await staff("g8-mgr-account", venueA)
  managerB = await staff("g8-mgr-b", venueB)
  staffA = await staff("g8-staff-a", venueA)
  colleagueA = await staff("g8-colleague-a", venueA)
  staffB = await staff("g8-staff-b", venueB)
  await service
    .from("profiles")
    .update({ department: "foh" })
    .in("id", [staffA.id, colleagueA.id, legacyManager.id, staffB.id])
  await legacyStaffGrant(service, admin, legacyManager.id, venueA)
  await makeManager(admin, managerAccount, venueA)
  await makeManager(admin, managerB, venueB)

  const v1 = await publishMenu(
    admin,
    venueA,
    menu("TEST g8 menu", [
      section("starters", "Starters", [item("soup", "Soup")]),
    ])
  )
  const [plan] = await ok(
    legacyManager.client.rpc("start_menu_coverage_plan", {
      p_venue_id: venueA,
      p_menu_version_id: v1,
    })
  )
  const { data: rows } = await service
    .from("coverage_requirements")
    .select("id")
    .eq("menu_plan_id", plan!.plan_id)
  starters = rows![0]!.id
  await ok(setStatus(legacyManager, starters, "active"))
  await ok(
    legacyManager.client.rpc("confirm_menu_coverage_plan", {
      p_plan_id: plan!.plan_id,
      p_expected_revision: 1,
    })
  )
})

describe("menu sections have no assignees", () => {
  it("refuses assigning a section to anyone, admins included, and writes nothing", async () => {
    for (const who of [legacyManager, admin]) {
      for (const ids of [[staffA.id], []]) {
        await fails(
          who.client.rpc("set_coverage_requirement_assignees", {
            p_requirement_id: starters,
            p_staff_ids: ids,
          }),
          "menu_section_shared",
          "P0001"
        )
      }
    }
    // Staff still learn nothing about the requirement.
    await fails(
      staffA.client.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: starters,
        p_staff_ids: [staffA.id],
      }),
      "coverage_requirement_not_found"
    )
    expect(await openAssignees(starters)).toBe(0)
    const { count } = await service
      .from("coverage_audit_events")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", starters)
      .eq("action", "assignees_set")
    expect(count).toBe(0)
  })

  it("still assigns service and venue-specific work (rule 28)", async () => {
    const task = await createRequirement(legacyManager, venueA, {
      title: "TEST g8 garden",
    })
    const rows = await assign(legacyManager, task, [staffA.id])
    expect(rows.map((r) => r.staff_id)).toEqual([staffA.id])
  })

  it("refuses a new due date on a section but lets an old one stay or be cleared", async () => {
    await fails(
      saveSection(legacyManager, "2026-12-31"),
      "menu_section_no_due_date",
      "P0001"
    )
    await fails(
      saveSection(admin, "2026-12-31"),
      "menu_section_no_due_date",
      "P0001"
    )
    // A date set before the cut-over is history: saving other fields with it
    // unchanged works, and so does clearing it.
    await setOldDueDate(starters)
    const kept = await ok(
      legacyManager.client.rpc("save_coverage_requirement", {
        p_venue_id: venueA,
        p_requirement_id: starters,
        p_expected_revision: await revisionOf(starters),
        p_kind: null as unknown as string,
        p_title: "Starters",
        p_guidance: "TEST plates on the pass",
        p_photo_target: 1,
        p_due_on: PAST,
      })
    )
    expect(kept[0]!.replayed).toBe(false)
    const [row] = (await requirementProgress(admin, venueA)).filter(
      (r) => r.requirement_id === starters
    )
    expect(row).toMatchObject({ due_on: PAST, overdue: false })
    await ok(saveSection(legacyManager, null))
    const [cleared] = (await requirementProgress(admin, venueA)).filter(
      (r) => r.requirement_id === starters
    )
    expect(cleared!.due_on).toBeNull()
  })
})

describe("oversight counts no overdue or reassignment for menu work", () => {
  let overdueTask: string

  beforeAll(async () => {
    // A section past its old due date, with an assignee who left before the
    // cut-over (history written directly, as the old procedures did).
    await setOldDueDate(starters)
    await ok(
      service.from("coverage_requirement_assignees").insert({
        requirement_id: starters,
        venue_id: venueA,
        staff_id: colleagueA.id,
        assigned_by: legacyManager.id,
      })
    )
    const { error } = await service
      .from("coverage_requirement_assignees")
      .update({
        ended_at: new Date().toISOString(),
        ended_by: admin.id,
        end_kind: "transferred",
        end_reason: "TEST moved venue",
      })
      .eq("requirement_id", starters)
    if (error) throw error
    // Non-menu work keeps its due date and Overdue (rule 28).
    overdueTask = await createRequirement(legacyManager, venueA, {
      title: "TEST g8 overdue bar",
      dueOn: PAST,
    })
  })

  it("never reports a section as overdue or needing reassignment", async () => {
    for (const who of [admin, legacyManager, staffA]) {
      const rows = await requirementProgress(who, venueA)
      const section = rows.find((r) => r.requirement_id === starters)!
      expect(section).toMatchObject({
        kind: "menu_section",
        satisfied: false,
        overdue: false,
        needs_reassignment: false,
      })
      expect(rows.find((r) => r.requirement_id === overdueTask)).toMatchObject({
        kind: "venue_specific",
        overdue: true,
      })
    }
  })

  it("counts overdue and reassignment for non-menu work only", async () => {
    expect(await summary(legacyManager)).toMatchObject({
      overdue_count: 1,
      needs_reassignment_count: 0,
    })
    const group = await ok(
      admin.client.rpc("coverage_group_overview", {
        p_period_month: currentMonth(),
      })
    )
    expect(group.find((r) => r.venue_id === venueA)).toMatchObject({
      overdue_count: 1,
      needs_reassignment_count: 0,
    })
  })

  it("keeps old assignees, due dates and events readable by admins", async () => {
    const history = await ok(
      admin.client
        .from("coverage_requirement_assignees")
        .select("staff_id, end_kind")
        .eq("requirement_id", starters)
    )
    expect(history).toEqual([
      { staff_id: colleagueA.id, end_kind: "transferred" },
    ])
    const req = await ok(
      admin.client
        .from("coverage_requirements")
        .select("due_on")
        .eq("id", starters)
    )
    expect(req).toEqual([{ due_on: PAST }])
    const events = await ok(
      admin.client
        .from("coverage_audit_events")
        .select("action")
        .eq("entity_id", starters)
    )
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(["status_changed", "updated"])
    )
  })
})

describe("the team roster is for the venue manager and admins only", () => {
  const rpcs = [
    "coverage_staff_progress",
    "coverage_staff_progress_v2",
  ] as const

  beforeAll(async () => {
    for (const who of [staffA, colleagueA]) {
      await ok(
        legacyManager.client.rpc("set_monthly_target", {
          p_staff_id: who.id,
          p_venue_id: venueA,
          p_period_month: currentMonth(),
          p_target_count: 5,
        })
      )
    }
  })

  it("shows staff their own row and nobody else's", async () => {
    for (const rpc of rpcs) {
      const rows = await ok(
        staffA.client.rpc(rpc, {
          p_venue_id: venueA,
          p_period_month: currentMonth(),
        })
      )
      expect(rows.map((r) => r.staff_id)).toEqual([staffA.id])
      await fails(
        staffA.client.rpc(rpc, {
          p_venue_id: venueA,
          p_period_month: currentMonth(),
          p_staff_id: colleagueA.id,
        }),
        "not_venue_manager",
        "42501"
      )
    }
    const targets = await ok(
      staffA.client.from("monthly_targets").select("staff_id")
    )
    expect(targets.map((t) => t.staff_id)).toEqual([staffA.id])
    await fails(
      staffA.client.rpc("coverage_group_overview", {
        p_period_month: currentMonth(),
      }),
      "not_active_admin"
    )
  })

  it("shows another venue's manager none of this venue's people", async () => {
    for (const rpc of rpcs) {
      const rows = await ok(
        managerB.client.rpc(rpc, {
          p_venue_id: venueA,
          p_period_month: currentMonth(),
        })
      )
      expect(rows.map((r) => r.staff_id)).not.toContain(staffA.id)
      expect(rows.map((r) => r.staff_id)).not.toContain(colleagueA.id)
      await fails(
        managerB.client.rpc(rpc, {
          p_venue_id: venueA,
          p_period_month: currentMonth(),
          p_staff_id: staffA.id,
        }),
        "not_venue_manager",
        "42501"
      )
    }
    const targets = await ok(
      managerB.client
        .from("monthly_targets")
        .select("staff_id")
        .eq("venue_id", venueA)
    )
    expect(targets).toEqual([])
    await fails(
      managerB.client.rpc("coverage_group_overview", {
        p_period_month: currentMonth(),
      }),
      "not_active_admin"
    )
  })

  it("shows the venue's manager and admins everyone with their month", async () => {
    for (const who of [managerAccount, legacyManager, admin]) {
      for (const rpc of rpcs) {
        const rows = await ok(
          who.client.rpc(rpc, {
            p_venue_id: venueA,
            p_period_month: currentMonth(),
          })
        )
        const ids = rows.map((r) => r.staff_id)
        expect(ids).toEqual(expect.arrayContaining([staffA.id, colleagueA.id]))
        expect(rows.find((r) => r.staff_id === staffA.id)).toMatchObject({
          target_count: 5,
          accepted_count: 0,
        })
      }
    }
    expect(staffB.id).toBeTruthy()
  })
})
