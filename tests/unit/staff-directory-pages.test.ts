import { afterEach, describe, expect, it, vi } from "vitest"

// PostgREST answers at most max_rows (1000) rows per request without saying
// so. With one unpaged read the admin directory stopped at 1,000 people.
vi.mock("@/lib/server/accounts/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/accounts/context")>()),
  requireAdminCaller: vi.fn(async () => ({
    ok: true,
    admin: { id: "admin", role: "admin" },
  })),
}))
const listAuthUsers = vi.hoisted(() => vi.fn())
vi.mock("@/lib/server/accounts/auth-users", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/server/accounts/auth-users")
  >()),
  listAuthUsers,
}))

import type { AccountsContext, Db } from "@/lib/server/accounts/context"
import {
  DIRECTORY_PAGE,
  listStaffDirectory,
} from "@/lib/server/accounts/directory"
import { dbFailed } from "@/lib/server/accounts/invite"

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

type Row = {
  id: string
  role: "staff" | "manager"
  display_name: string
  avatar_path: string | null
  job_title: string | null
  department: "foh" | "boh" | null
  venue_id: string | null
  active: boolean
  venue: { name: string; active: boolean } | null
}

/**
 * `count` people, created out of order, with shared names so the id breaks
 * ties. Every 7th has a photo, every 5th is inactive, every 3rd a manager.
 */
function people(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const n = (i * 7919) % Math.max(count, 1)
    return {
      id: uuid(n + 1),
      role: n % 3 === 0 ? "manager" : "staff",
      display_name: `TEST Person ${String(Math.floor(n / 2)).padStart(5, "0")}`,
      avatar_path: n % 7 === 0 ? `${uuid(n + 1)}/avatar.webp` : null,
      job_title: n % 2 ? "Chef" : null,
      department: n % 2 ? "boh" : "foh",
      venue_id: uuid(90_000),
      venue: { name: "TEST Venue", active: true },
      active: n % 5 !== 0,
    }
  })
}

const byNameThenId = (a: Row, b: Row) =>
  a.display_name < b.display_name
    ? -1
    : a.display_name > b.display_name
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0

/** The directory a single, unlimited read of these rows would give. */
function expected(rows: Row[]) {
  return [...rows].sort(byNameThenId).map((r) => ({
    id: r.id,
    role: r.role,
    displayName: r.display_name,
    avatarUrl: r.avatar_path ? `signed:${r.avatar_path}` : null,
    jobTitle: r.job_title,
    department: r.department,
    venueId: r.venue_id,
    venueName: "TEST Venue",
    venueActive: true,
    email: `${r.id}@example.test`,
    status: r.active ? "active" : "inactive",
    lastSignInAt: "2026-11-01T09:00:00Z",
  }))
}

/**
 * A caller whose profile reads behave like PostgREST: ordered as asked, cut
 * to the requested range and never past max_rows. Page `failOn` (1-based)
 * fails.
 */
function contextFor(rows: Row[], failOn?: number) {
  const ranges: [number, number][] = []
  const orders: string[][] = []
  const from = vi.fn((table: string) => {
    expect(table).toBe("profiles")
    const order: string[] = []
    const query = {
      select: () => query,
      in: (column: string, roles: string[]) => {
        expect(column).toBe("role")
        expect(roles).toEqual(["staff", "manager"])
        return query
      },
      order: (column: string, opts: { ascending: boolean }) => {
        expect(opts).toEqual({ ascending: true })
        order.push(column)
        return query
      },
      // Awaited without a range, PostgREST still stops at max_rows.
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
        ranges.push([0, Infinity])
        orders.push(order)
        return resolve({
          data: [...rows].sort(byNameThenId).slice(0, 1000),
          error: null,
        })
      },
      range: async (start: number, end: number) => {
        ranges.push([start, end])
        orders.push(order)
        if (ranges.length === failOn)
          return { data: null, error: { code: "57014", message: "timeout" } }
        const sorted = [...rows].sort(byNameThenId)
        const stop = Math.min(end + 1, start + 1000)
        return { data: sorted.slice(start, stop), error: null }
      },
    }
    return query
  })
  const service = {
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
          error: null,
        }),
      }),
    },
  }
  const ctx: AccountsContext = {
    caller: { from } as unknown as Db,
    service: service as unknown as Db,
  }
  return { ctx, ranges, orders }
}

listAuthUsers.mockImplementation(async () =>
  people(2500).map((r) => ({
    id: r.id,
    email: `${r.id}@example.test`,
    last_sign_in_at: "2026-11-01T09:00:00Z",
    email_confirmed_at: "2026-11-01T09:00:00Z",
  }))
)

afterEach(() => vi.clearAllMocks())

describe("listStaffDirectory reads every page", () => {
  it("pages hold max_rows (1000)", () => {
    expect(DIRECTORY_PAGE).toBe(1000)
  })

  it.each([
    [0, 1],
    [999, 1],
    [1000, 2],
    [1001, 2],
    [2500, 3],
  ])("%i people: %i page reads, nobody missing", async (count, pages) => {
    const rows = people(count)
    const { ctx, ranges, orders } = contextFor(rows)
    const result = await listStaffDirectory(ctx)
    expect(ranges).toEqual(
      Array.from({ length: pages }, (_, p) => [p * 1000, p * 1000 + 999])
    )
    // Every page asks for the same total order, so pages never overlap.
    for (const order of orders) expect(order).toEqual(["display_name", "id"])
    expect(result).toEqual({
      ok: true,
      authDetails: "ok",
      staff: expected(rows),
    })
  })

  it("keeps names in order across a page boundary, the id breaking ties", async () => {
    const rows = people(2500)
    const { ctx } = contextFor(rows)
    const result = await listStaffDirectory(ctx)
    if (!result.ok) throw new Error(result.error)
    const keys = result.staff.map((s) => `${s.displayName}|${s.id}`)
    expect(keys).toEqual([...keys].sort())
    expect(new Set(result.staff.map((s) => s.id)).size).toBe(2500)
  })

  it("a failed second page fails the whole list, as a failed read always did", async () => {
    const { ctx, ranges } = contextFor(people(2500), 2)
    expect(await listStaffDirectory(ctx)).toEqual(dbFailed())
    expect(ranges).toHaveLength(2)
    expect(listAuthUsers).not.toHaveBeenCalled()
  })
})
