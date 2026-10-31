import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  assertVerificationStack,
  createFixtures,
  psql,
  type Fixtures,
} from "../support/db"

// Real-database lease semantics (§4.3): the lease is the only thing keeping two
// audit invocations from writing the same cycle. Own lease names are used so
// nothing here touches the production lease name.
let fx: Fixtures
beforeAll(async () => {
  assertVerificationStack()
  fx = await createFixtures()
})

const lease = () => `ver_lease_${randomUUID().replace(/-/g, "").slice(0, 16)}`
const acquire = (name: string, holder: string, ttl = "30 seconds") =>
  fx.service.rpc("acquire_maintenance_lease", {
    p_name: name,
    p_holder: holder,
    p_ttl: ttl,
  })
const release = (name: string, holder: string) =>
  fx.service.rpc("release_maintenance_lease", {
    p_name: name,
    p_holder: holder,
  })
const holderOf = (name: string) =>
  psql(`select holder from private.maintenance_leases where name = '${name}'`)
    .out

describe("maintenance lease on the real database", () => {
  it("25 concurrent acquirers: exactly one wins", async () => {
    const name = lease()
    const results = await Promise.all(
      Array.from({ length: 25 }, () => acquire(name, randomUUID()))
    )
    expect(results.every((r) => r.error === null)).toBe(true)
    expect(results.filter((r) => r.data === true)).toHaveLength(1)
    await release(name, holderOf(name))
  })

  it("the holder renews repeatedly, others stay locked out, release frees it for the next holder", async () => {
    const name = lease()
    const a = randomUUID()
    const b = randomUUID()
    expect((await acquire(name, a)).data).toBe(true)
    for (let i = 0; i < 3; i++) expect((await acquire(name, a)).data).toBe(true)
    expect((await acquire(name, b)).data).toBe(false)
    await release(name, a)
    expect((await acquire(name, b)).data).toBe(true)
    await release(name, b)
    expect(holderOf(name)).toBe("")
  })

  it("renewal pushes the expiry out", async () => {
    const name = lease()
    const a = randomUUID()
    await acquire(name, a, "2 seconds")
    await new Promise((r) => setTimeout(r, 1200))
    expect((await acquire(name, a, "5 seconds")).data).toBe(true)
    await new Promise((r) => setTimeout(r, 1500))
    // The original 2 s TTL has passed; the renewed lease still holds.
    expect((await acquire(name, randomUUID())).data).toBe(false)
    await release(name, a)
  })

  it("an expired lease is taken over, and the previous holder then loses its renewal", async () => {
    const name = lease()
    const a = randomUUID()
    const b = randomUUID()
    await acquire(name, a, "1 second")
    await new Promise((r) => setTimeout(r, 1300))
    expect((await acquire(name, b)).data).toBe(true)
    expect((await acquire(name, a)).data).toBe(false)
    expect(holderOf(name)).toBe(b)
    await release(name, b)
  })

  it("a release by anyone but the holder is a no-op", async () => {
    const name = lease()
    const a = randomUUID()
    await acquire(name, a)
    await release(name, randomUUID())
    expect(holderOf(name)).toBe(a)
    await release(name, a)
  })

  it("racing a takeover after expiry still has exactly one winner", async () => {
    for (let round = 0; round < 5; round++) {
      const name = lease()
      await acquire(name, randomUUID(), "1 second")
      await new Promise((r) => setTimeout(r, 1200))
      const results = await Promise.all(
        Array.from({ length: 8 }, () => acquire(name, randomUUID()))
      )
      expect(results.filter((r) => r.data === true)).toHaveLength(1)
      await release(name, holderOf(name))
    }
  })

  it("rejects TTLs outside 1 second to 1 hour and a null holder", async () => {
    const name = lease()
    for (const ttl of ["0.5 seconds", "2 hours", "-5 seconds"]) {
      const result = await acquire(name, randomUUID(), ttl)
      expect(result.error?.code).toBe("22023")
    }
    const nullHolder = await fx.service.rpc("acquire_maintenance_lease", {
      p_name: name,
      p_holder: null as never,
      p_ttl: "10 seconds",
    })
    expect(nullHolder.error).not.toBeNull()
    expect(holderOf(name)).toBe("")
  })

  it("rejects malformed lease names at the table", async () => {
    const result = await acquire("Bad Name; drop", randomUUID())
    expect(result.error).not.toBeNull()
  })

  it("anonymous, staff and admin clients cannot touch leases", async () => {
    const name = lease()
    for (const client of [anonClient(), fx.staff.client, fx.admin.client]) {
      const taken = await client.rpc("acquire_maintenance_lease", {
        p_name: name,
        p_holder: randomUUID(),
        p_ttl: "10 seconds",
      })
      expect(taken.error?.code).toBe("42501")
      const freed = await client.rpc("release_maintenance_lease", {
        p_name: name,
        p_holder: randomUUID(),
      })
      expect(freed.error?.code).toBe("42501")
    }
    expect(holderOf(name)).toBe("")
  })

  it("the lease table is not exposed through the Data API", async () => {
    const read = await fx.service
      .schema("private" as never)
      .from("maintenance_leases" as never)
      .select("*")
    expect(read.error).not.toBeNull()
  })
})
