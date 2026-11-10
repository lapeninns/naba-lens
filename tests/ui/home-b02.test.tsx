// @vitest-environment jsdom
// Staff Home on the B02 layout (UI design §3): To do around next actions,
// one home per piece of work, the compact This month card and the switch.
import { Suspense } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AlsoThisMonth,
  ThisMonthCard,
} from "@/components/nabalens/home/this-month-card"
import { AddProvider } from "@/components/nabalens/shell/add-context"
import { HomeOverview } from "@/components/nabalens/tasks/home-overview"
import { TasksOverview } from "@/components/nabalens/tasks/tasks-overview"

import { amenityCheck, slot } from "./home-b02-fixtures"
import {
  assignment,
  monthly,
  needsAnother,
  PROFILE,
  tasksView,
} from "./tasks-fixtures"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/staff/tasks",
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
vi.mock("next/headers", () => ({ cookies: async () => ({ has: () => false }) }))
const shell = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({
    children,
    ...props
  }: { children: React.ReactNode } & Record<string, unknown>) => {
    shell.props = props
    return <div>{children}</div>
  },
}))

const ACTOR = {
  profile: { id: "me", venueId: "v1", active: true },
  db: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        limit: async () => ({ data: [{ id: "a" }], error: null }),
      }
      return query
    },
  },
}
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => ({
    id: "me",
    displayName: "TEST Sam",
    avatarPath: null,
    department: "foh",
    venueId: "v1",
    venue: { id: "v1", name: "TEST Inn", active: true },
    work: null,
  })),
  uploadBlockReason: () => null,
}))
const coverage = vi.hoisted(() => ({
  getCoverageActor: vi.fn(),
  getCoverageScope: vi.fn(),
  getMyTasks: vi.fn(),
  getManagerReviewCount: vi.fn(),
  getOurMenu: vi.fn(),
  listMyMenuPhotoDecisions: vi.fn(),
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
const knowledge = vi.hoisted(() => ({
  getWorkingList: vi.fn(),
  getMyPending: vi.fn(),
  listMyRechecks: vi.fn(async () => ({ ok: true, tasks: [] })),
}))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: knowledge,
}))
const work = vi.hoisted(() => ({
  getLabelWork: vi.fn(),
  getCapabilities: vi.fn(),
}))
vi.mock("@/lib/work-client/services", () => ({ workServices: work }))

import TasksLoading from "@/app/staff/tasks/loading"
import TasksPage from "@/app/staff/tasks/page"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  shell.props = null
})

const base = {
  profile: PROFILE,
  tasksPath: "/staff/tasks",
  portfolioPath: "/staff",
}

function todo() {
  return screen
    .getByRole("heading", { level: 2, name: /^To do/ })
    .closest("section") as HTMLElement
}

const cardTitles = () =>
  within(todo())
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent)

