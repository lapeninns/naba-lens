// @vitest-environment jsdom
// Goal-led staff Home (goals-not-tasks G-1, decisions 9 to 12): Our menu with
// the dishes still needed, Your month and the retake note, one main action,
// no task, due date or Overdue for menu work, and the badge counting cards.
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

import { GoalsHome } from "@/components/nabalens/home/goals-home"
import {
  goalsHomeCards,
  goalsPrimary,
  otherJobsCount,
  type OurMenuGoal,
  type RetakeNote,
} from "@/components/nabalens/home/goals-home-model"
import { homeRetakeNotes } from "@/components/nabalens/tasks/retake-notes-model"
import { AddProvider } from "@/components/nabalens/shell/add-context"
import type { OurMenuItem } from "@/lib/server/coverage/types"

import { amenityCheck, slot } from "./home-b02-fixtures"
import {
  assignment,
  due,
  monthly,
  NOVEMBER,
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
const auth = vi.hoisted(() => ({ blocked: null as string | null }))
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
  uploadBlockReason: () => auth.blocked,
}))
const coverage = vi.hoisted(() => ({
  getCoverageActor: vi.fn(),
  getMyTasks: vi.fn(),
  getManagerReviewCount: vi.fn(),
  getOurMenu: vi.fn(),
  listOurMenuItems: vi.fn(),
  listMyMenuPhotoDecisions: vi.fn(),
  listMyRetakeNotes: vi.fn(),
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

let next = 0
function dish(name: string, over: Partial<OurMenuItem> = {}): OurMenuItem {
  next += 1
  return {
    itemId: `dddddddd-0000-4000-8000-${String(next).padStart(12, "0")}`,
    sectionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sectionName: "Starters",
    sectionKind: "food",
    name,
    description: null,
    variants: [],
    covered: false,
    acceptedCount: 0,
    needsRecheck: false,
    primary: null,
    itemRevision: 1,
    review: null,
    myWaiting: 0,
    reviewState: null,
    ...over,
  }
}

function ready(over: Partial<OurMenuGoal & { state: "ready" }> = {}) {
  return {
    state: "ready",
    covered: 12,
    total: 40,
    gaps: 28,
    needsRecheck: 0,
    stillNeeded: [dish("Samosa"), dish("Pakora")],
    ...over,
  } as OurMenuGoal
}

const menuNote = (
  reason = "Too dark",
  over: Partial<RetakeNote> = {}
): RetakeNote => ({
  kind: "menu",
  noteId: "p1",
  revision: 1,
  assetId: "a1",
  thumbnailUrl: null,
  status: "open",
  canRetake: true,
  reason,
  askedBy: "TEST Riya",
  askedAt: "2026-11-10T10:00:00Z",
  setAsideAt: null,
  dish: { itemId: "i1", variantId: null, itemName: "Korma", variantName: null },
  requirement: null,
  ...over,
})

const monthNote = (reason = "Blurry"): RetakeNote => ({
  ...menuNote(reason),
  kind: "coverage",
  noteId: "s1",
  dish: null,
  requirement: null,
})

/** Every link or button drawn as the page's one blue action. */
const primaries = () =>
  [...document.querySelectorAll("a, button")].filter((el) =>
    el.className.split(/\s+/).includes("bg-accent")
  )

function renderHome(
  props: Partial<React.ComponentProps<typeof GoalsHome>> = {},
  openAdd: ((opts?: unknown) => void) | null = vi.fn()
) {
  const view = tasksView()
  const home = (
    <GoalsHome
      scope={view.scope}
      period={NOVEMBER}
      profile={PROFILE}
      monthly={monthly()}
      ourMenu={ready()}
      notes={[]}
      otherJobs={0}
      canAdd
      tasksPath="/staff/tasks"
      portfolioPath="/staff"
      {...props}
    />
  )
  return render(
    openAdd ? <AddProvider value={{ openAdd }}>{home}</AddProvider> : home
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  shell.props = null
  auth.blocked = null
})

describe("Goal-led Home: Our menu states", () => {
  it.each([
    ["no_menu", "Menu photos will appear once your venue’s menu is set up"],
    ["empty", "The active menu has no dishes or drinks yet."],
    ["unavailable", "Menu photos can't be shown right now. Try again later."],
  ] as const)(
    "%s says so, with no Add photos and no Complete",
    (state, words) => {
      renderHome({ ourMenu: { state } })
      expect(screen.getByText(words)).toBeTruthy()
      expect(
        screen.queryByRole("button", { name: /camera|Take a photo|Add photos/ })
      ).toBeNull()
      expect(screen.queryByText(/accepted photo\.$/)).toBeNull()
      expect(primaries()).toHaveLength(0)
    }
  )

  it("needs_setup: no Add photos dead end and never complete", () => {
    renderHome({ ourMenu: { state: "needs_setup" } })
    expect(
      screen.getByText(
        "Your venue's menu appears here once an admin assigns your venue."
      )
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Add photos from your gallery" })
    ).toBeNull()
    expect(screen.queryByText(/Every dish and drink/)).toBeNull()
    expect(primaries()).toHaveLength(0)
  })

  it("ready: up to the listed Still needed dishes and See all N to the gaps", () => {
    renderHome()
    const card = screen
      .getByRole("heading", { name: "Our menu" })
      .closest("section") as HTMLElement
    expect(
      within(card).getByText("12 of 40 have an accepted photo")
    ).toBeTruthy()
    const rows = within(
      within(card).getByRole("list", { name: "Still needed" })
    ).getAllByRole("article")
    expect(rows.map((row) => row.getAttribute("aria-labelledby"))).toHaveLength(
      2
    )
    expect(
      within(card)
        .getByRole("link", { name: "See all 28" })
        .getAttribute("href")
    ).toBe("/staff/menu?filter=gaps")
  })

  it("ready with recheck items shows the recheck word", () => {
    renderHome({
      ourMenu: ready({
        needsRecheck: 2,
        stillNeeded: [dish("Samosa", { needsRecheck: true })],
      }),
    })
    expect(
      screen.getByText("2 dishes are being checked after a menu change.")
    ).toBeTruthy()
    expect(screen.getByText("Being checked after a menu change")).toBeTruthy()
  })

  it("keeps a dish with a pending photo in Still needed, marked Waiting for review", () => {
    renderHome({
      ourMenu: ready({
        stillNeeded: [dish("Samosa", { reviewState: "waiting" }), dish("Dal")],
      }),
    })
    const row = screen
      .getByRole("heading", { name: "Samosa" })
      .closest("article") as HTMLElement
    expect(within(row).getByText("Waiting for review")).toBeTruthy()
    // A colleague can still add a photo of it.
    expect(
      within(row).getByRole("button", { name: "Add photos of this dish" })
    ).toBeTruthy()
  })

  it("complete: Add photos from your gallery is the one primary action", () => {
    const openAdd = vi.fn()
    renderHome(
      {
        ourMenu: ready({ covered: 40, gaps: 0, stillNeeded: [] }),
      },
      openAdd
    )
    expect(
      screen.getByText(
        "Every dish and drink on the menu has an accepted photo."
      )
    ).toBeTruthy()
    const add = screen.getByRole("button", {
      name: "Add photos from your gallery",
    })
    expect(primaries()).toEqual([add])
    fireEvent.click(add)
    expect(openAdd).toHaveBeenCalledWith({ source: "library" })
  })

  it("leads with the first Still needed dish, which opens the phone's photos with its label", () => {
    const openAdd = vi.fn()
    const first = dish("Samosa")
    renderHome(
      { ourMenu: ready({ stillNeeded: [first, dish("Dal")] }) },
      openAdd
    )
    const row = screen
      .getByRole("heading", { name: "Samosa" })
      .closest("article") as HTMLElement
    const take = within(row).getByRole("button", {
      name: "Add photos of this dish",
    })
    expect(primaries()).toEqual([take])
    fireEvent.click(take)
    expect(openAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "library",
        preset: expect.objectContaining({ itemId: first.itemId }),
      })
    )
  })

  it("shows a person who may not upload the dishes with no actions", () => {
    renderHome({ canAdd: false, blocked: "Your venue isn't taking photos." })
    expect(screen.getByRole("heading", { name: "Samosa" })).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Add photos of this dish" })
    ).toBeNull()
    expect(primaries()).toHaveLength(0)
  })

  it("keeps the totals when the dish list can't be read", () => {
    renderHome({ ourMenu: ready({ stillNeeded: null }) })
    expect(
      screen.getByText("The dishes still needed can't be shown right now.")
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "See all 28" })).toBeTruthy()
  })
})

