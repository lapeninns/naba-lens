// @vitest-environment jsdom
// Album A4, admin albums (DESIGN.md §6.6): the matrix, tints and words, the
// gaps, a venue with no menu, and admin-only access.
import { cleanup, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/albums",
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children, active }: { children: ReactNode; active: string }) => (
    <div data-active={active}>{children}</div>
  ),
}))
const auth = vi.hoisted(() => ({
  requireActiveAdmin: vi.fn(),
}))
vi.mock("@/lib/auth", () => auth)
const access = vi.hoisted(() => ({ isAdmin: true }))
vi.mock("@/lib/server/coverage/context", () => ({
  adminOnly: vi.fn(async () =>
    access.isAdmin
      ? { ok: true, access: { isAdmin: true } }
      : {
          ok: false,
          code: "not_permitted",
          status: 403,
          message: "Only an active admin can do this.",
        }
  ),
}))

const BELL = "00000000-0000-4000-8000-0000000000a1"
const CROWN = "00000000-0000-4000-8000-0000000000a2"
const PLACE = "00000000-0000-4000-8000-0000000000c1"

type Rpc = { data: unknown; error: { message: string } | null }
const db = vi.hoisted(() => ({
  venues: [] as Array<{ id: string; name: string }>,
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<Rpc>>(),
  eq: vi.fn(),
}))
const actor = {
  profile: { id: "admin" },
  db: {
    from: () => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          db.eq(column, value)
          return {
            order: async () => ({ data: db.venues, error: null }),
          }
        },
      }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => db.rpc(name, args),
  },
}
vi.mock("@/lib/server/coverage", () => ({
  getCoverageActor: vi.fn(async () => ({ ok: true, actor })),
}))

import AdminAlbumsPage from "@/app/admin/albums/page"
import {
  ADMIN_ALBUMS_COPY,
  AdminAlbumsView,
} from "@/app/admin/albums/albums-view"
import { buildAdminAlbums } from "@/app/admin/albums/albums-model"
import { loadAdminAlbums } from "@/lib/server/album-admin"

function counts(venueId: string): Rpc {
  if (venueId === CROWN)
    return {
      data: { venueId, menuState: "no_menu", sections: [], amenities: [] },
      error: null,
    }
  return {
    data: {
      venueId,
      menuState: "ready",
      sections: [
        { name: "Desserts", kind: "food", total: 4, accepted: 4, waiting: 0 },
        { name: "Spirits", kind: "drinks", total: 6, accepted: 1, waiting: 2 },
      ],
      amenities: [
        {
          category: "Games",
          progress: "needs_capture",
          answer: null,
          openState: null,
        },
      ],
    },
    error: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  access.isAdmin = true
  auth.requireActiveAdmin.mockResolvedValue({
    id: "admin",
    displayName: "Admin",
  })
  db.venues = [
    { id: BELL, name: "The Bell" },
    { id: CROWN, name: "Old Crown" },
  ]
  db.rpc.mockImplementation(async (name, args) => {
    const venueId = args.p_venue_id as string
    if (name === "album_admin_counts") return counts(venueId)
    if (name === "album_area_states")
      return {
        data: {
          venueId,
          items: [{ subjectId: PLACE, label: "Garden", state: "needed" }],
        },
        error: null,
      }
    throw new Error(`unexpected rpc ${name}`)
  })
})
afterEach(cleanup)

const matrix = () => screen.getByRole("table", { name: "By venue" })
function rowOf(name: string) {
  const header = within(matrix()).getByRole("rowheader", { name })
  return header.closest("tr") as HTMLElement
}
const cellsOf = (name: string) =>
  within(rowOf(name))
    .getAllByRole("cell")
    .map((cell) => [
      cell.getAttribute("data-tint"),
      cell.textContent?.replace(/^(Food|Drinks|Amenities|Areas)/, ""),
    ])

