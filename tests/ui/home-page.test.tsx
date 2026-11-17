// @vitest-environment jsdom
// Staff Home is Album (DESIGN.md §5a, batch A5): the venue's album count,
// the retake row, the places and their empty slots, one gallery-first main
// button. Nothing of the old Home (To do, Our menu, Your month, Start here)
// remains, and no layout switch chooses it.
import { cleanup, render, screen, within } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildAlbum, type AlbumInput } from "@/lib/album/model"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/staff/tasks",
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({
    children,
    todoCount,
    todoUnknown,
  }: {
    children: React.ReactNode
    todoCount?: number
    todoUnknown?: boolean
  }) => (
    <div
      data-testid="shell"
      data-todo={todoCount ?? ""}
      data-unknown={todoUnknown ? "1" : ""}
    >
      {children}
    </div>
  ),
}))

const ACTOR = { profile: { id: "me", venueId: "v1" }, db: {} }

const auth = vi.hoisted(() => ({
  profile: {
    id: "me",
    displayName: "TEST Sam",
    avatarPath: null,
    department: "foh",
    venueId: "v1" as string | null,
    venue: { id: "v1", name: "TEST Inn", active: true } as null | {
      id: string
      name: string
      active: boolean
    },
    work: null,
  },
  blocked: null as null | "not_staff" | "no_venue" | "venue_inactive",
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => auth.profile),
  uploadBlockReason: () => auth.blocked,
}))
const coverage = vi.hoisted(() => ({
  getCoverageActor: vi.fn(),
  getCoverageScope: vi.fn(),
  getManagerReviewCount: vi.fn(),
  listMyRetakeNotes: vi.fn(),
  // Never read by Album Home: the old Home's tasks and Our menu.
  getMyTasks: vi.fn(),
  getOurMenu: vi.fn(),
}))
vi.mock("@/lib/server/coverage", () => coverage)
vi.mock("@/lib/server/media/library", () => ({ avatarUrl: () => null }))
const album = vi.hoisted(() => ({ loadAlbum: vi.fn() }))
vi.mock("@/lib/server/album", () => album)
const amenities = vi.hoisted(() => ({ getCheck: vi.fn() }))
vi.mock("@/lib/server/amenities", () => amenities)
const knowledge = vi.hoisted(() => ({ fail: false }))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: {
    getWorkingList: async () =>
      knowledge.fail
        ? { ok: false, code: "unavailable" }
        : { ok: true, view: null },
  },
}))

import AlbumHomePage from "@/app/staff/tasks/page"

const BAR = "00000000-0000-4000-8000-00000000b001"
const PASS = "00000000-0000-4000-8000-00000000b002"
const DRINKS = "00000000-0000-4000-8000-00000000c001"
const DESSERTS = "00000000-0000-4000-8000-00000000c002"
const GUINNESS = "00000000-0000-4000-8000-0000000d0001"

const dish = (
  n: number,
  name: string,
  sectionId: string,
  sectionName: string,
  covered = false
) => ({
  itemId: `00000000-0000-4000-8000-0000000d000${n}`,
  name,
  sectionId,
  sectionName,
  covered,
  needsRecheck: false,
  thumbnailUrl: covered ? "/thumb.jpg" : null,
  myWaiting: 0,
  reviewState: null,
  neededBy: null,
})

const INPUT: AlbumInput = {
  places: [
    { subjectId: BAR, label: "The bar" },
    { subjectId: PASS, label: "Kitchen pass" },
  ],
  placements: [
    { source: "menu_section", key: "drinks", subjectId: BAR },
    { source: "menu_section", key: "desserts", subjectId: PASS },
  ],
  sections: [
    { sectionId: DRINKS, slug: "drinks" },
    { sectionId: DESSERTS, slug: "desserts" },
  ],
  dishes: [
    dish(1, "Guinness, pint", DRINKS, "Drinks"),
    dish(2, "Aperol spritz", DRINKS, "Drinks", true),
    dish(3, "Sticky toffee pudding", DESSERTS, "Desserts"),
    dish(4, "Eton mess", DESSERTS, "Desserts"),
  ],
  amenities: [],
  areas: [],
  myRetakeItemIds: new Set(),
}

