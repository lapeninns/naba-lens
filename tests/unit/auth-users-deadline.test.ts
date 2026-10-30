import { describe, expect, it, vi } from "vitest"

import {
  AuthLookupError,
  listAuthUsers,
} from "@/lib/server/accounts/auth-users"
import type { Db } from "@/lib/server/accounts/context"

// Final review F8: after the deadline, the page loop must stop fetching more
// pages from an already slow GoTrue instead of running on to MAX_PAGES.
const PAGE_MS = 30

function slowFullPages() {
  const listUsers = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, PAGE_MS))
    return {
      data: { users: Array.from({ length: 1000 }, (_, i) => ({ id: `${i}` })) },
      error: null,
    }
  })
  return {
    listUsers,
    service: { auth: { admin: { listUsers } } } as unknown as Db,
  }
}

describe("listAuthUsers deadline (final review F8)", () => {
  it("requests no further page once the deadline has passed", async () => {
    const { listUsers, service } = slowFullPages()
    await expect(listAuthUsers(service, PAGE_MS * 2.5)).rejects.toEqual(
      new AuthLookupError("timeout")
    )
    const atDeadline = listUsers.mock.calls.length
    expect(atDeadline).toBeLessThanOrEqual(3)
    // Long enough for several more pages if the loop kept going.
    await new Promise((r) => setTimeout(r, PAGE_MS * 8))
    expect(listUsers.mock.calls.length).toBe(atDeadline)
  })
})