describe("Goal-led Home: the retake note and one main action", () => {
  it("an open retake note makes Retake the one primary action", () => {
    const openAdd = vi.fn()
    renderHome({ notes: [menuNote()] }, openAdd)
    const reshoot = screen.getByRole("button", { name: "Retake: Korma" })
    expect(primaries()).toEqual([reshoot])
    expect(
      screen.getByRole("region", { name: "Needs another photo" })
    ).toBeTruthy()
    // Decision 14: Later sits beside Retake, grey.
    expect(screen.getByRole("button", { name: "Later: Korma" })).toBeTruthy()
    expect(screen.getByText("Too dark")).toBeTruthy()
    fireEvent.click(reshoot)
    expect(openAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "library",
        preset: expect.objectContaining({ itemId: "i1" }),
      })
    )
  })

  it("a coverage request on a month photo retakes through its replacement link", () => {
    renderHome({ notes: [monthNote()] })
    const link = screen.getByRole("link", {
      name: "Retake: Photo for your month",
    })
    expect(link.getAttribute("href")).toBe("/staff/tasks/month?replaces=s1")
    expect(primaries()).toEqual([link])
  })

  it("says so when the notes can't be read", () => {
    renderHome({ notesError: true })
    expect(
      screen.getByText("We couldn't check requests for another photo.")
    ).toBeTruthy()
  })

  it("Your month says what earns credit: labelled dishes, drinks and venue areas, and month sends", () => {
    renderHome()
    const month = screen
      .getByRole("heading", { name: "Your month" })
      .closest("section")!
    expect(
      within(month).getByText(
        "Accepted photos you labelled — dishes, drinks and venue areas — and photos you sent to the month, count"
      )
    ).toBeTruthy()
    expect(month.textContent).not.toMatch(/any photo counts/i)
  })

  it("never shows the share box", () => {
    renderHome()
    expect(screen.queryByRole("heading", { name: /today\?$/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Choose photos/ })).toBeNull()
  })
})

