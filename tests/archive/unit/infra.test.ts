import { afterEach, describe, expect, it } from "vitest"

import { TestClock, flush } from "../support/clock"
import { createWorld } from "../support/world"

// Self-tests for the fakes. Failure-mode suites rely on these behaving like
// the real thing, so each fault and each modelled DB rule is pinned here.

describe("TestClock", () => {
  it("fires sleeps in order as time advances", async () => {
    const clock = new TestClock()
    const order: number[] = []
    void clock.sleep(30).then(() => order.push(30))
    void clock.sleep(10).then(() => order.push(10))
    await clock.advance(20)
    expect(order).toEqual([10])
    await clock.advance(10)
    expect(order).toEqual([10, 30])
  })

  it("aborts a sleep and a deadline signal on the simulated clock", async () => {
    const clock = new TestClock()
    const controller = new AbortController()
    const sleeping = clock.sleep(1000, controller.signal)
    const rejected = expect(sleeping).rejects.toMatchObject({
      name: "AbortError",
    })
    controller.abort()
    await rejected
    const deadline = clock.deadline(5000)
    await clock.advance(4999)
    expect(deadline.aborted).toBe(false)
    await clock.advance(1)
    expect(deadline.aborted).toBe(true)
  })

  it("drive fails loudly when work never settles", async () => {
    const clock = new TestClock()
    await expect(
      clock.drive(new Promise(() => undefined), 1000, 5000)
    ).rejects.toThrow(/still pending/)
  })
})

describe("FakeBucket", () => {
  afterEach(() => undefined)

  it("verifies seeded objects and rejects missing, wrong-hash and wrong-size", async () => {
    const world = createWorld()
    const [id] = world.seedReceipts(1)
    const receipt = world.db.rows("media_archive_receipts")[0]
    const store = world.bucket.store()
    await store.verifyOriginal(
      String(receipt.blob_key),
      String(receipt.sha256),
      1024
    )
    await expect(
      store.verifyOriginal(String(receipt.blob_key), "0".repeat(64), 1024)
    ).rejects.toThrow("archive_destination_verification_failed")
    await expect(
      store.verifyOriginal(String(receipt.blob_key), String(receipt.sha256), 5)
    ).rejects.toThrow("archive_destination_verification_failed")
    await expect(store.verifyOriginal("nope", "a", 1)).rejects.toThrow(
      "archive_destination_verification_failed"
    )
    expect(id).toBe(1)
  })

  it("applies error faults after N calls for M calls only", async () => {
    const world = createWorld()
    world.seedReceipts(1)
    const receipt = world.db.rows("media_archive_receipts")[0]
    const verify = () =>
      world.bucket
        .store()
        .verifyOriginal(String(receipt.blob_key), String(receipt.sha256), 1024)
    world.bucket.inject({
      op: "verifyOriginal",
      kind: "error",
      after: 1,
      times: 1,
    })
    await verify()
    await expect(verify()).rejects.toThrow()
    await verify()
    expect(
      world.bucket.callsTo("verifyOriginal").map((c) => c.outcome)
    ).toEqual(["ok", "error", "ok"])
  })

  it("corrupt and vanish are persistent until the object is re-seeded", async () => {
    const world = createWorld()
    world.seedReceipts(2)
    const [first, second] = world.db.rows("media_archive_receipts")
    world.bucket.inject({
      op: "verifyOriginal",
      key: String(first.blob_key),
      kind: "corrupt",
      times: 1,
    })
    world.bucket.inject({
      op: "verifyOriginal",
      key: String(second.blob_key),
      kind: "vanish",
      times: 1,
    })
    const store = world.bucket.store()
    // The faulted call itself still verifies the now-damaged object.
    await expect(
      store.verifyOriginal(String(first.blob_key), String(first.sha256), 1024)
    ).rejects.toThrow()
    await expect(
      store.verifyOriginal(String(second.blob_key), String(second.sha256), 1024)
    ).rejects.toThrow()
    await expect(
      store.verifyOriginal(String(first.blob_key), String(first.sha256), 1024)
    ).rejects.toThrow()
  })

  it("a hang honours the abort signal and is recorded as aborted", async () => {
    const world = createWorld()
    world.seedReceipts(1)
    const receipt = world.db.rows("media_archive_receipts")[0]
    world.bucket.inject({ op: "verifyOriginal", kind: "hang" })
    const signal = world.clock.deadline(80_000)
    const pending = world.bucket
      .store(signal)
      .verifyOriginal(String(receipt.blob_key), String(receipt.sha256), 1024)
    const settled = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    })
    await world.clock.advance(79_999)
    expect(world.bucket.calls[0].outcome).toBe("pending")
    await world.clock.advance(1)
    await settled
    expect(world.bucket.calls[0].outcome).toBe("aborted")
  })

  it("a hang that ignores the signal outlives the deadline (misbehaving SDK)", async () => {
    const world = createWorld()
    world.seedReceipts(1)
    const receipt = world.db.rows("media_archive_receipts")[0]
    world.bucket.inject({
      op: "verifyOriginal",
      kind: "hang",
      ignoreSignal: true,
      ms: 200_000,
    })
    const signal = world.clock.deadline(80_000)
    let done = false
    void world.bucket
      .store(signal)
      .verifyOriginal(String(receipt.blob_key), String(receipt.sha256), 1024)
      .then(() => (done = true))
    await world.clock.advance(100_000)
    expect(signal.aborted).toBe(true)
    expect(done).toBe(false)
    await world.clock.advance(100_000)
    expect(done).toBe(true)
  })
})

