// @vitest-environment jsdom
// G-4 (docs/plans/goals-not-tasks.md): a menu-section task page goes to Our
// menu unless it answers an open "needs another photo" request; other kinds
// are unchanged; Other jobs lists everything but menu sections.
import { cleanup, render, screen } from "@testing-library/react"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  assignment,
  ME,
  needsAnother,
  PROFILE,
  submission,
  tasksView,
  uuid,
} from "./tasks-fixtures"

vi.mock("server-only", () => ({}))
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`)
  }
}
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/staff/tasks/x",
  redirect: (url: string) => {
    throw new Redirect(url)
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => PROFILE),
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock("@/app/staff/_shell/shell-status", () => ({
  staffShellStatus: vi.fn(async () => ({})),
}))
vi.mock("@/app/staff/tasks/task-submit", () => ({
  TaskSubmit: () => <div>Send controls</div>,
}))
const coverage = vi.hoisted(() => ({
  getCoverageActor: vi.fn(),
  getCoverageScope: vi.fn(),
  getMyAssignment: vi.fn(),
  listMySubmittablePhotos: vi.fn(),
}))
vi.mock("@/lib/server/coverage", () => coverage)
const route = vi.hoisted(() => ({ getMyRequirementRoute: vi.fn() }))
vi.mock("@/lib/server/coverage/requirement-route", async (original) => ({
  ...(await original<object>()),
  ...route,
}))

import AllTasksRedirect from "@/app/staff/tasks/all/page"
import TaskPage from "@/app/staff/tasks/[requirementId]/page"
import { otherJobs } from "@/components/nabalens/tasks"

const SECTION = uuid("9d")

function setup(kind: string, mine = assignment()) {
  coverage.getCoverageActor.mockResolvedValue({
    ok: true,
    actor: { profile: { id: ME.id, role: "staff" } },
  })
  coverage.getCoverageScope.mockResolvedValue({
    ok: true,
    scope: tasksView().scope,
  })
  coverage.getMyAssignment.mockResolvedValue({ ok: true, assignment: mine })
  coverage.listMySubmittablePhotos.mockResolvedValue({
    ok: true,
    items: [],
    nextCursor: null,
  })
  route.getMyRequirementRoute.mockResolvedValue({
    ok: true,
    route: {
      kind,
      menuSectionId: kind === "menu_section" ? SECTION : null,
    },
  })
}

const visit = (id: string, search: Record<string, string> = {}) =>
  TaskPage({
    params: Promise.resolve({ requirementId: id }),
    searchParams: Promise.resolve(search),
  })

async function redirectOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise
    return null
  } catch (error) {
    if (error instanceof Redirect) return error.url
    throw error
  }
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe("menu-section task pages (G-4)", () => {
  it("send a menu section to Our menu's Still needed dishes, before the full read", async () => {
    setup("menu_section")
    const mine = assignment()
    expect(await redirectOf(visit(mine.requirement.id))).toBe(
      `/staff/album/menu?section=${SECTION}&show=needed`
    )
    expect(route.getMyRequirementRoute).toHaveBeenCalledWith(
      expect.anything(),
      { requirementId: mine.requirement.id }
    )
    expect(coverage.getMyAssignment).not.toHaveBeenCalled()
  })

  it("redirect when ?replaces= names no open request", async () => {
    const answered = needsAnother("Too dark")
    const mine = assignment(
      {},
      {
        mySubmissions: [
          submission({ id: uuid("7e"), replacesSubmissionId: answered.id }),
          answered,
        ],
      }
    )
    setup("menu_section", mine)
    expect(
      await redirectOf(visit(mine.requirement.id, { replaces: answered.id }))
    ).toBe(`/staff/album/menu?section=${SECTION}&show=needed`)
  })

  it("still serve an open request sent before the cut-over, without task words", async () => {
    const asked = needsAnother("Too dark, use the pass lights.")
    const mine = assignment({}, { mySubmissions: [asked] })
    setup("menu_section", mine)
    const page = await visit(mine.requirement.id, { replaces: asked.id })
    render(page as React.ReactElement)
    expect(
      screen.getByRole("heading", { level: 1, name: "Send another photo" })
    ).toBeTruthy()
    expect(
      screen.getAllByText("Too dark, use the pass lights.").length
    ).toBeGreaterThan(0)
    expect(screen.getByText("Send controls")).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Your photos for this section" })
    ).toBeTruthy()
    // No task post (due date, Overdue) for menu work.
    expect(document.body.textContent).not.toMatch(/\btask\b|overdue|due /i)
  })
})

describe("other task pages (G-4)", () => {
  it.each(["service", "venue_specific", "amenity"])(
    "a %s task is served as before",
    async (kind) => {
      const mine = assignment({ kind: kind as "service", title: "Bar set-up" })
      setup(kind, mine)
      expect(
        await redirectOf(
          visit(mine.requirement.id).then((page) => {
            render(page as React.ReactElement)
          })
        )
      ).toBeNull()
      expect(
        screen.getByRole("heading", { name: "Your photos for this task" })
      ).toBeTruthy()
      expect(screen.getByText("Bar set-up")).toBeTruthy()
    }
  )
})

describe("Other jobs (G-4)", () => {
  it("lists everything but menu sections", () => {
    const starters = assignment({ title: "Starters", kind: "menu_section" })
    const bar = assignment({ id: uuid("1b"), title: "Bar", kind: "service" })
    const room = assignment({
      id: uuid("2c"),
      title: "Function room",
      kind: "venue_specific",
    })
    const view = otherJobs(tasksView({ assignments: [starters, bar, room] }))
    expect(view.assignments.map((a) => a.requirement.title)).toEqual([
      "Bar",
      "Function room",
    ])
  })

  it("All tasks redirects to Other jobs", () => {
    let url: string | null = null
    try {
      AllTasksRedirect()
    } catch (error) {
      url = (error as Redirect).url
    }
    expect(url).toBe("/staff/tasks/other")
  })
})