describe("/admin/albums", () => {
  it("draws venues down and Food, Drinks, Amenities, Areas across, filled of total", async () => {
    render(await AdminAlbumsPage())
    expect(
      screen.getByRole("heading", { level: 1, name: "Albums" })
    ).toBeTruthy()
    expect(
      within(matrix())
        .getAllByRole("columnheader")
        .map((h) => h.textContent)
    ).toEqual(["Venue", "Food", "Drinks", "Amenities", "Areas"])
    // Venues by name, not by how full they are.
    expect(
      within(matrix())
        .getAllByRole("rowheader")
        .map((h) => h.textContent)
    ).toEqual(["Old Crown", "The Bell", "All venues"])
    expect(cellsOf("The Bell")).toEqual([
      ["3", "4 of 4Full"],
      ["1", "1 of 62 waiting"],
      ["0", "0 of 1None yet"],
      ["0", "0 of 1None yet"],
    ])
    expect(
      within(rowOf("The Bell")).getByRole("link", { name: "The Bell" })
    ).toHaveProperty("pathname", `/admin/coverage/${BELL}`)
    // The page is in the admin navigation as Albums.
    expect(
      document.querySelector("[data-active]")?.getAttribute("data-active")
    ).toBe("albums")
    // Only active venues, each read with its own id.
    expect(db.eq).toHaveBeenCalledWith("active", true)
    expect(db.rpc).toHaveBeenCalledWith("album_admin_counts", {
      p_venue_id: BELL,
    })
    expect(db.rpc).toHaveBeenCalledWith("album_area_states", {
      p_venue_id: CROWN,
    })
  })

  it("shows a venue with no menu as No menu, in words and without a tint", async () => {
    render(await AdminAlbumsPage())
    expect(cellsOf("Old Crown")).toEqual([
      ["none", "No menu"],
      ["none", "No menu"],
      ["none", "None listed"],
      ["0", "0 of 1None yet"],
    ])
  })

  it("leads with what is still empty and lists the biggest gaps first", async () => {
    render(await AdminAlbumsPage())
    // Bell: drinks 3, amenities 1, areas 1; Crown: areas 1.
    expect(screen.getByText("6").closest("p")?.textContent).toBe(
      "6slots still empty across 2 venues"
    )
    expect(screen.getByText("5 in · 2 waiting · 13 in all")).toBeTruthy()
    const gaps = within(
      screen.getByRole("region", { name: "Biggest gaps" })
    ).getAllByRole("link")
    expect(gaps.map((g) => g.textContent)).toEqual([
      "The Bell · SpiritsDrinks3 of 6 still empty",
      "Old Crown · PlacesAreas1 of 1 still empty",
      "The Bell · GamesAmenities1 of 1 still empty",
      "The Bell · PlacesAreas1 of 1 still empty",
    ])
    expect(gaps[0]).toHaveProperty(
      "pathname",
      `/admin/coverage/${BELL}/menu-photos`
    )
    expect(gaps[2]).toHaveProperty(
      "pathname",
      `/admin/coverage/${BELL}/amenities`
    )
    expect(gaps[3]).toHaveProperty(
      "pathname",
      `/admin/coverage/${BELL}/amenities/places`
    )
  })

  it("keeps the page when one venue's read fails, and says so beside the matrix", async () => {
    db.rpc.mockImplementation(async (name, args) =>
      name === "album_admin_counts" && args.p_venue_id === BELL
        ? { data: null, error: { message: "boom" } }
        : name === "album_admin_counts"
          ? counts(args.p_venue_id as string)
          : { data: { items: [] }, error: null }
    )
    render(await AdminAlbumsPage())
    expect(cellsOf("The Bell").slice(0, 3)).toEqual([
      ["none", "Couldn't load"],
      ["none", "Couldn't load"],
      ["none", "Couldn't load"],
    ])
    expect(screen.getByText(ADMIN_ALBUMS_COPY.unavailableNote)).toBeTruthy()
  })

  it("is for admins only", async () => {
    auth.requireActiveAdmin.mockRejectedValue(new Error("NEXT_REDIRECT /staff"))
    await expect(AdminAlbumsPage()).rejects.toThrow("NEXT_REDIRECT /staff")
    expect(db.rpc).not.toHaveBeenCalled()

    // The read itself refuses anyone but an active admin, before any query.
    access.isAdmin = false
    const read = await loadAdminAlbums(actor as never)
    expect(read).toMatchObject({ ok: false, code: "not_permitted" })
    expect(db.rpc).not.toHaveBeenCalled()
  })
})

describe("AdminAlbumsView", () => {
  it("writes a legend for the tints, so colour is never alone", () => {
    render(<AdminAlbumsView albums={buildAdminAlbums([])} />)
    expect(screen.getByText(ADMIN_ALBUMS_COPY.emptyTitle)).toBeTruthy()
    cleanup()
    render(
      <AdminAlbumsView
        albums={buildAdminAlbums([
          {
            venueId: BELL,
            venueName: "The Bell",
            counts: { menuState: "ready", sections: [], amenities: [] },
            areas: [{ state: "accepted" }],
          },
        ])}
      />
    )
    const legend = screen.getByRole("list", {
      name: ADMIN_ALBUMS_COPY.legendTitle,
    })
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["None yet", "Under half", "Half or more", "Full"])
    // Nothing is empty: the count says so in words, and there are no gaps.
    expect(screen.getByText(ADMIN_ALBUMS_COPY.allFull)).toBeTruthy()
    expect(screen.getByText(ADMIN_ALBUMS_COPY.noGaps)).toBeTruthy()
  })

  it("uses the album words, never percentages or approval words", () => {
    render(sampleView())
    const text = document.body.textContent ?? ""
    expect(text).not.toMatch(
      /%|complete|approved|rejected|pending|task|overdue/i
    )
  })
})

function sampleView() {
  return (
    <AdminAlbumsView
      albums={buildAdminAlbums([
        {
          venueId: BELL,
          venueName: "The Bell",
          counts: {
            menuState: "ready",
            sections: [
              {
                name: "Mains",
                kind: "food",
                total: 10,
                accepted: 6,
                waiting: 1,
              },
            ],
            amenities: [],
          },
          areas: [{ state: "retake" }],
        },
      ])}
    />
  )
}