describe("Goal-led Home: model", () => {
  it("orders the primary action: Retake, then the first dish, then Add photos", () => {
    const menu = ready()
    expect(goalsPrimary({ notes: [menuNote()], menu, canAdd: true })).toEqual({
      kind: "reshoot",
      noteKey: "menu:p1",
    })
    expect(goalsPrimary({ notes: [], menu, canAdd: true })).toMatchObject({
      kind: "dish",
    })
    expect(
      goalsPrimary({
        notes: [],
        menu: ready({ covered: 40, gaps: 0, stillNeeded: [] }),
        canAdd: true,
      })
    ).toEqual({ kind: "add_photos" })
    expect(goalsPrimary({ notes: [], menu, canAdd: false })).toBeNull()
    expect(
      goalsPrimary({ notes: [], menu: { state: "needs_setup" }, canAdd: true })
    ).toBeNull()
  })

  it("counts other jobs without menu sections", () => {
    const tasks = tasksView({
      assignments: [
        assignment({ kind: "menu_section" }),
        assignment({ kind: "venue_specific", title: "Garden" }),
        assignment({
          kind: "service",
          progress: { ...assignment().requirement.progress, satisfied: true },
        }),
      ],
    })
    expect(
      otherJobsCount({
        tasks,
        amenityTasks: [amenityCheck("c1")],
        // c1 on the list is the same check, counted once.
        slots: [slot("c1")],
      })
    ).toBe(2)
  })

  it("counts an open recheck as an other job, once per check", () => {
    const recheck = (checkId: string) =>
      ({ checkId, question: "Q", dueAt: "2026-11-20T00:00:00Z" }) as never
    expect(
      otherJobsCount({
        tasks: tasksView(),
        amenityTasks: [amenityCheck("c1")],
        slots: [],
        rechecks: [recheck("c1"), recheck("c2")],
      })
    ).toBe(2)
  })

  it("Home leaves out set-aside, retaken and closed notes", () => {
    expect(
      homeRetakeNotes([
        menuNote("a", { noteId: "n1", status: "set_aside" }),
        menuNote("b", { noteId: "n2", status: "retaken" }),
        menuNote("c", { noteId: "n3", canRetake: false }),
        menuNote("d", { noteId: "n4" }),
      ]).map((note) => note.noteId)
    ).toEqual(["n4"])
  })

  it("a set-aside note gives the main action back to the first dish", () => {
    renderHome({ notes: [menuNote("x", { status: "set_aside" })] })
    expect(
      screen.queryByRole("region", { name: "Needs another photo" })
    ).toBeNull()
    expect(primaries()).toHaveLength(1)
    expect(screen.queryByRole("button", { name: /^Retake/ })).toBeNull()
  })

  it("shows the labels row under the retake note, never as the blue action (decision 19)", () => {
    renderHome({
      notes: [menuNote()],
      labels: { needsLabels: 3, needsAttention: 0 },
    })
    const row = screen.getByRole("link", {
      name: /3 photos need a label/,
    })
    expect(row.getAttribute("href")).toBe("/staff#needs-labels-heading")
    expect(primaries()).toEqual([
      screen.getByRole("button", { name: "Retake: Korma" }),
    ])
  })

  it("counts actionable cards, never dishes", () => {
    expect(
      goalsHomeCards({
        setupComplete: false,
        notes: [menuNote()],
        labels: true,
        otherJobs: 7,
        reviewCount: 4,
      })
    ).toEqual(["setup", "retake", "labels", "other_jobs", "review_photos"])
    expect(
      goalsHomeCards({
        setupComplete: true,
        notes: [],
        otherJobs: 0,
        reviewCount: 0,
      })
    ).toEqual([])
  })
})

