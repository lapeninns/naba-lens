// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CommunityMember } from "@/lib/server/community"
import type { MediaItemView } from "@/lib/server/media/types"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))
vi.mock("@/app/_media/actions", () => ({
  logout: vi.fn(),
  deleteMedia: vi.fn(),
}))
vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
}))
vi.mock("@/app/staff/community/actions", () => ({
  loadCommunityPage: vi.fn(),
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => ({ displayName: "Priya Gurung" })),
}))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: vi.fn(async () => ({ ok: true, actor: {} })),
}))
vi.mock("@/app/staff/can-manage", () => ({
  canManageVenue: vi.fn(async () => false),
}))
const community = vi.hoisted(() => ({
  listCommunityMembers: vi.fn(),
  listCommunityVenues: vi.fn(),
  getCommunityMember: vi.fn(),
  listCommunityMedia: vi.fn(),
}))
vi.mock("@/lib/server/community", () => community)

import ColleagueError from "@/app/staff/people/[id]/error"
import ColleagueLoading from "@/app/staff/people/[id]/loading"
import ColleagueNotFound from "@/app/staff/people/[id]/not-found"
import ColleaguePage from "@/app/staff/people/[id]/page"
import PeopleError from "@/app/staff/people/error"
import PeopleLoading from "@/app/staff/people/loading"
import PeoplePage from "@/app/staff/people/page"
import {
  movedNotice,
  noResults,
  searchSummary,
  shownCount,
  sortPeople,
} from "@/app/staff/people/people"

const RAILWAY = "0b9c4d6e-1f2a-4b3c-8d9e-0f1a2b3c4d5e"
const VENUES = [
  { id: RAILWAY, name: "The Railway" },
  { id: "1c9c4d6e-1f2a-4b3c-8d9e-0f1a2b3c4d5e", name: "The Prince of Wales" },
]
const ANIL = "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22"

function member(
  displayName: string,
  overrides: Partial<CommunityMember> = {}
): CommunityMember {
  return {
    id: `id-${displayName.replace(/\s+/g, "-")}`,
    displayName,
    jobTitle: "Sous chef",
    department: "boh",
    venueId: RAILWAY,
    venueName: "The Railway",
    avatarUrl: null,
    mediaCount: 3,
    ...overrides,
  }
}

function photo(
  id: string,
  venueName: string,
  createdAt = "2026-10-30T12:00:00.000Z"
): MediaItemView {
  return {
    id,
    mediaType: "image",
    uploadState: "ready",
    thumbnailUrl: `/api/media/${id}/thumb`,
    previewUrl: `/api/media/${id}/preview`,
    mimeType: "image/jpeg",
    originalFilename: null,
    createdAt,
    contributorId: ANIL,
    contributorName: "Anil Thapa",
    venueName,
    width: 64,
    height: 48,
    durationSeconds: null,
    sizeBytes: 4,
    labels: null,
  }
}

/** Serves `all` in service order (whole display name), `limit` at a time. */
function serveMembers(all: CommunityMember[]) {
  const ordered = [...all].sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  )
  community.listCommunityMembers.mockImplementation(
    async (_actor, filters: { offset: number; limit: number }) => {
      const rows = ordered.slice(filters.offset, filters.offset + filters.limit)
      const more = filters.offset + filters.limit < ordered.length
      return {
        ok: true,
        members: rows,
        nextOffset: more ? filters.offset + filters.limit : null,
      }
    }
  )
}

async function renderPeople(search: Record<string, string> = {}) {
  return render(await PeoplePage({ searchParams: Promise.resolve(search) }))
}

async function renderProfile(id = ANIL) {
  return render(await ColleaguePage({ params: Promise.resolve({ id }) }))
}

