// @vitest-environment jsdom
// Staff Home: the "Amenity checks" section lists my open checks (recheck
// first, with the manager's reason) and Home still renders when that read
// fails or throws.
import { cleanup, render, screen, within } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AmenityTaskList } from "@/components/nabalens/amenities/capture"
import {
  UI_TEXT,
  staffCaptureHref,
  type MyAmenityTask,
} from "@/lib/amenities/contract"

import { tasksView } from "./tasks-fixtures"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
const jar = vi.hoisted(() => ({
  has: vi.fn<(name: string) => boolean>(() => false),
}))
vi.mock("next/headers", () => ({ cookies: async () => jar }))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({
    children,
    todoCount,
  }: {
    children: React.ReactNode
    todoCount?: number
  }) => <div data-todo={todoCount ?? ""}>{children}</div>,
}))

const media = vi.hoisted(() => ({ rows: [] as { id: string }[], fail: false }))
function db() {
  const query = {
    select: () => query,
    eq: () => query,
    limit: async () =>
      media.fail
        ? { data: null, error: { message: "boom" } }
        : { data: media.rows, error: null },
  }
  return { from: () => query }
}
const ACTOR = { profile: { id: "me" }, db: db() }

const auth = vi.hoisted(() => ({
  profile: {
    id: "me",
    displayName: "TEST Sam",
    avatarPath: null,
    department: "foh",
    venueId: "v1",
    venue: { id: "v1", name: "TEST Inn", active: true },
    work: null as null | Record<string, unknown>,
  },
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => auth.profile),
  uploadBlockReason: () => null,
}))
const coverage = vi.hoisted(() => ({
  getCoverageActor: vi.fn(),
  getCoverageScope: vi.fn(),
  getMyTasks: vi.fn(),
  getManagerReviewCount: vi.fn(),
  getOurMenu: vi.fn(),
}))
vi.mock("@/lib/server/coverage", () => coverage)
vi.mock("@/lib/server/community", () => ({
  listCommunityMedia: vi.fn(async () => ({ ok: true, items: [] })),
}))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: vi.fn(async () => ({ ok: true, actor: ACTOR })),
}))
vi.mock("@/lib/server/media/library", () => ({ avatarUrl: () => null }))
const amenities = vi.hoisted(() => ({
  getMyAmenityTasks: vi.fn(),
  getCheck: vi.fn(),
}))
vi.mock("@/lib/server/amenities", () => amenities)

import TasksPage from "@/app/staff/tasks/page"

function setup({
  work = null,
  cookie = false,
  rows = [],
  menu,
}: {
  work?: Record<string, unknown> | null
  cookie?: boolean
  rows?: { id: string }[]
  menu?: unknown
} = {}) {
  auth.profile.work = work
  jar.has.mockImplementation(() => cookie)
  media.rows = rows
  media.fail = false
  coverage.getCoverageActor.mockResolvedValue({ ok: true, actor: ACTOR })
  coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
  coverage.getCoverageScope.mockResolvedValue({
    ok: true,
    scope: tasksView().scope,
  })
  coverage.getOurMenu.mockImplementation(async () => {
    if (menu instanceof Error) throw menu
    return (
      menu ?? {
        ok: true,
        menu: {
          menuState: "ready",
          totals: { eligible: 40, covered: 12, gaps: 28, needsRecheck: 0 },
        },
      }
    )
  })
}

const home = async (params: Record<string, string> = {}) =>
  render(await TasksPage({ searchParams: Promise.resolve(params) }))

function task(
  id: string,
  question: string,
  overrides: Partial<MyAmenityTask> = {}
): MyAmenityTask {
  return {
    id,
    venueId: "v1",
    entry: {
      key: id,
      category: "Access",
      question,
      captureBrief: "Film the route in.",
      evidenceRule: "video",
      isCore: true,
      position: 1,
      version: 1,
    },
    status: "active",
    progress: "needs_capture",
    answer: "to_check",
    assignee: { id: "me", displayName: "TEST Sam" },
    answeredBy: null,
    answeredAt: null,
    recheckReason: null,
    notes: null,
    revision: 1,
    updatedAt: "2026-11-05T10:00:00.000Z",
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Home: amenity checks", () => {
  it("links each open check to its capture page, recheck first with the reason", async () => {
    setup()
    amenities.getMyAmenityTasks.mockResolvedValue({
      ok: true,
      tasks: [
        task("c1", "Is there step-free access?"),
        task("c2", "Is there guest Wi-Fi?", {
          progress: "needs_recheck",
          answer: "yes",
          recheckReason: "Password or QR visible",
        }),
      ],
    })
    await home()
    const list = screen.getByRole("list", { name: UI_TEXT.staffSection })
    const links = within(list).getAllByRole("link")
    expect(links.map((l) => l.textContent)).toEqual([
      "Is there guest Wi-Fi?",
      "Is there step-free access?",
    ])
    expect(links[0].getAttribute("href")).toBe(staffCaptureHref("c2"))
    expect(within(list).getByText("Password or QR visible")).toBeTruthy()
    expect(within(list).getByText("Needs recheck")).toBeTruthy()
    expect(within(list).getByText("Needs capture")).toBeTruthy()
  })

  it.each([
    [
      "fails",
      () => ({ ok: false, code: "unavailable", status: 503, message: "x" }),
    ],
    [
      "throws",
      () => {
        throw new Error("boom")
      },
    ],
  ])("Home still renders when the amenity read %s", async (_, impl) => {
    setup()
    amenities.getMyAmenityTasks.mockImplementation(async () => impl())
    const { container } = await home()
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeTruthy()
    expect(screen.queryByText(UI_TEXT.staffSection)).toBeNull()
    // Unknown is not "nothing": To do says so and offers a retry, and the
    // Home badge is left out rather than shown as zero.
    expect(screen.queryByText("Nothing to do right now.")).toBeNull()
    const todo = screen.getByRole("region", { name: /^To do/ })
    expect(within(todo).getByRole("alert").textContent).toContain(
      "We couldn't check your amenity checks."
    )
    expect(
      within(todo).getByRole("link", { name: "Try again" }).getAttribute("href")
    ).toBe("/staff/tasks")
    expect((container.firstElementChild as HTMLElement).dataset.todo).toBe("")
  })

  it("shows nothing when no check is waiting", async () => {
    setup()
    amenities.getMyAmenityTasks.mockResolvedValue({ ok: true, tasks: [] })
    await home()
    expect(screen.queryByText(UI_TEXT.staffSection)).toBeNull()
  })
})