describe("FakeDb", () => {
  it("models lease acquire, renew by holder, expiry steal and holder-only release", async () => {
    const world = createWorld()
    const rpc = (name: string, args: Record<string, unknown>) =>
      world.service.rpc(name as never, args as never)
    const args = (holder: string) => ({
      p_name: "media_archive_audit",
      p_holder: holder,
      p_ttl: "180 seconds",
    })
    expect((await rpc("acquire_maintenance_lease", args("a"))).data).toBe(true)
    expect((await rpc("acquire_maintenance_lease", args("b"))).data).toBe(false)
    await world.clock.advance(170_000)
    expect((await rpc("acquire_maintenance_lease", args("a"))).data).toBe(true)
    await world.clock.advance(170_000)
    expect((await rpc("acquire_maintenance_lease", args("b"))).data).toBe(false)
    await world.clock.advance(11_000)
    expect((await rpc("acquire_maintenance_lease", args("b"))).data).toBe(true)
    await rpc("release_maintenance_lease", {
      p_name: "media_archive_audit",
      p_holder: "a",
    })
    expect(world.db.leases.get("media_archive_audit")?.holder).toBe("b")
    await rpc("release_maintenance_lease", {
      p_name: "media_archive_audit",
      p_holder: "b",
    })
    expect(world.db.leases.size).toBe(0)
  })

  it("keeps receipts append-only and upserts idempotently", async () => {
    const world = createWorld()
    const [assetId] = [world.addAsset()]
    const { manifestSize, ...receipt } = world.receiptFor(assetId)
    void manifestSize
    const table = () => world.service.from("media_archive_receipts" as never)
    const insert = (row: unknown) =>
      (
        table() as never as {
          upsert: (row: unknown, options: unknown) => PromiseLike<unknown>
        }
      ).upsert(row, { ignoreDuplicates: true })
    await insert(receipt)
    await insert(receipt)
    expect(world.db.rows("media_archive_receipts")).toHaveLength(1)
    expect(world.db.rows("media_archive_receipts")[0].id).toBe(1)
    const update = await (
      table() as never as {
        update: (patch: unknown) => {
          eq: (
            column: string,
            value: unknown
          ) => PromiseLike<{ error?: { code?: string } }>
        }
      }
    )
      .update({ size_bytes: 5 })
      .eq("asset_id", assetId)
    expect(update.error?.code).toBe("42501")
  })

  it("projects selected columns, orders, limits and supports gt cursors", async () => {
    const world = createWorld()
    world.seedReceipts(5)
    const result = await world.service
      .from("media_archive_receipts")
      .select("id,blob_key")
      .gt("id", 1)
      .order("id", { ascending: true })
      .limit(2)
    expect(result.data).toEqual([
      expect.objectContaining({ id: 2 }),
      expect.objectContaining({ id: 3 }),
    ])
    expect(Object.keys(result.data![0]).sort()).toEqual(["blob_key", "id"])
  })

  it("injects errors, crashes and hooks, and logs only applied writes", async () => {
    const world = createWorld()
    world.db.inject({
      match: (op) => op.kind === "update",
      error: { code: "57014", message: "boom" },
      times: 1,
    })
    const patch = () =>
      world.service
        .from("media_archive_audit_state")
        .update({ cursor_id: 9 } as never)
        .eq("name", "originals")
    expect((await patch()).error?.message).toBe("boom")
    expect(world.state().cursor_id).toBe(0)
    expect(world.db.writeLog).toHaveLength(0)
    expect((await patch()).error).toBeNull()
    expect(world.state().cursor_id).toBe(9)
    expect(world.db.writeLog).toHaveLength(1)
    world.db.inject({ match: () => true, crash: new Error("process killed") })
    await expect(patch()).rejects.toThrow("process killed")
  })

  it("derives the missing count and backfill candidates from ready, unarchived assets", async () => {
    const world = createWorld()
    world.seedReceipts(2)
    world.addAsset()
    world.addAsset({ ready: false })
    expect((await world.service.rpc("media_archive_missing_count")).data).toBe(
      1
    )
    const candidates = await world.service.rpc(
      "media_archive_backfill_candidates",
      {
        p_limit: 10,
      }
    )
    expect(candidates.data).toHaveLength(1)
    await world.archiveAsset(
      (candidates.data as { asset_id: string }[])[0].asset_id
    )
    expect(world.missing()).toBe(0)
    expect(world.db.rows("media_archive_receipts")).toHaveLength(3)
  })

  it("backfill of an asset whose source original is gone fails and stays missing", async () => {
    const world = createWorld()
    const id = world.addAsset({ sourceExists: false })
    await expect(world.archiveAsset(id)).rejects.toThrow(
      "archive_source_read_failed"
    )
    expect(world.missing()).toBe(1)
  })
})

describe("flush", () => {
  it("lets chained promise continuations run", async () => {
    let value = 0
    void Promise.resolve()
      .then(() => value++)
      .then(() => value++)
    await flush()
    expect(value).toBe(2)
  })
})