beforeEach(() => {
  community.listCommunityVenues.mockResolvedValue({ ok: true, venues: VENUES })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("People order", () => {
  it("sorts A to Z by surname, then first name, never by photos", () => {
    const sorted = sortPeople([
      member("Priya Gurung", { mediaCount: 48 }),
      member("Tom Hughes", { mediaCount: 9 }),
      member("Kiran Lama", { mediaCount: 29 }),
      member("Dan Cooper", { mediaCount: 23 }),
      member("Anil Gurung", { mediaCount: 1 }),
      member("Cher"),
    ])
    expect(sorted.map((m) => m.displayName)).toEqual([
      "Cher",
      "Dan Cooper",
      "Anil Gurung",
      "Priya Gurung",
      "Tom Hughes",
      "Kiran Lama",
    ])
  })

  it("reads every batch before sorting, so the order holds across pages", async () => {
    const names = Array.from(
      { length: 130 },
      (_, i) =>
        `A${String(i).padStart(3, "0")} Z${String(129 - i).padStart(3, "0")}`
    )
    serveMembers(names.map((name) => member(name)))
    await renderPeople()
    // One wave of four parallel pages; the second page is the last.
    expect(community.listCommunityMembers).toHaveBeenCalledTimes(4)
    const cards = within(screen.getByRole("list", { name: "People" }))
      .getAllByRole("link")
      .map((link) => link.textContent)
    expect(cards).toHaveLength(24)
    // Surname Z000 belongs to the last name the service returns.
    expect(cards[0]).toContain("A129 Z000")
    expect(cards[23]).toContain("A106 Z023")
  })
})

describe("People page", () => {
  it("shows all venues, the cards and Next people", async () => {
    serveMembers(
      Array.from({ length: 30 }, (_, i) =>
        member(`Person ${String.fromCharCode(65 + (i % 26))}${i}`, {
          mediaCount: i === 0 ? 1 : 23,
          department: i === 0 ? "foh" : "boh",
        })
      )
    )
    const { container } = await renderPeople()
    expect(
      screen.getByRole("heading", { level: 1, name: "People" })
    ).toBeTruthy()
    expect(
      container.querySelector("[data-slot=page-header] p")?.textContent
    ).toBe("All venues")
    expect(
      screen.getByText(
        "Colleagues across Lapen Inns, and the photos they've shared."
      )
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Find people" })).toBeTruthy()
    expect(screen.getByLabelText("Name").getAttribute("placeholder")).toBe(
      "Search by name"
    )
    const first = within(screen.getByRole("list", { name: "People" }))
      .getAllByRole("link")
      .find((link) => link.textContent?.includes("Person A0"))!
    expect(first.getAttribute("href")).toBe("/staff/people/id-Person-A0")
    expect(first.textContent).toContain("The Railway")
    expect(first.textContent).toContain("FOH")
    expect(first.textContent).toContain("1 photo")
    expect(first.textContent).toContain("View profile")
    const next = screen.getByRole("link", { name: "Next people" })
    expect(next.getAttribute("href")).toBe("/staff/people?shown=48")
    expect(
      screen.getByText("Showing 1 to 24 of 30, A to Z by surname")
    ).toBeTruthy()
    expect(container.textContent).not.toMatch(/@|\.jpe?g/i)
  })

  it("shows the next page below the first and stops at the end", async () => {
    serveMembers(Array.from({ length: 30 }, (_, i) => member(`P Q${i}`)))
    await renderPeople({ shown: "48" })
    expect(
      within(screen.getByRole("list", { name: "People" })).getAllByRole("link")
    ).toHaveLength(30)
    expect(screen.queryByRole("link", { name: "Next people" })).toBeNull()
    expect(
      screen.getByText("Showing 1 to 30 of 30, A to Z by surname")
    ).toBeTruthy()
  })

  it("reads in parallel waves until a page is the last", async () => {
    serveMembers(
      Array.from({ length: 450 }, (_, i) =>
        member(`P${String(i).padStart(3, "0")} Q`)
      )
    )
    await renderPeople()
    const offsets = community.listCommunityMembers.mock.calls.map(
      ([, filters]) => (filters as { offset: number }).offset
    )
    expect(offsets).toEqual([0, 100, 200, 300, 400, 500, 600, 700])
    expect(
      within(screen.getByRole("list", { name: "People" })).getAllByRole("link")
    ).toHaveLength(24)
  })

  it("says who the name search found, with Clear search", async () => {
    serveMembers([member("Kiran Lama")])
    await renderPeople({ q: "Kiran" })
    expect(community.listCommunityMembers).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ search: "Kiran" })
    )
    expect(screen.getByRole("status").textContent).toBe(
      "Showing people named Kiran at all venues."
    )
    expect(
      screen.getByRole("link", { name: "Clear search" }).getAttribute("href")
    ).toBe("/staff/people")
    expect(screen.queryByRole("link", { name: "Next people" })).toBeNull()
  })

  it("says no one matched, and how to widen the search", async () => {
    serveMembers([])
    await renderPeople({ q: "Sita", department: "boh" })
    expect(
      screen.getByText("No one called Sita in Back of house at all venues.")
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Check the spelling, or try all teams. New starters appear once they've signed in."
      )
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "Clear search" })).toBeTruthy()
  })

  it("shows an empty organisation without a search to clear", async () => {
    serveMembers([])
    await renderPeople()
    expect(screen.getByText("No one here yet.")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Clear search" })).toBeNull()
  })

  it("throws to the error state when the directory cannot load", async () => {
    community.listCommunityMembers.mockResolvedValue({
      ok: false,
      status: 503,
      message: "Could not load the community. Try again.",
    })
    await expect(renderPeople()).rejects.toThrow(/Could not load/)
  })

  it("shows the offline notice above what was loaded", async () => {
    serveMembers([member("Kiran Lama")])
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    await renderPeople()
    expect(screen.getByRole("alert").textContent).toContain("You're offline")
    expect(screen.getByRole("list", { name: "People" })).toBeTruthy()
    online.mockRestore()
  })
})

describe("People loading and error", () => {
  it("announces loading under the real header", () => {
    render(<PeopleLoading />)
    expect(screen.getByRole("status").textContent).toBe("Loading people…")
    expect(
      screen.getByRole("heading", { level: 1, name: "People" })
    ).toBeTruthy()
  })

  it("offers Try again", async () => {
    const retry = vi.fn()
    render(<PeopleError retry={retry} />)
    expect(screen.getByRole("alert").textContent).toContain(
      "We couldn't load people"
    )
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledOnce()
  })
})

