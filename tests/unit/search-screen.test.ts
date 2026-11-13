// B05-06 search screen review repairs (R4, R10, R11): the shared server
// screen asks for page one with the canonical filters, never builds a
// PostgREST filter string from the URL, and reads venues only for admins.
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  searchAssets: vi.fn(),
  libraryFilterOptions: vi.fn(),
  libraryVenueOptions: vi.fn(),
  libraryLabelFilterOptions: vi.fn(),
  getLabellingCatalogue: vi.fn(),
}))

vi.mock("@/lib/server/media/search", () => ({
  searchAssets: mocks.searchAssets,
}))
vi.mock("@/lib/server/media/library", () => ({
  libraryFilterOptions: mocks.libraryFilterOptions,
  libraryVenueOptions: mocks.libraryVenueOptions,
}))
vi.mock("@/lib/server/media/library-labels", () => ({
  libraryLabelFilterOptions: mocks.libraryLabelFilterOptions,
}))
vi.mock("@/lib/server/labels", () => ({
  getLabellingCatalogue: mocks.getLabellingCatalogue,
}))

import { SearchScreen } from "@/app/staff/manage/_shared/screens/search"
import type { MediaActor } from "@/lib/server/media/types"

const VENUE = "0b5a0f86-1b8e-4d5a-9f53-7d2b7c3c9e11"

type Call = { method: string; args: unknown[] }

/** A service client that records each query's builder calls. */
function fakeService(
  rows: { key: string; label: string; venue: string | null }[]
) {
  const queries: Call[][] = []
  const from = (table: string) => {
    const calls: Call[] = [{ method: "from", args: [table] }]
    queries.push(calls)
    const builder: Record<string, unknown> = {}
    for (const method of ["select", "eq", "is", "or", "order", "in"])
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args })
        return builder
      }
    builder.then = (resolve: (v: unknown) => void) => {
      const isNull = calls.some(
        (c) => c.method === "is" && c.args[0] === "venue_id"
      )
      const eq = calls.find(
        (c) => c.method === "eq" && c.args[0] === "venue_id"
      )?.args[1]
      resolve({
        data: rows
          .filter((r) =>
            isNull ? r.venue === null : eq ? r.venue === eq : true
          )
          .map(({ key, label }) => ({ key, label })),
        error: null,
      })
    }
    return builder
  }
  return { service: { from }, queries }
}

function adminActor(service: unknown): MediaActor {
  return {
    profile: { id: "admin", role: "admin", active: true },
    service,
    db: {},
  } as unknown as MediaActor
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.searchAssets.mockResolvedValue({
    ok: true,
    items: [],
    nextCursor: null,
  })
  mocks.libraryFilterOptions.mockResolvedValue({ venues: [], staff: [] })
  mocks.libraryVenueOptions.mockResolvedValue([])
  mocks.libraryLabelFilterOptions.mockResolvedValue({ items: [] })
})

const calls = (queries: Call[][]) => queries.flat()

describe("SearchScreen (admin)", () => {
  it("never puts the URL's venue into a PostgREST filter string (R4)", async () => {
    const { service, queries } = fakeService([])
    await SearchScreen({
      mode: "admin",
      actor: adminActor(service),
      viewerName: "Admin",
      search: { venue: `${VENUE},venue_id.not.is.null` },
    })
    const all = calls(queries)
    expect(all.filter((c) => c.method === "or")).toEqual([])
    // A value that is not a venue id is not asked about at all.
    expect(
      all.filter((c) => c.method === "eq" && c.args[0] === "venue_id")
    ).toEqual([])
  })

  it("reads organisation-wide places and the chosen venue's (R4)", async () => {
    const { service, queries } = fakeService([
      { key: "org", label: "Org place", venue: null },
      { key: "mine", label: "A place", venue: VENUE },
      { key: "other", label: "B place", venue: "x" },
    ])
    const view = await SearchScreen({
      mode: "admin",
      actor: adminActor(service),
      viewerName: "Admin",
      search: { venue: VENUE, rights: "in_force" },
    })
    const all = calls(queries)
    expect(all.filter((c) => c.method === "or")).toEqual([])
    expect(
      all.some(
        (c) =>
          c.method === "eq" && c.args[0] === "venue_id" && c.args[1] === VENUE
      )
    ).toBe(true)
    // The SearchView inside the shell gets both places, by label.
    const json = JSON.stringify(view, (_k, v) =>
      typeof v === "function" || v instanceof Promise ? undefined : v
    )
    expect(json).toContain(
      '"destinations":[{"id":"mine","name":"A place"},{"id":"org","name":"Org place"}]'
    )
  })

  it("lists every venue's active places when an admin searches every venue", async () => {
    const { service, queries } = fakeService([
      { key: "org", label: "Org place", venue: null },
      { key: "mine", label: "A place", venue: VENUE },
      { key: "other", label: "B place", venue: "x" },
    ])
    const view = await SearchScreen({
      mode: "admin",
      actor: adminActor(service),
      viewerName: "Admin",
      search: { rights: "in_force" },
    })
    const all = calls(queries)
    expect(all.filter((c) => c.method === "or")).toEqual([])
    const json = JSON.stringify(view, (_k, v) =>
      typeof v === "function" || v instanceof Promise ? undefined : v
    )
    expect(json).toContain(
      '"destinations":[{"id":"mine","name":"A place"},{"id":"other","name":"B place"},{"id":"org","name":"Org place"}]'
    )
  })

  it("asks page one with the canonical filters: no destination without In use (R10)", async () => {
    const { service } = fakeService([])
    await SearchScreen({
      mode: "admin",
      actor: adminActor(service),
      viewerName: "Admin",
      search: { destination: "website", rights: "expired", venue: VENUE },
    })
    expect(mocks.searchAssets).toHaveBeenCalledTimes(1)
    const filters = mocks.searchAssets.mock.calls[0]![1].filters
    expect(filters).toEqual({ venue: VENUE, rights: "expired" })
    expect(filters).not.toHaveProperty("destination")
  })

  it("keeps the destination for In use (R10)", async () => {
    const { service } = fakeService([])
    await SearchScreen({
      mode: "admin",
      actor: adminActor(service),
      viewerName: "Admin",
      search: { destination: "website", rights: "in_force" },
    })
    expect(mocks.searchAssets.mock.calls[0]![1].filters).toEqual({
      rights: "in_force",
      destination: "website",
    })
  })

  it("reads venues only, never every staff profile (R11)", async () => {
    const { service } = fakeService([])
    await SearchScreen({
      mode: "admin",
      actor: adminActor(service),
      viewerName: "Admin",
      search: {},
    })
    expect(mocks.libraryFilterOptions).not.toHaveBeenCalled()
    expect(mocks.libraryVenueOptions).toHaveBeenCalledTimes(1)
  })
})

describe("SearchScreen (manager)", () => {
  it("keeps a stray venue so the database still refuses it (R10)", async () => {
    const { service } = fakeService([])
    const actor = {
      profile: { id: "m", role: "manager", active: true },
      service,
      db: {},
    } as unknown as MediaActor
    mocks.getLabellingCatalogue.mockResolvedValue({ ok: false })
    await SearchScreen({
      mode: "workspace",
      ctx: {
        actor,
        venueId: VENUE,
        venue: { id: VENUE, name: "Venue A" },
      } as never,
      search: { venue: "other-venue", destination: "website" },
    })
    expect(mocks.searchAssets.mock.calls[0]![1].filters).toEqual({
      venue: "other-venue",
    })
  })
})