describe("B02 To do", () => {
  it("orders the cards and gives the lead card the one primary action", () => {
    const overdue = assignment({
      title: "Mains",
      progress: { ...assignment().requirement.progress, overdue: true },
    })
    render(
      <HomeOverview
        {...base}
        tasks={tasksView({
          assignments: [overdue],
          needsAnotherPhoto: [needsAnother("Too blurry")],
        })}
        amenityTasks={[amenityCheck("c1")]}
        labelWork={{ needsLabels: 2, needsAttention: 0 }}
      />
    )
    expect(cardTitles()).toEqual([
      "TEST Morgan asked for another photo",
      "Mains is overdue",
      "2 photos need labels",
      "Question c1?",
    ])
    expect(
      screen.getByRole("heading", { level: 2, name: "To do, 5 things to do" })
    ).toBeTruthy()
  })

  it("leads with uploads that didn't finish on this phone, counted in the heading", () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd, failed: 2 }}>
        <HomeOverview
          {...base}
          tasks={tasksView()}
          amenityTasks={[amenityCheck("c1")]}
        />
      </AddProvider>
    )
    const first = within(todo()).getAllByRole("listitem")[0]
    expect(within(first).getByText("On this phone")).toBeTruthy()
    expect(
      within(first).getByRole("heading", {
        name: "2 photos didn't finish saving",
      })
    ).toBeTruthy()
    fireEvent.click(within(first).getByRole("button", { name: "See them" }))
    expect(openAdd).toHaveBeenCalledOnce()
    expect(
      screen.getByRole("heading", { level: 2, name: "To do, 3 things to do" })
    ).toBeTruthy()
  })

  it("shows three assigned checks, then Show all N expands in place", () => {
    render(
      <HomeOverview
        {...base}
        tasks={tasksView()}
        amenityTasks={["a", "b", "c", "d", "e"].map((id) => amenityCheck(id))}
      />
    )
    expect(cardTitles()).toHaveLength(3)
    expect(screen.queryByText(/more checks below/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show all 5" }))
    expect(cardTitles()).toHaveLength(5)
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Start check: Question d?" })
    )
  })

  it("words the labels card and hides it when the read is missing", () => {
    const { rerender } = render(
      <HomeOverview
        {...base}
        tasks={tasksView()}
        labelWork={{ needsLabels: 3, needsAttention: 1 }}
      />
    )
    expect(screen.getByRole("heading", { name: "3 photos need labels" }))
    expect(screen.getByText("1 label save needs attention")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Label these" }).getAttribute("href")
    ).toBe("/staff#needs-labels-heading")
    rerender(<HomeOverview {...base} tasks={tasksView()} labelWork={null} />)
    expect(screen.queryByText(/need labels/)).toBeNull()
    expect(screen.getByText("Nothing to do right now.")).toBeTruthy()
  })

  it("says when the labels or better-photo reads failed, never that there is nothing", () => {
    render(
      <HomeOverview
        {...base}
        tasks={tasksView()}
        labelWorkError
        retakes={null}
      />
    )
    expect(
      screen.getByText("We couldn't check which photos need labels.")
    ).toBeTruthy()
    expect(
      screen.getByText("We couldn't check requests for a better photo.")
    ).toBeTruthy()
    expect(screen.queryByText("Nothing to do right now.")).toBeNull()
  })

  it("asks for a better photo without naming the reviewer", () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd }}>
        <HomeOverview
          {...base}
          tasks={tasksView()}
          retakes={[
            {
              photoId: "p1",
              itemId: "i1",
              variantId: null,
              itemName: "Fish pie",
              variantName: null,
              reason: "Too dark",
            },
          ]}
        />
      </AddProvider>
    )
    expect(
      screen.getByRole("heading", {
        name: "A reviewer asked for a better photo: Too dark",
      })
    ).toBeTruthy()
    expect(screen.queryByText(/TEST Morgan/)).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "Take a new photo of Fish pie" })
    )
    expect(openAdd).toHaveBeenCalledWith({
      source: "camera",
      imagesOnly: true,
      preset: {
        itemId: "i1",
        variantId: null,
        itemName: "Fish pie",
        variantName: null,
      },
    })
  })
})

