// B02 Home's To do model (UI design §2, §3.1) and the homeLayout switch (§3.6).
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  checkKey,
  nextActions,
  taskKey,
  tasksInTodo,
  type RetakeRequest,
} from "@/components/nabalens/tasks/next-actions-model"
import type { WorkingSlot } from "@/lib/knowledge-client/contract"
import { todoBadge } from "@/lib/work-client/todo"

import { assignment, due, needsAnother, tasksView } from "../ui/tasks-fixtures"
import { amenityCheck, slot } from "../ui/home-b02-fixtures"

vi.mock("server-only", () => ({}))

const NOW = new Date("2026-11-20T12:00:00.000Z")

const retake = (photoId: string): RetakeRequest => ({
  photoId,
  itemId: "i1",
  variantId: null,
  itemName: "Fish pie",
  variantName: null,
  reason: "Too dark",
})

describe("nextActions (D1 order)", () => {
  it("puts someone waiting on me first, then rechecks, overdue, labels, checks, due soon, setup and review", () => {
    const overdue = assignment({
      title: "Mains",
      progress: { ...assignment().requirement.progress, overdue: true },
    })
    const soon = assignment({
      title: "Desserts",
      due: due({ dueAt: "2026-11-22T00:00:00.000Z" }),
    })
    const actions = nextActions({
      tasks: tasksView({
        scope: {
          ...tasksView().scope,
          setup: { complete: false, missing: ["team"] },
        },
        assignments: [soon, overdue],
        needsAnotherPhoto: [needsAnother("Blurry")],
      }),
      now: NOW,
      reviewCount: 2,
      amenityChecks: [
        amenityCheck("c1"),
        amenityCheck("c2", {
          progress: "needs_recheck",
          recheckReason: "Moved",
        }),
      ],
      retakes: [retake("p1")],
      labels: { needsLabels: 3, needsAttention: 1 },
    })
    expect(actions.map((a) => a.kind)).toEqual([
      "replacement",
      "retake",
      "recheck",
      "overdue",
      "labels",
      "check",
      "due_soon",
      "setup",
      "review_photos",
    ])
    // Grouped cards count their members: labels 3 + 1, review 2.
    expect(todoBadge(actions, false)).toBe(1 + 1 + 1 + 1 + 4 + 1 + 1 + 1 + 2)
    expect(todoBadge(actions, true)).toBeNull()
  })

  it("leads with setup when it blocks sending", () => {
    const actions = nextActions({
      tasks: tasksView({
        scope: {
          ...tasksView().scope,
          canSubmit: false,
          setup: { complete: false, missing: ["venue"] },
        },
        needsAnotherPhoto: [needsAnother("Blurry")],
      }),
      now: NOW,
    })
    expect(actions[0]).toMatchObject({ kind: "setup", blocking: true })
  })

  it("moves working-list rows that need me into To do and leaves the rest on the list", () => {
    const actions = nextActions({
      tasks: tasksView(),
      now: NOW,
      slots: [
        slot("s1", { assignee: { firstName: "Sam", isMe: true } }),
        slot("s2", {
          myLatest: {
            state: "needs_attention",
            managerNote: "Which door?",
          } as WorkingSlot["myLatest"],
        }),
        slot("s3"),
        slot("s4", {
          assignee: { firstName: "Sam", isMe: true },
          progress: "needs_recheck",
        }),
      ],
      // On the working list: its row decides, not the old list.
      amenityChecks: [amenityCheck("s1"), amenityCheck("off")],
    })
    expect(actions.map((a) => [a.kind, a.key])).toEqual([
      ["finding", checkKey("s2")],
      ["recheck", checkKey("s4")],
      ["check", checkKey("s1")],
      ["check", checkKey("off")],
    ])
    const s1 = actions.find((a) => a.key === checkKey("s1"))
    expect(s1).toMatchObject({ check: { action: "Start check" } })
  })

  it("leaves out a check whose finding of mine waits for confirmation (HM-01)", () => {
    const actions = nextActions({
      tasks: tasksView(),
      now: NOW,
      slots: [
        slot("s1", {
          assignee: { firstName: "Sam", isMe: true },
          myLatest: {
            state: "awaiting_confirmation",
          } as WorkingSlot["myLatest"],
        }),
      ],
      amenityChecks: [amenityCheck("s1")],
    })
    expect(actions).toEqual([])
  })

  it("counts a closed replacement as nothing to do", () => {
    const closed = needsAnother("Blurry", {
      requirement: { id: "gone", title: "Old task" } as never,
    })
    const actions = nextActions({
      tasks: tasksView({ needsAnotherPhoto: [closed] }),
      now: NOW,
    })
    expect(actions).toHaveLength(1)
    expect(todoBadge(actions, false)).toBe(0)
  })

  it("has no labels card without counts, and none at zero", () => {
    expect(nextActions({ tasks: tasksView(), labels: null })).toEqual([])
    expect(
      nextActions({
        tasks: tasksView(),
        labels: { needsLabels: 0, needsAttention: 0 },
      })
    ).toEqual([])
  })
})

