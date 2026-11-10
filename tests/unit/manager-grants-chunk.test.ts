import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// listManagerGrants reads holder roles with `.in("id", …)`, a GET whose URL
// grows with every id. Past a few hundred holders the gateway answered "URI
// too long" and every admin grants view failed, so the read is chunked.
vi.mock("@/lib/server/coverage/context", () => ({
  adminOnly: vi.fn(async () => ({ ok: true, access: { isAdmin: true } })),
}))

import {
  GRANT_HOLDER_CHUNK,
  listManagerGrants,
} from "@/lib/server/coverage/admin"
import type { MediaActor } from "@/lib/server/media/types"

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

type GrantRow = {
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
  grant_reason: string
  revoked_at: string
  revoked_by_name: string
  revoke_kind: string
  revoke_reason: string
  effective: boolean
}

/**
 * `holders` distinct people; every third person also has an ended grant, so
 * a holder can appear twice. Even-numbered people are staff accounts.
 */
function grantRows(holders: number): GrantRow[] {
  const rows: GrantRow[] = []
  for (let n = 1; n <= holders; n++) {
    const grant = (g: number, ended: boolean): GrantRow => ({
      grant_id: uuid(100_000 + g),
      staff_id: uuid(n),
      staff_name: `TEST Person ${n}`,
      staff_active: true,
      staff_venue_id: uuid(90_000),
      venue_id: uuid(90_000),
      venue_name: "TEST Venue",
      granted_by: uuid(80_000),
      granted_by_name: "TEST Admin",
      granted_at: "2026-11-01T09:00:00.000Z",
      grant_reason: "TEST",
      revoked_at: ended ? "2026-11-02T09:00:00.000Z" : (null as never),
      revoked_by_name: null as never,
      revoke_kind: ended ? "venue_changed" : (null as never),
      revoke_reason: null as never,
      effective: !ended,
    })
    rows.push(grant(2 * n, false))
    if (n % 3 === 0) rows.push(grant(2 * n + 1, true))
  }
  return rows
}

const isStaff = (id: string) => parseInt(id.slice(-12), 16) % 2 === 0

/** The view the service promises, built from the rows independently. */
function expectedGrants(rows: GrantRow[]) {
  return rows.map((g) => ({
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

/** A client whose profile reads answer in reverse order, failing on `failOn` (1-based). */
function actorWith(rows: GrantRow[], failOn?: number) {
  const calls: string[][] = []
  const inFn = vi.fn(async (column: string, ids: string[]) => {
    expect(column).toBe("id")
    calls.push(ids)
    if (calls.length === failOn)
      return { data: null, error: { code: "PGRST", message: "URI too long" } }
    return {
      data: [...ids]
        .reverse()
        .map((id) => ({ id, role: isStaff(id) ? "staff" : "manager" })),
      error: null,
    }
  })
  const from = vi.fn((table: string) => {
    expect(table).toBe("profiles")
    return { select: vi.fn(() => ({ in: inFn })) }
  })
  // The grant list is read in ranged pages; these lists fit in one.
  const rpc = vi.fn(() => {
    const query = {
      order: () => query,
      range: async (from: number, to: number) => ({
        data: rows.slice(from, to + 1),
        error: null,
      }),
    }
    return query
  })
  const actor = { db: { rpc, from } } as unknown as MediaActor
  return { actor, calls, from }
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("listManagerGrants reads holder roles in chunks", () => {
  it("uses chunks of at most 100 ids", () => {
    expect(GRANT_HOLDER_CHUNK).toBe(100)
  })

  it.each([
    [0, 0],
    [1, 1],
    [100, 1],
    [101, 2],
    [350, 4],
  ])(
    "%i holders: %i profile reads, output unchanged",
    async (holders, reads) => {
      const rows = grantRows(holders)
      const { actor, calls } = actorWith(rows)
      const result = await listManagerGrants(actor, {})
      expect(calls).toHaveLength(reads)
      expect(
        Math.max(0, ...calls.map((ids) => ids.length))
      ).toBeLessThanOrEqual(GRANT_HOLDER_CHUNK)
      // Every distinct holder is read exactly once, in first-seen order.
      const distinct = [...new Set(rows.map((g) => g.staff_id))]
      expect(calls.flat()).toEqual(distinct)
      expect(result).toEqual({ ok: true, grants: expectedGrants(rows) })
    }
  )

  it("splits 350 holders as 100, 100, 100 and 50", async () => {
    const { actor, calls } = actorWith(grantRows(350))
    await listManagerGrants(actor, {})
    expect(calls.map((ids) => ids.length)).toEqual([100, 100, 100, 50])
  })

  it.each([1, 2, 4])(
    "a failed read in chunk %i of 4 makes the list unavailable",
    async (failOn) => {
      const { actor, calls } = actorWith(grantRows(350), failOn)
      expect(await listManagerGrants(actor, {})).toEqual({
        ok: false,
        code: "unavailable",
        status: 503,
        message:
          "Coverage could not be loaded or saved right now. Try again shortly.",
      })
      expect(calls).toHaveLength(failOn)
    }
  )
})