describe("B02 one home per piece of work", () => {
  it("keeps working-list rows that need me in To do only", () => {
    render(
      <HomeOverview
        {...base}
        tasks={tasksView()}
        workingList={{
          venue: { id: "v1", name: "TEST Inn" },
          slots: [
            slot("s1", { assignee: { firstName: "Sam", isMe: true } }),
            slot("s2"),
          ],
        }}
        amenityTasks={[amenityCheck("s1")]}
      />
    )
    expect(
      within(todo()).getByRole("link", { name: "Start check: Question s1?" })
    ).toBeTruthy()
    const list = screen.getByRole("list", { name: "Amenity checks" })
    expect(within(list).queryByText("Slot s1?")).toBeNull()
    expect(within(list).getByText("Slot s2?")).toBeTruthy()
    // Said in the list's own intro, under its heading.
    expect(
      screen.getByText(
        /Anyone working here can help answer them\. 1 more is in To do\.$/
      )
    ).toBeTruthy()
    // Never two Amenity checks headings.
    expect(
      screen.getAllByRole("heading", { level: 2, name: /^Amenity checks/ })
    ).toHaveLength(1)
  })

  it("lists other tasks this month and counts the ones in To do", () => {
    const overdue = assignment({
      title: "Mains",
      progress: { ...assignment().requirement.progress, overdue: true },
    })
    const later = assignment({ title: "Starters" })
    render(
      <HomeOverview
        {...base}
        tasks={tasksView({ assignments: [overdue, later] })}
      />
    )
    expect(screen.queryByRole("heading", { name: "All tasks" })).toBeNull()
    const section = screen
      .getByRole("heading", { name: "Other tasks this month" })
      .closest("section") as HTMLElement
    expect(within(section).getByText("1 more is in To do.")).toBeTruthy()
    expect(within(section).getByText("Starters")).toBeTruthy()
    expect(within(section).queryByText("Mains")).toBeNull()
  })
})

describe("B02 This month", () => {
  it("replaces the monthly and menu cards with one card on Home", () => {
    render(
      <HomeOverview
        {...base}
        tasks={tasksView({ monthly: monthly({ needsAnotherPhoto: 2 }) })}
        ourMenu={{ state: "ready", covered: 12, total: 40 }}
      />
    )
    const card = screen
      .getByRole("heading", { level: 2, name: "This month" })
      .closest("section") as HTMLElement
    expect(
      within(card).getByRole("progressbar").getAttribute("aria-label")
    ).toBe("3 of 5 photos accepted")
    expect(card.textContent).toContain("3 of 5 accepted")
    expect(card.textContent).toContain(
      "12 of 40 menu items have an accepted photo"
    )
    expect(card.textContent).not.toContain("replacing")
    expect(
      within(card)
        .getByRole("link", { name: "See this month" })
        .getAttribute("href")
    ).toBe("/staff/tasks/month")
    expect(
      within(card)
        .getByRole("link", { name: "Browse our menu" })
        .getAttribute("href")
    ).toBe("/staff/menu")
    expect(screen.queryByRole("heading", { name: "Our menu" })).toBeNull()
    expect(
      screen.queryByRole("heading", { name: /^Your photos for/ })
    ).toBeNull()
  })

  it("streams the Also this month lines", async () => {
    let resolve!: (v: {
      awaitingConfirmation: number
      unknownRecorded: number
    }) => void
    const pending = new Promise<{
      awaitingConfirmation: number
      unknownRecorded: number
    }>((r) => (resolve = r))
    // A boundary waiting on use() resolves only inside an awaited act.
    await act(async () => {
      render(
        <ThisMonthCard
          monthly={monthly()}
          ourMenu={null}
          also={
            <Suspense fallback={<p>loading lines</p>}>
              <AlsoThisMonth pending={pending} />
            </Suspense>
          }
        />
      )
    })
    expect(screen.getByText("loading lines")).toBeTruthy()
    await act(async () =>
      resolve({ awaitingConfirmation: 2, unknownRecorded: 0 })
    )
    expect(
      await screen.findByText(/Also this month: 2 findings waiting/)
    ).toBeTruthy()
  })
})