function retakeNote(overrides: Record<string, unknown> = {}) {
  return {
    kind: "menu",
    noteId: "n1",
    status: "open",
    canRetake: true,
    reason: "Too dark",
    dish: { itemId: GUINNESS, itemName: "Guinness, pint" },
    ...overrides,
  }
}

function setup({
  notes = [] as unknown[] | null,
  albumResult = undefined as unknown,
} = {}) {
  auth.blocked = null
  coverage.getCoverageActor.mockResolvedValue({ ok: true, actor: ACTOR })
  coverage.getCoverageScope.mockResolvedValue({
    ok: true,
    scope: { canManageVenue: false },
  })
  coverage.listMyRetakeNotes.mockResolvedValue(
    notes === null
      ? { ok: false, code: "unavailable", status: 503, message: "x" }
      : { ok: true, notes }
  )
  album.loadAlbum.mockResolvedValue(
    albumResult ?? { ok: true, album: buildAlbum(INPUT), placements: {} }
  )
}

const home = async (params: Record<string, string> = {}) =>
  render(await AlbumHomePage({ searchParams: Promise.resolve(params) }))

const shell = () => screen.getByTestId("shell")

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Album is Home", () => {
  it("opens on what is missing: the venue's album, its count and the empty slots where the person is", async () => {
    setup()
    await home()
    expect(screen.getByText("TEST Inn album")).toBeTruthy()
    const count = screen.getByRole("heading", { level: 1 })
    expect(count.textContent).toContain("3")
    expect(count.textContent).toContain("slots still empty")
    expect(screen.getByText("1 in · 0 waiting · 4 in all")).toBeTruthy()
    // The place with the most empty slots, when none was chosen.
    const empty = screen.getByRole("heading", { name: /^Empty at / })
    expect(empty.textContent).toBe("Empty at Kitchen pass")
    expect(
      screen.getByRole("button", { name: /Add photos from your gallery/ })
    ).toBeTruthy()
  })

  it("opens the place named by ?place", async () => {
    setup()
    await home({ place: BAR })
    expect(
      screen.getByRole("heading", { name: "Empty at The bar" })
    ).toBeTruthy()
  })

  it("shows nothing of the old Home and reads none of its data", async () => {
    setup()
    await home()
    for (const name of [/To do/, /Our menu/, /Your photos for/, /^Home$/]) {
      expect(screen.queryByRole("heading", { name })).toBeNull()
    }
    expect(screen.queryByRole("link", { name: "Start here" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Other jobs" })).toBeNull()
    expect(coverage.getMyTasks).not.toHaveBeenCalled()
    expect(coverage.getOurMenu).not.toHaveBeenCalled()
  })

  it("is titled Album", async () => {
    const { metadata } = await import("@/app/staff/tasks/page")
    expect(metadata.title).toBe("Album")
  })
})

describe("Album: retakes and the tab badge", () => {
  it("shows the retake row for open notes on dishes I can retake, and counts them on the badge", async () => {
    setup({
      notes: [
        retakeNote(),
        // Not shown: set aside, a dish off the menu, a coverage note.
        retakeNote({ noteId: "n2", status: "set_aside" }),
        retakeNote({ noteId: "n3", canRetake: false }),
        retakeNote({ noteId: "n4", kind: "coverage", dish: null }),
      ],
    })
    await home()
    expect(screen.getByText(/1 retake/)).toBeTruthy()
    expect(screen.getByText(/Too dark/)).toBeTruthy()
    expect(shell().dataset.todo).toBe("1")
    expect(shell().dataset.unknown).toBe("")
  })

  it("shows no badge and no retake row when there is nothing to retake", async () => {
    setup()
    await home()
    expect(screen.queryByText(/\d retakes?/)).toBeNull()
    expect(shell().dataset.todo).toBe("0")
  })

  it("marks the badge unknown, never zero, when the notes can't be read", async () => {
    setup({ notes: null })
    await home()
    expect(shell().dataset.todo).toBe("")
    expect(shell().dataset.unknown).toBe("1")
    // The album itself still shows.
    expect(screen.getByText("TEST Inn album")).toBeTruthy()
  })
})

describe("Album: when it can't be shown", () => {
  it("says what failed beside the page when the album read fails", async () => {
    setup({
      albumResult: {
        ok: false,
        code: "unavailable",
        status: 503,
        message: "The album can't be shown right now. Try again.",
      },
    })
    await home()
    expect(screen.getByRole("alert").textContent).toContain(
      "The album can't be shown right now."
    )
  })

  it("explains a missing venue instead of an error", async () => {
    setup({
      albumResult: {
        ok: false,
        code: "unavailable",
        status: 503,
        message: "x",
      },
    })
    auth.blocked = "no_venue"
    await home()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(
      screen.getByText(
        "You can't add photos until an admin assigns your venue."
      )
    ).toBeTruthy()
  })

  it("keeps the album but says why adding is paused", async () => {
    setup()
    auth.blocked = "venue_inactive"
    await home()
    expect(screen.getByText("TEST Inn album")).toBeTruthy()
    expect(
      screen.getByText(/Your venue isn't taking photos right now/)
    ).toBeTruthy()
  })
})

describe("Album: Finding sent (§6.7)", () => {
  const sentCheck = (overrides: Record<string, unknown> = {}) => ({
    ok: true,
    detail: {
      check: {
        id: "c1",
        progress: "complete",
        answeredBy: { id: "me", displayName: "TEST Sam" },
        entry: { question: "Is there step-free access?" },
        ...overrides,
      },
    },
  })

  it("names the check once the database shows it complete and answered by me", async () => {
    setup()
    amenities.getCheck.mockResolvedValue(sentCheck())
    await home({ finding_sent: "c1" })
    expect(amenities.getCheck).toHaveBeenCalledWith(ACTOR, { checkId: "c1" })
    const notice = screen
      .getByText("Finding sent")
      .closest<HTMLElement>('[role="status"]')!
    expect(notice.textContent).toContain("Is there step-free access?")
    // Dismiss hands focus to the top of the album, which can take it.
    const top = document.getElementById("album-top")!
    expect(top.tabIndex).toBe(-1)
    within(notice).getByRole("button", { name: "Dismiss" }).click()
    expect(document.activeElement).toBe(top)
  })

  it("says only Sent, never complete, when the working list can't be read (HM-16)", async () => {
    setup()
    amenities.getCheck.mockResolvedValue(sentCheck())
    knowledge.fail = true
    try {
      await home({ finding_sent: "c1" })
    } finally {
      knowledge.fail = false
    }
    const notice = screen
      .getByText("Sent")
      .closest<HTMLElement>('[role="status"]')!
    expect(notice.textContent).toContain("Is there step-free access?")
    expect(notice.textContent).not.toContain("complete")
  })

  it.each([
    ["answered by someone else", { answeredBy: { id: "x", displayName: "X" } }],
    ["reopened since", { progress: "needs_recheck" }],
  ])("says nothing when the check was %s", async (_, overrides) => {
    setup()
    amenities.getCheck.mockResolvedValue(sentCheck(overrides))
    await home({ finding_sent: "c1" })
    expect(screen.queryByText("Finding sent")).toBeNull()
  })

  it("never reads a check without the parameter, and survives a failed read", async () => {
    setup()
    await home()
    expect(amenities.getCheck).not.toHaveBeenCalled()
    amenities.getCheck.mockRejectedValue(new Error("down"))
    cleanup()
    await home({ finding_sent: "c1" })
    expect(screen.getByText("TEST Inn album")).toBeTruthy()
    expect(screen.queryByText("Finding sent")).toBeNull()
  })
})