describe("tasksInTodo", () => {
  it("names overdue, due-soon and replacing tasks, not the others", () => {
    const overdue = assignment({
      progress: { ...assignment().requirement.progress, overdue: true },
    })
    const later = assignment({
      due: due({ dueAt: "2027-01-01T00:00:00.000Z" }),
    })
    const replacing = assignment()
    const actions = nextActions({
      tasks: tasksView({
        assignments: [overdue, later, replacing],
        needsAnotherPhoto: [
          needsAnother("Blurry", {
            requirement: replacing.requirement as never,
          }),
        ],
      }),
      now: NOW,
    })
    const keys = tasksInTodo(actions)
    expect(keys.has(taskKey(overdue.requirement.id))).toBe(true)
    expect(keys.has(taskKey(replacing.requirement.id))).toBe(true)
    expect(keys.has(taskKey(later.requirement.id))).toBe(false)
  })
})

describe("homeLayout", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("defaults to b02, and b01 restores the B01 Home", async () => {
    const { homeLayout } = await import("@/lib/config/home-layout")
    vi.stubEnv("NABALENS_HOME_LAYOUT", "")
    expect(homeLayout("v1")).toBe("b02")
    vi.stubEnv("NABALENS_HOME_LAYOUT", "b01")
    expect(homeLayout("v1")).toBe("b01")
    vi.stubEnv("NABALENS_HOME_LAYOUT", "nonsense")
    expect(homeLayout()).toBe("b02")
  })

  it("keeps listed venues on b01", async () => {
    const { homeLayout } = await import("@/lib/config/home-layout")
    vi.stubEnv("NABALENS_HOME_LAYOUT", "b02")
    vi.stubEnv("NABALENS_HOME_LAYOUT_B01_VENUES", "v1, v2")
    expect(homeLayout("v2")).toBe("b01")
    expect(homeLayout("v3")).toBe("b02")
    expect(homeLayout(null)).toBe("b02")
  })
})

describe("recheck tasks in To do (B03 UI §6.2)", () => {
  const task = (checkId: string, over: Record<string, unknown> = {}) => ({
    taskId: `t-${checkId}`,
    checkId,
    venueId: "v1",
    questionKey: "onsite_parking",
    question: `⟨Question ${checkId}⟩`,
    cause: "expired" as const,
    use: "internal" as const,
    dueAt: "2026-11-18T00:00:00.000Z",
    ...over,
  })

  it("makes each open task its check's recheck card, in due order, never twice", () => {
    const actions = nextActions({
      tasks: tasksView(),
      now: NOW,
      amenityChecks: [amenityCheck("c1"), amenityCheck("c2")],
      rechecks: [
        task("c2", { dueAt: "2026-11-25T00:00:00.000Z", cause: "due_soon" }),
        task("c1"),
      ],
    })
    const rechecks = actions.filter((a) => a.kind === "recheck")
    expect(rechecks.map((a) => a.key)).toEqual([checkKey("c1"), checkKey("c2")])
    expect(actions.filter((a) => a.key === checkKey("c1"))).toHaveLength(1)
    const first = rechecks[0]
    if (first.kind !== "recheck") throw new Error("recheck")
    expect(first.check).toMatchObject({
      question: "⟨Question c1⟩",
      action: "Recheck",
      recheckReason: "Past its check date since 18 Nov 2026.",
    })
    expect(todoBadge(actions, false)).toBe(2)
  })

  it("names the previous answer when the working list has it", () => {
    const actions = nextActions({
      tasks: tasksView(),
      now: NOW,
      slots: [slot("c1", { previousAnswer: "yes" })],
      rechecks: [task("c1")],
    })
    const card = actions.find((a) => a.key === checkKey("c1"))
    if (card?.kind !== "recheck") throw new Error("recheck")
    expect(card.check.recheckReason).toBe(
      "Past its check date since 18 Nov 2026. Previous answer: Yes."
    )
  })

  it("leaves a manager's question about my finding as its own card", () => {
    const asked = slot("c1", {
      myLatest: { state: "needs_attention", managerNote: "⟨Note⟩" } as never,
    })
    const actions = nextActions({
      tasks: tasksView(),
      now: NOW,
      slots: [asked],
      rechecks: [task("c1")],
    })
    expect(
      actions.filter((a) => a.key === checkKey("c1")).map((a) => a.kind)
    ).toEqual(["finding"])
  })
})