describe("Home switch (homeLayout)", () => {
  beforeEach(() => {
    coverage.getCoverageActor.mockResolvedValue({ ok: true, actor: ACTOR })
    coverage.getCoverageScope.mockResolvedValue({
      ok: true,
      scope: tasksView().scope,
    })
    coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
    coverage.getOurMenu.mockResolvedValue({
      ok: true,
      menu: {
        menuState: "ready",
        totals: { eligible: 40, covered: 12, gaps: 28, needsRecheck: 0 },
      },
    })
    coverage.listMyMenuPhotoDecisions.mockResolvedValue({
      ok: true,
      states: [],
    })
    amenities.getMyAmenityTasks.mockResolvedValue({
      ok: true,
      tasks: [amenityCheck("c1")],
    })
    knowledge.getWorkingList.mockResolvedValue({ ok: true, view: null })
    knowledge.getMyPending.mockResolvedValue({
      ok: true,
      pending: { awaitingConfirmation: 1, unknownRecorded: 0 },
    })
    work.getLabelWork.mockResolvedValue({
      status: "ok",
      value: { needsLabels: 2, needsAttention: 0 },
    })
    work.getCapabilities.mockResolvedValue({
      status: "ok",
      value: { canLabel: true },
    })
  })

  async function home() {
    const page = await TasksPage({ searchParams: Promise.resolve({}) })
    await act(async () => {
      render(page)
    })
  }

  it("renders the B02 Home by default, with the badge counting labels", async () => {
    await home()
    expect(screen.getByRole("heading", { name: "This month" })).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Other tasks this month" })
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "2 photos need labels" }))
    expect(shell.props).toMatchObject({ todoCount: 3, todoUnknown: false })
    expect(
      await screen.findByText(/Also this month: 1 finding waiting/)
    ).toBeTruthy()
  })

  it("hides the labels card for an account that can't label", async () => {
    work.getCapabilities.mockResolvedValue({
      status: "ok",
      value: { canLabel: false },
    })
    await home()
    expect(screen.queryByText(/need labels/)).toBeNull()
    expect(shell.props).toMatchObject({ todoCount: 1 })
  })

  it("keeps the B02 Home's badge unknown when the labels read fails", async () => {
    work.getLabelWork.mockResolvedValue({
      status: "failed",
      failure: { ok: false, code: "unavailable", status: 503, message: "x" },
    })
    await home()
    expect(
      screen.getByText("We couldn't check which photos need labels.")
    ).toBeTruthy()
    expect(shell.props).toMatchObject({
      todoCount: undefined,
      todoUnknown: true,
    })
  })

  it("renders today's Home exactly with b01", async () => {
    vi.stubEnv("NABALENS_HOME_LAYOUT", "b01")
    await home()
    expect(screen.getByRole("heading", { name: "All tasks" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Our menu" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "This month" })).toBeNull()
    expect(work.getLabelWork).not.toHaveBeenCalled()
    expect(coverage.listMyMenuPhotoDecisions).not.toHaveBeenCalled()
    expect(shell.props).toMatchObject({ todoCount: 1 })
  })

  it("names the task list in the loading skeleton to match", () => {
    const { unmount } = render(<TasksLoading />)
    expect(
      screen.getByRole("heading", { name: "Other tasks this month" })
    ).toBeTruthy()
    unmount()
    vi.stubEnv("NABALENS_HOME_LAYOUT", "b01")
    render(<TasksLoading />)
    expect(screen.getByRole("heading", { name: "All tasks" })).toBeTruthy()
  })
})

describe("B01 Home: two lists of checks are named apart (HM-11)", () => {
  it("calls the legacy list Other amenity checks next to the working list", () => {
    render(
      <TasksOverview
        {...base}
        tasks={tasksView()}
        workingList={{
          venue: { id: "v1", name: "TEST Inn" },
          slots: [slot("s2")],
        }}
        amenityTasks={[amenityCheck("x9")]}
      />
    )
    expect(
      screen.getByRole("heading", { level: 2, name: /^Amenity checks/ })
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: /^Other amenity checks/ })
    ).toBeTruthy()
  })

  it("keeps the legacy heading when there is no working list", () => {
    render(
      <TasksOverview
        {...base}
        tasks={tasksView()}
        amenityTasks={[amenityCheck("x9")]}
      />
    )
    expect(
      screen.getByRole("heading", { name: /^Amenity checks/ })
    ).toBeTruthy()
    expect(screen.queryByRole("heading", { name: /^Other amenity/ })).toBeNull()
  })
})