describe("Goal-led Home: the page", () => {
  beforeEach(() => {
    coverage.getCoverageActor.mockResolvedValue({ ok: true, actor: ACTOR })
    coverage.getOurMenu.mockResolvedValue({
      ok: true,
      menu: {
        menuState: "ready",
        totals: { eligible: 40, covered: 12, gaps: 28, needsRecheck: 0 },
      },
    })
    coverage.listOurMenuItems.mockResolvedValue({
      ok: true,
      items: [dish("Samosa"), dish("Pakora"), dish("Bhaji"), dish("Dal")],
      nextCursor: "c",
    })
    coverage.listMyMenuPhotoDecisions.mockResolvedValue({
      ok: true,
      states: [],
    })
    coverage.listMyRetakeNotes.mockResolvedValue({ ok: true, notes: [] })
    work.getLabelWork.mockResolvedValue({
      status: "ok",
      value: { needsLabels: 0, needsAttention: 0 },
    })
    work.getCapabilities.mockResolvedValue(null)
    amenities.getMyAmenityTasks.mockResolvedValue({ ok: true, tasks: [] })
    knowledge.getWorkingList.mockResolvedValue({ ok: true, view: null })
  })

  async function home(params: Record<string, string> = {}) {
    const page = await TasksPage({ searchParams: Promise.resolve(params) })
    await act(async () => {
      render(page)
    })
  }

  it("is the default layout, reading four Still needed dishes", async () => {
    coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
    await home()
    expect(screen.getByRole("heading", { name: "Our menu" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Your month" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: /^To do/ })).toBeNull()
    expect(coverage.listOurMenuItems).toHaveBeenCalledWith(ACTOR, {
      gapsOnly: true,
      limit: 4,
    })
    expect(screen.getAllByRole("article")).toHaveLength(4)
    // Nothing waits on this person: no badge number for dishes.
    expect(shell.props).toMatchObject({ todoCount: 0, todoUnknown: false })
  })

  it("shows no task, due date or Overdue to someone with only menu-section assignments", async () => {
    coverage.getMyTasks.mockResolvedValue({
      ok: true,
      tasks: tasksView({
        monthly: monthly({ due: due({ overdue: true, label: "Due 1 Nov" }) }),
        assignments: [
          assignment({
            kind: "menu_section",
            title: "Starters",
            progress: {
              ...assignment().requirement.progress,
              overdue: true,
            },
          }),
          assignment({ kind: "menu_section", title: "Mains" }),
        ],
      }),
    })
    await home()
    const text = document.body.textContent ?? ""
    expect(text).not.toMatch(/\btasks?\b/i)
    expect(text).not.toMatch(/\bdue\b/i)
    expect(text).not.toMatch(/overdue/i)
    expect(screen.queryByRole("link", { name: /Other jobs/ })).toBeNull()
    expect(shell.props).toMatchObject({ todoCount: 0 })
  })

  it("reaches a venue-specific job and an amenity check from Home in two taps", async () => {
    coverage.getMyTasks.mockResolvedValue({
      ok: true,
      tasks: tasksView({
        assignments: [assignment({ kind: "venue_specific", title: "Garden" })],
      }),
    })
    amenities.getMyAmenityTasks.mockResolvedValue({
      ok: true,
      tasks: [amenityCheck("c1")],
    })
    await home()
    const row = screen.getByRole("link", { name: /Other jobs/ })
    expect(row.getAttribute("href")).toBe("/staff/tasks/other")
    expect(within(row).getByText("2")).toBeTruthy()
    // One card on Home, however many jobs it holds.
    expect(shell.props).toMatchObject({ todoCount: 1, todoUnknown: false })
  })

  it("counts the retake note and Other jobs as cards, never the dishes", async () => {
    coverage.getMyTasks.mockResolvedValue({
      ok: true,
      tasks: tasksView({
        scope: {
          ...tasksView().scope,
          setup: { complete: false, missing: ["team"] },
        },
        assignments: [assignment({ kind: "service", title: "Bar set-up" })],
      }),
    })
    coverage.listMyRetakeNotes.mockResolvedValue({
      ok: true,
      notes: [
        menuNote(),
        menuNote("old", { noteId: "p2", status: "set_aside" }),
      ],
    })
    await home()
    expect(shell.props).toMatchObject({ todoCount: 3, todoUnknown: false })
    // The open note shows (with Later); the set-aside one stays on Me.
    expect(screen.getByRole("button", { name: "Later: Korma" })).toBeTruthy()
    expect(screen.queryByText("old")).toBeNull()
  })

  it("counts the labels row as a card, and keeps the badge unknown when labels can't be read", async () => {
    coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
    work.getLabelWork.mockResolvedValue({
      status: "ok",
      value: { needsLabels: 2, needsAttention: 0 },
    })
    await home()
    expect(shell.props).toMatchObject({ todoCount: 1, todoUnknown: false })
    expect(
      screen.getByRole("link", { name: /2 photos need a label/ })
    ).toBeTruthy()
  })

  it("keeps the badge unknown when the notes can't be read", async () => {
    coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
    coverage.listMyRetakeNotes.mockResolvedValue({
      ok: false,
      code: "unavailable",
      message: "x",
    })
    await home()
    expect(shell.props).toMatchObject({
      todoCount: undefined,
      todoUnknown: true,
    })
  })

  it("shows Finding sent after an amenity send, and Dismiss focuses a heading that exists", async () => {
    coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
    amenities.getCheck.mockResolvedValue({
      ok: true,
      detail: {
        check: {
          progress: "complete",
          answeredBy: { id: "me", displayName: "TEST Sam" },
          entry: { question: "Is there step-free access?" },
        },
      },
    })
    await home({ finding_sent: "c9" })
    const notice = screen
      .getByText("Finding sent")
      .closest<HTMLElement>('[role="status"]')!
    expect(notice.textContent).toContain("Is there step-free access?")
    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }))
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Our menu" })
    )
  })

  it("has a goals loading skeleton with no share box or To do", () => {
    render(<TasksLoading />)
    expect(screen.getByText("Loading Home…")).toBeTruthy()
    expect(screen.queryByText(/tasks/i)).toBeNull()
  })
})
