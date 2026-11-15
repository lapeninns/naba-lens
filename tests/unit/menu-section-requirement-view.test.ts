// G-8 (v0.5 rules 22 and 23): a menu section is shared by the venue. Its view
// has no assignees, no due date, no Overdue and never asks for an assignee or
// a reassignment, even when old rows say otherwise. Other kinds keep them.
import { describe, expect, it } from "vitest"

import { coverageRpcFailure } from "@/lib/server/coverage/errors"
import {
  requirementView,
  type RequirementRow,
} from "@/lib/server/coverage/views"

function row(overrides: Partial<RequirementRow> = {}): RequirementRow {
  return {
    requirement_id: "bbbbbbbb-0000-4000-8000-000000000001",
    venue_id: "aaaaaaaa-0000-4000-8000-000000000001",
    kind: "service",
    title: "Bar area",
    guidance: null,
    photo_target: 2,
    due_on: "2026-11-05",
    status: "active",
    status_reason: null,
    amenity_key: null,
    menu_plan_id: null,
    menu_plan_status: null,
    menu_version_id: null,
    section_snapshot: null,
    revision: 3,
    is_current: true,
    accepted_count: 0,
    pending_count: 0,
    needs_another_photo_count: 0,
    evidence_removed_count: 0,
    satisfied: false,
    overdue: true,
    assignee_ids: [],
    needs_reassignment: true,
    amenity_presence: null,
    amenity_confirmed: false,
    ...overrides,
  } as RequirementRow
}

const OLD_ASSIGNEE = "cccccccc-0000-4000-8000-000000000001"
const people = new Map([
  [
    OLD_ASSIGNEE,
    {
      id: OLD_ASSIGNEE,
      displayName: "TEST Priya Gurung",
      avatarUrl: null,
      department: null,
      jobTitle: null,
      active: true,
    },
  ],
])

describe("requirementView for menu sections", () => {
  it("drops assignees, due date, Overdue and reassignment", () => {
    const view = requirementView(
      row({
        kind: "menu_section",
        menu_plan_id: "dddddddd-0000-4000-8000-000000000001",
        menu_plan_status: "confirmed",
        menu_version_id: "dddddddd-0000-4000-8000-000000000002",
        section_snapshot: { name: "Starters", position: 1 },
        assignee_ids: [OLD_ASSIGNEE],
      }),
      people
    )
    expect(view).toMatchObject({
      kind: "menu_section",
      due: null,
      assigneeIds: [],
      assignees: [],
      needsReassignment: false,
      setupIssues: [],
      progress: { overdue: false },
    })
  })

  it("never asks for an assignee on an active section with none", () => {
    const view = requirementView(
      row({ kind: "menu_section", needs_reassignment: false, overdue: false }),
      people
    )
    expect(view.setupIssues).not.toContain("no_assignees")
  })

  it("keeps assignees, due date and Overdue for other work (rule 28)", () => {
    const view = requirementView(row(), people)
    expect(view.due).toMatchObject({ dueOn: "2026-11-05", overdue: true })
    expect(view.progress.overdue).toBe(true)
    expect(view.needsReassignment).toBe(true)
    expect(view.setupIssues).toEqual(["no_assignees", "needs_reassignment"])
    const assigned = requirementView(
      row({ assignee_ids: [OLD_ASSIGNEE], needs_reassignment: false }),
      people
    )
    expect(assigned.assignees.map((p) => p.displayName)).toEqual([
      "TEST Priya Gurung",
    ])
  })
})

describe("menu-section refusals", () => {
  it("map to plain state conflicts", () => {
    for (const [message, text] of [
      [
        "menu_section_shared",
        "Menu sections are shared by everyone at the venue. Nobody is assigned to them.",
      ],
      ["menu_section_no_due_date", "Menu sections have no due date."],
    ]) {
      expect(
        coverageRpcFailure({ message, code: "P0001", details: "" }, "test")
      ).toMatchObject({ ok: false, code: "state_conflict", message: text })
    }
  })
})
