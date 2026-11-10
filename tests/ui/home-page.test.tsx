// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { tasksView } from "./tasks-fixtures"

vi.mock("server-only", () => ({}))
// The B01 Home and badge; the B02 layout is tested in home-b02.test.tsx.
vi.stubEnv("NABALENS_HOME_LAYOUT", "b01")
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
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
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

const home = async () =>
  render(await TasksPage({ searchParams: Promise.resolve({}) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Home: Start here", () => {
  it("is offered to someone with no photos who has not dismissed it", async () => {
    setup()
    await home()
    expect(
      screen.getByRole("link", { name: "Start here" }).getAttribute("href")
    ).toBe("/staff/tasks/welcome")
  })

  it("is hidden once dismissed in the database", async () => {
    setup({
      work: {
        roleKey: null,
        roleTitle: null,
        workAreas: [],
        welcomeDismissedAt: "2026-11-06T10:00:00Z",
      },
    })
    await home()
    expect(screen.queryByRole("link", { name: "Start here" })).toBeNull()
  })

  it("treats the legacy cookie as dismissed", async () => {
    setup({ cookie: true })
    await home()
    expect(screen.queryByRole("link", { name: "Start here" })).toBeNull()
  })

  it("is hidden for anyone with a photo of their own", async () => {
    setup({ rows: [{ id: "a1" }] })
    await home()
    expect(screen.queryByRole("link", { name: "Start here" })).toBeNull()
  })
})

describe("Home: contribute and Our menu", () => {
  it("asks the role's question and shows menu items with an accepted photo", async () => {
    setup({
      work: {
        roleKey: "curry_chef",
        roleTitle: null,
        workAreas: [],
        welcomeDismissedAt: null,
      },
      rows: [{ id: "a1" }],
    })
    await home()
    expect(
      screen.getByRole("heading", { name: "What did you cook today?" })
    ).toBeTruthy()
    expect(
      screen.getByText((_, el) =>
        el?.tagName === "P"
          ? el.textContent === "12 of 40 menu items have an accepted photo"
          : false
      )
    ).toBeTruthy()
    // A separate card from the monthly photo target.
    expect(screen.getByRole("heading", { name: "Our menu" })).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Your photos for November 2026" })
    ).toBeTruthy()
  })

  it("never breaks when the menu read throws", async () => {
    setup({ menu: new Error("network") })
    await home()
    expect(
      screen.getByText("Menu photos can't be shown right now. Try again later.")
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy()
  })
})