describe("search summary copy", () => {
  it("names the venue and team searched", () => {
    expect(
      searchSummary({ query: "", venueName: "The Railway", department: null })
    ).toBe("Showing people at The Railway.")
    expect(
      noResults({ query: "", venueName: "The Railway", department: "foh" })
    ).toEqual({
      title: "No one in Front of house at The Railway.",
      description:
        "Try all teams, or all venues. New starters appear once they've signed in.",
    })
    expect(shownCount("junk", 10)).toBe(24)
    expect(shownCount("1000", 30)).toBe(48)
  })
})

describe("a colleague's profile", () => {
  it("shows the current venue, and each photo where it was taken", async () => {
    community.getCommunityMember.mockResolvedValue({
      ok: true,
      member: member("Anil Thapa", {
        id: ANIL,
        jobTitle: "Bar supervisor",
        department: "foh",
        venueName: "The Prince of Wales",
        mediaCount: 3,
      }),
    })
    community.listCommunityMedia.mockResolvedValue({
      ok: true,
      items: [
        photo("m1", "The Prince of Wales", "2026-11-02T12:00:00.000Z"),
        photo("m2", "The Railway"),
        photo("m3", "The Railway", "2026-10-28T12:00:00.000Z"),
      ],
      nextCursor: null,
    })
    const { container } = await renderProfile()
    expect(
      screen.getByRole("heading", { level: 1, name: "Anil Thapa" })
    ).toBeTruthy()
    const header = container.querySelector("[data-slot=page-header]")!
    expect(header.textContent).toContain("The Prince of Wales")
    expect(header.textContent).not.toContain("The Railway")
    expect(header.textContent).toContain("FOH")
    expect(header.textContent).toContain("3 photos")
    expect(
      screen.getByText(
        "Anil moved to The Prince of Wales. Earlier photos keep The Railway, where they were taken."
      )
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { level: 2, name: "Shared photos" })
    ).toBeTruthy()
    expect(screen.getByText("Newest first")).toBeTruthy()
    const tiles = within(screen.getByRole("list", { name: "Shared photos" }))
    expect(tiles.getAllByText(/The Railway/)).toHaveLength(2)
    expect(tiles.getAllByText(/The Prince of Wales/)).toHaveLength(1)
    expect(container.textContent).not.toMatch(/@|\.jpe?g|Download original/i)
  })

  it("says nothing about a move when every photo is from the current venue", () => {
    expect(
      movedNotice({ displayName: "Kiran Lama", venueName: "The Railway" }, [
        { venueName: "The Railway" },
      ])
    ).toBeNull()
    expect(
      movedNotice({ displayName: "Kiran Lama", venueName: null }, [
        { venueName: "The Railway" },
      ])
    ).toBeNull()
    expect(
      movedNotice({ displayName: "Rina Tamang", venueName: "The Bell" }, [
        { venueName: "The Railway" },
        { venueName: "The Bell" },
        { venueName: "The Barley Mow" },
      ])
    ).toBe(
      "Rina moved to The Bell. Earlier photos keep The Railway and The Barley Mow, where they were taken."
    )
  })

  it("says when someone hasn't shared any photos yet", async () => {
    community.getCommunityMember.mockResolvedValue({
      ok: true,
      member: member("Josh Patel", {
        id: ANIL,
        mediaCount: 0,
        department: null,
      }),
    })
    community.listCommunityMedia.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    })
    await renderProfile()
    expect(screen.getByText("Josh hasn't shared any photos yet.")).toBeTruthy()
    expect(
      screen.getByText("Photos appear here as soon as they're ready.")
    ).toBeTruthy()
    expect(screen.getByText("0 photos")).toBeTruthy()
    expect(screen.queryByText(/moved to/)).toBeNull()
  })

  it("is not found for someone who left or a wrong link", async () => {
    community.getCommunityMember.mockResolvedValue({
      ok: false,
      status: 404,
      message: "Not found.",
    })
    await expect(renderProfile()).rejects.toThrow("NEXT_NOT_FOUND")
    cleanup()
    render(<ColleagueNotFound />)
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This profile isn't available",
      })
    ).toBeTruthy()
    expect(
      screen.getByText(
        "The person may have left Lapen Inns, or the link is wrong. Photos they shared stay in Photos."
      )
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Back to People" }).getAttribute("href")
    ).toBe("/staff/people")
  })

  it("announces loading and offers Try again on an error", async () => {
    render(<ColleagueLoading />)
    expect(screen.getByRole("status").textContent).toBe("Loading profile…")
    expect(
      screen.getByRole("heading", { level: 1, name: "Profile" })
    ).toBeTruthy()
    cleanup()
    const retry = vi.fn()
    render(<ColleagueError retry={retry} />)
    expect(screen.getByRole("alert").textContent).toContain(
      "We couldn't load this profile"
    )
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
