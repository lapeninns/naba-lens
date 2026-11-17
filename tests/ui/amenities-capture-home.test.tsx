// @vitest-environment jsdom
// Other jobs lists my open amenity checks (recheck first, with the manager's
// reason) and my open rechecks. Album Home's finding notice is tested in
// home-page.test.tsx.
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
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

const ACTOR = { profile: { id: "me" }, db: {} }

const auth = vi.hoisted(() => ({
  profile: {
    id: "me",
    displayName: "TEST Sam",
    avatarPath: null,
    department: "foh",
    venueId: "v1",
    venue: { id: "v1", name: "TEST Inn", active: true },
    work: null,
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
  listMyRetakeNotes: vi.fn(async () => ({ ok: true, notes: [] })),
}))
vi.mock("@/lib/server/coverage", () => coverage)
vi.mock("@/lib/server/media/library", () => ({ avatarUrl: () => null }))
const amenities = vi.hoisted(() => ({
  getMyAmenityTasks: vi.fn(),
}))
vi.mock("@/lib/server/amenities", () => amenities)
// No working list at this venue: the legacy screens.
const workingList = vi.hoisted(() => ({
  rechecks: [] as unknown[],
}))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: {
    getWorkingList: async () => ({ ok: true, view: null }),
    listMyRechecks: async () => ({ ok: true, tasks: workingList.rechecks }),
  },
}))

import OtherJobsPage from "@/app/staff/tasks/other/page"

function setup() {
  coverage.getCoverageActor.mockResolvedValue({ ok: true, actor: ACTOR })
  coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
  coverage.getCoverageScope.mockResolvedValue({
    ok: true,
    scope: tasksView().scope,
  })
}

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

describe("Other jobs: amenity checks", () => {
  it("lists each open check, recheck first with the reason", async () => {
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
    render(await OtherJobsPage())
    expect(
      screen.getByRole("heading", { level: 1, name: "Other jobs" })
    ).toBeTruthy()
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

  it("lists my open rechecks on Other jobs with their cause (B03-e)", async () => {
    setup()
    amenities.getMyAmenityTasks.mockResolvedValue({ ok: true, tasks: [] })
    workingList.rechecks = [
      {
        id: "r1",
        checkId: "c7",
        question: "Is the ramp still in place?",
        dueAt: "2026-11-20T00:00:00Z",
        cause: "policy_stale",
      },
    ]
    try {
      render(await OtherJobsPage())
      const list = screen.getByRole("list", { name: "Checks to do again" })
      const link = within(list).getByRole("link", {
        name: "Recheck: Is the ramp still in place?",
      })
      expect(link.getAttribute("href")).toBe(staffCaptureHref("c7"))
    } finally {
      workingList.rechecks = []
    }
  })
})

describe("Amenity check cards", () => {
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
    expect(heading.className).toContain("type-section-title")
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
    expect(cards[0].className.split(/\s+/)).toContain("rail-start-warn")
    expect(document.body.innerHTML).not.toContain("text-muted-foreground")
  })
})