describe("Home: amenity check cards", () => {
  // Common Room cards like the rest of Home, not the pre-redesign tokens.
  it("draws each check as a Common Room card with a section title", () => {
    render(
      <AmenityTaskList
        tasks={[
          task("c1", "Is there step-free access?"),
          task("c2", "Is there guest Wi-Fi?", {
            progress: "needs_recheck",
            recheckReason: "Password or QR visible",
          }),
        ]}
      />
    )
    const heading = screen.getByRole("heading", {
      level: 2,
      name: /Amenity checks/,
    })
    expect(heading.className).toContain("text-section-title")
    expect(heading.className).not.toContain("text-2xl")
    const cards = within(
      screen.getByRole("list", { name: UI_TEXT.staffSection })
    ).getAllByRole("listitem")
    for (const card of cards) {
      expect(card.className).toContain("rounded-card")
      expect(card.className).toContain("bg-surface")
      expect(card.className).not.toMatch(
        /\bbg-card\b|\brounded-xl\b|\bborder\b/
      )
    }
    // The recheck card carries the warn bar, like a replacement request.
    expect(cards[0].className).toContain("inset_4px_0_0_var(--warn-fg)")
    expect(document.body.innerHTML).not.toContain("text-muted-foreground")
  })
})

describe("Home: amenity checks in To do", () => {
  it("counts a staff member's only work, an amenity check, in To do and the Home badge", async () => {
    setup()
    amenities.getMyAmenityTasks.mockResolvedValue({
      ok: true,
      tasks: [
        task("c1", "Is there step-free access?"),
        task("c2", "Is there guest Wi-Fi?", { progress: "needs_recheck" }),
      ],
    })
    const { container } = await home()
    expect(screen.queryByText("Nothing to do right now.")).toBeNull()
    const todo = screen.getByRole("region", { name: /^To do/ })
    expect(
      within(todo)
        .getByRole("link", { name: "Start check: Is there guest Wi-Fi?" })
        .getAttribute("href")
    ).toBe(staffCaptureHref("c2"))
    expect((container.firstElementChild as HTMLElement).dataset.todo).toBe("2")
  })
})

describe("Home: Finding sent", () => {
  const sentCheck = (overrides: Partial<MyAmenityTask> = {}) => ({
    ok: true,
    detail: {
      check: task("c1", "Is there step-free access?", {
        progress: "complete",
        answer: "yes",
        answeredBy: { id: "me", displayName: "TEST Sam" },
        answeredAt: "2026-11-08T09:00:00.000Z",
        ...overrides,
      }),
    },
  })

  it("names the check once the database shows it complete and answered by me", async () => {
    setup()
    amenities.getMyAmenityTasks.mockResolvedValue({ ok: true, tasks: [] })
    amenities.getCheck.mockResolvedValue(sentCheck())
    await home({ finding_sent: "c1" })
    expect(amenities.getCheck).toHaveBeenCalledWith(ACTOR, { checkId: "c1" })
    const notice = screen
      .getByText("Finding sent")
      .closest<HTMLElement>('[role="status"]')!
    expect(notice).toBeTruthy()
    expect(notice.textContent).toContain("Is there step-free access?")
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy()
  })

  it.each([
    ["answered by someone else", { answeredBy: { id: "x", displayName: "X" } }],
    ["reopened since", { progress: "needs_recheck" as const }],
  ])("says nothing when the check was %s", async (_, overrides) => {
    setup()
    amenities.getMyAmenityTasks.mockResolvedValue({ ok: true, tasks: [] })
    amenities.getCheck.mockResolvedValue(sentCheck(overrides))
    await home({ finding_sent: "c1" })
    expect(screen.queryByText("Finding sent")).toBeNull()
  })

  it("never reads a check without the parameter, and survives a failed read", async () => {
    setup()
    amenities.getMyAmenityTasks.mockResolvedValue({ ok: true, tasks: [] })
    await home()
    expect(amenities.getCheck).not.toHaveBeenCalled()
    amenities.getCheck.mockRejectedValue(new Error("down"))
    cleanup()
    await home({ finding_sent: "c1" })
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeTruthy()
    expect(screen.queryByText("Finding sent")).toBeNull()
  })
})
