import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// PostgREST answers at most max_rows rows per request and cuts the rest
// without an error, for tables and set-returning functions alike. These reads
// grow with the organisation, so they page; the pages must never exceed
// max_rows, or a full page comes back short and ends the read early.
vi.mock("@/lib/server/coverage/context", () => ({
  adminOnly: vi.fn(async () => ({ ok: true, access: { isAdmin: true } })),
}))

import { DIRECTORY_PAGE } from "@/lib/server/accounts/directory"
import { listManagerGrants } from "@/lib/server/coverage/admin"
import { coverageRpcFailure } from "@/lib/server/coverage/errors"
import { libraryFilterOptions } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"
import { MAX_ROWS_PAGE } from "@/lib/server/pages"

const MAX_ROWS = 1000
const FAILURE = { code: "57014", message: "canceling statement" }

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

/** Compares by each key in turn; `desc` keys sort newest first. */
function by<T>(...keys: [keyof T, "asc" | "desc"][]) {
  return (a: T, b: T) => {
    for (const [key, dir] of keys) {
      const x = String(a[key])
      const y = String(b[key])
      if (x !== y) return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1)
    }
    return 0
  }
}

type Read = { ranges: [number, number][]; orders: string[][] }

/**
 * A query builder that answers like PostgREST: in the order asked for, cut to
 * the range and never past MAX_ROWS, also when awaited without a range. Page
 * `failOn` (1-based) fails.
 */
function postgrest<T>(
  rows: T[],
  compare: (a: T, b: T) => number,
  read: Read,
  failOn?: number
) {
  const order: string[] = []
  const answer = (start: number, end: number) => {
    read.ranges.push([start, end])
    read.orders.push(order)
    if (read.ranges.length === failOn) return { data: null, error: FAILURE }
    const stop = Math.min(end + 1, start + MAX_ROWS)
    return { data: [...rows].sort(compare).slice(start, stop), error: null }
  }
  const query = {
    select: () => query,
    eq: () => query,
    order: (column: string, opts?: { ascending?: boolean }) => {
      order.push(opts?.ascending === false ? `${column} desc` : column)
      return query
    },
    range: async (start: number, end: number) => answer(start, end),
    then: (resolve: (value: unknown) => unknown) =>
      resolve(answer(0, Number.MAX_SAFE_INTEGER)),
  }
  return query
}

const pagesFor = (count: number) =>
  Array.from(
    { length: count === 0 ? 1 : Math.floor(count / 1000) + 1 },
    (_, p) => [p * 1000, p * 1000 + 999]
  )

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("page sizes never exceed supabase/config.toml max_rows", () => {
  const config = readFileSync(
    join(__dirname, "..", "..", "supabase", "config.toml"),
    "utf8"
  )
  const api = config.split(/^\[api\]\s*$/m)[1]?.split(/^\[/m)[0] ?? ""
  const maxRows = Number(api.match(/^max_rows\s*=\s*(\d+)/m)?.[1])

  it("reads max_rows from the [api] section", () => {
    expect(maxRows).toBeGreaterThan(0)
  })

  it.each([
    ["MAX_ROWS_PAGE", MAX_ROWS_PAGE],
    ["DIRECTORY_PAGE", DIRECTORY_PAGE],
  ])("%s fits in one response", (_name, size) => {
    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThanOrEqual(maxRows)
  })
})

describe("libraryFilterOptions reads every venue and staff member", () => {
  type Venue = { id: string; name: string }
  type Person = { id: string; display_name: string }
  const byVenue = by<Venue>(["name", "asc"], ["id", "asc"])
  const byPerson = by<Person>(["display_name", "asc"], ["id", "asc"])

  /** `count` people created out of order, names shared so the id breaks ties. */
  const staff = (count: number): Person[] =>
    Array.from({ length: count }, (_, i) => {
      const n = (i * 7919) % Math.max(count, 1)
      return {
        id: uuid(n + 1),
        display_name: `TEST Staff ${String(Math.floor(n / 2)).padStart(5, "0")}`,
      }
    })
  const venues = (count: number): Venue[] =>
    Array.from({ length: count }, (_, i) => ({
      id: uuid(50_000 + count - i),
      name: `TEST Venue ${String(i % 400).padStart(3, "0")}`,
    }))

  function actorWith(
    venueRows: Venue[],
    staffRows: Person[],
    fail: { venues?: number; staff?: number } = {}
  ) {
    const reads = {
      venues: { ranges: [], orders: [] } as Read,
      profiles: { ranges: [], orders: [] } as Read,
    }
    const from = (table: string) =>
      table === "venues"
        ? postgrest(venueRows, byVenue, reads.venues, fail.venues)
        : table === "profiles"
          ? postgrest(staffRows, byPerson, reads.profiles, fail.staff)
          : (() => {
              throw new Error(`unexpected table ${table}`)
            })()
    const actor = {
      profile: { role: "admin" },
      db: { from },
    } as unknown as MediaActor
    return { actor, reads }
  }

  it.each([0, 999, 1000, 1001, 2500])(
    "%i staff: every page read, every person once, in name order",
    async (count) => {
      const rows = staff(count)
      const { actor, reads } = actorWith(venues(3), rows)
      const options = await libraryFilterOptions(actor)
      expect(reads.profiles.ranges).toEqual(pagesFor(count))
      for (const order of reads.profiles.orders)
        expect(order).toEqual(["display_name", "id"])
      expect(options.staff).toEqual(
        [...rows]
          .sort(byPerson)
          .map((p) => ({ id: p.id, name: p.display_name }))
      )
      expect(new Set(options.staff.map((p) => p.id)).size).toBe(count)
    }
  )

  it.each([0, 999, 1000, 1001, 2500])(
    "%i venues: every page read, in name order",
    async (count) => {
      const rows = venues(count)
      const { actor, reads } = actorWith(rows, staff(2))
      const options = await libraryFilterOptions(actor)
      expect(reads.venues.ranges).toEqual(pagesFor(count))
      for (const order of reads.venues.orders)
        expect(order).toEqual(["name", "id"])
      expect(options.venues).toEqual([...rows].sort(byVenue))
    }
  )

  it("a failed second staff page empties that list only, as a failed read always did", async () => {
    const { actor, reads } = actorWith(venues(3), staff(2500), { staff: 2 })
    const options = await libraryFilterOptions(actor)
    expect(reads.profiles.ranges).toHaveLength(2)
    expect(options.staff).toEqual([])
    expect(options.venues).toHaveLength(3)
  })

  it("is empty for anyone but an admin, reading nothing", async () => {
    const from = vi.fn()
    const actor = {
      profile: { role: "staff" },
      db: { from },
    } as unknown as MediaActor
    expect(await libraryFilterOptions(actor)).toEqual({ venues: [], staff: [] })
    expect(from).not.toHaveBeenCalled()
  })
})

describe("listManagerGrants reads every grant in its history", () => {
  type Grant = {
    grant_id: string
    staff_id: string
    staff_name: string
    staff_active: boolean
    staff_venue_id: string
    venue_id: string
    venue_name: string
    granted_by: string
    granted_by_name: string
    granted_at: string
    grant_reason: string | null
    revoked_at: string | null
    revoked_by_name: string | null
    revoke_kind: string | null
    revoke_reason: string | null
    effective: boolean
  }
  const byGrant = by<Grant>(
    ["venue_name", "asc"],
    ["staff_name", "asc"],
    ["granted_at", "desc"],
    ["grant_id", "asc"]
  )

  /**
   * `count` grants over 7 venues and 150 people, so a person holds several
   * over time; some share a grant time, so the grant id breaks ties.
   */
  function grants(count: number): Grant[] {
    return Array.from({ length: count }, (_, i) => {
      const n = (i * 7919) % Math.max(count, 1)
      const person = n % 150
      const ended = n >= 150
      return {
        grant_id: uuid(200_000 + n),
        staff_id: uuid(person + 1),
        staff_name: `TEST Holder ${String(person).padStart(3, "0")}`,
        staff_active: true,
        staff_venue_id: uuid(90_000 + (n % 7)),
        venue_id: uuid(90_000 + (n % 7)),
        venue_name: `TEST Venue ${n % 7}`,
        granted_by: uuid(80_000),
        granted_by_name: "TEST Admin",
        granted_at: `2026-${String(1 + (n % 10)).padStart(2, "0")}-01T09:00:00.000Z`,
        grant_reason: null,
        revoked_at: ended ? "2026-11-02T09:00:00.000Z" : null,
        revoked_by_name: null,
        revoke_kind: ended ? "venue_changed" : null,
        revoke_reason: null,
        effective: !ended,
      }
    })
  }
  const isStaff = (id: string) => parseInt(id.slice(-12), 16) % 2 === 0

  function expected(rows: Grant[]) {
    return [...rows].sort(byGrant).map((g) => ({
      id: g.grant_id,
      staff: {
        id: g.staff_id,
        displayName: g.staff_name,
        active: g.staff_active,
      },
      staffVenueId: g.staff_venue_id,
      venue: { id: g.venue_id, name: g.venue_name },
      grantedBy: { id: g.granted_by, displayName: g.granted_by_name },
      grantedAt: g.granted_at,
      grantReason: g.grant_reason,
      revokedAt: g.revoked_at,
      revokedByName: g.revoked_by_name,
      revokeKind: g.revoke_kind,
      revokeReason: g.revoke_reason,
      effective: g.effective,
      legacyStaffGrant: isStaff(g.staff_id),
    }))
  }

  function actorWith(rows: Grant[], failOn?: number) {
    const read: Read = { ranges: [], orders: [] }
    const calls: { name: string; args: unknown }[] = []
    const rpc = (name: string, args: unknown) => {
      calls.push({ name, args })
      return postgrest(rows, byGrant, read, failOn)
    }
    const from = (table: string) => {
      expect(table).toBe("profiles")
      return {
        select: () => ({
          in: async (_column: string, ids: string[]) => ({
            data: ids.map((id) => ({
              id,
              role: isStaff(id) ? "staff" : "manager",
            })),
            error: null,
          }),
        }),
      }
    }
    const actor = { db: { rpc, from } } as unknown as MediaActor
    return { actor, read, calls }
  }

  it.each([0, 999, 1000, 1001, 2500])(
    "%i grants: every page read, in the function's order made total",
    async (count) => {
      const rows = grants(count)
      const { actor, read, calls } = actorWith(rows)
      const result = await listManagerGrants(actor, { includeRevoked: true })
      expect(read.ranges).toEqual(pagesFor(count))
      for (const order of read.orders)
        expect(order).toEqual([
          "venue_name",
          "staff_name",
          "granted_at desc",
          "grant_id",
        ])
      for (const call of calls)
        expect(call).toEqual({
          name: "venue_manager_grant_list",
          args: { p_include_revoked: true },
        })
      expect(result).toEqual({ ok: true, grants: expected(rows) })
    }
  )

  it("keeps the venue filter on every page", async () => {
    const { actor, calls } = actorWith(grants(1500))
    await listManagerGrants(actor, { venueId: uuid(90_001) })
    expect(calls).toHaveLength(2)
    for (const call of calls)
      expect(call.args).toEqual({
        p_venue_id: uuid(90_001),
        p_include_revoked: false,
      })
  })

  it("a failed second page fails the list, mapped as a failed read always was", async () => {
    const { actor, read } = actorWith(grants(2500), 2)
    expect(await listManagerGrants(actor, { includeRevoked: true })).toEqual(
      coverageRpcFailure(FAILURE, "manager grants")
    )
    expect(read.ranges).toHaveLength(2)
  })
})
