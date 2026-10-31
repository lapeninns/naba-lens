// The verification loop in the three shapes the report compares, written
// against the fake store and state so they can be timed. `sequential`
// reproduces lib/server/archive/audit.ts at ff829e9 (one receipt at a time, one
// checkpoint each). `barrier` is Audit's v0 shape (batches of N verified with
// c workers, one checkpoint per batch). `pipelined` is the recommended shape.
import type { ArchiveStore } from "../../../lib/server/archive/core"
import type { FakeReceipt, FakeState } from "./fake"

export type LoopMode = "sequential" | "barrier" | "pipelined"

export type LoopOptions = {
  mode: LoopMode
  concurrency: number
  batchSize: number
  /** Stop starting new work after this many ms (the soft budget). */
  softMs: number
  /** Stop after this many receipts in total. */
  receiptCap?: number
}

export type LoopResult = {
  verified: number
  bytes: number
  ms: number
  cursor: number
}

async function verifyReceipt(store: ArchiveStore, r: FakeReceipt) {
  await store.verifyOriginal(r.blob_key, r.sha256, r.size_bytes)
  await store.verifyManifest(r.manifest_key, r.manifest_sha256, r.manifestBytes)
}

export async function runLoop(
  store: ArchiveStore,
  state: FakeState,
  options: LoopOptions
): Promise<LoopResult> {
  const start = performance.now()
  const stop = () => performance.now() - start >= options.softMs
  const cap = options.receiptCap ?? Infinity
  const pageSize = Math.max(options.batchSize, Math.min(cap, 5_000) + 1, 51)
  let verified = 0
  let bytes = 0
  let cursor = state.cursor
  await state.renewLease()

  if (options.mode === "sequential") {
    const page = await state.page(cursor, pageSize)
    for (const r of page.slice(0, Math.min(50, cap))) {
      await verifyReceipt(store, r)
      await state.checkpoint(r.id)
      cursor = r.id
      verified++
      bytes += r.size_bytes
    }
    return { verified, bytes, ms: performance.now() - start, cursor }
  }

  if (options.mode === "barrier") {
    while (!stop() && verified < cap) {
      await state.renewLease()
      const page = (await state.page(cursor, options.batchSize)).slice(
        0,
        Math.min(options.batchSize, cap - verified)
      )
      if (page.length === 0) break
      let next = 0
      await Promise.all(
        Array.from({ length: options.concurrency }, async () => {
          while (next < page.length) {
            const r = page[next++]
            await verifyReceipt(store, r)
            bytes += r.size_bytes
          }
        })
      )
      cursor = page[page.length - 1].id
      await state.checkpoint(cursor)
      verified += page.length
    }
    return { verified, bytes, ms: performance.now() - start, cursor }
  }

  // pipelined: a shared queue, a contiguous watermark, background checkpoints.
  let queue: FakeReceipt[] = []
  let queueIndex = 0
  let fetched = cursor
  let exhausted = false
  let fetching: Promise<void> | null = null
  const done = new Set<number>()
  let watermarkIndex = 0
  const order: number[] = []
  let checkpointed = cursor
  let checkpointing: Promise<void> = Promise.resolve()
  let sinceCheckpoint = 0

  const refill = async () => {
    const page = await state.page(fetched, pageSize)
    if (page.length === 0) exhausted = true
    else fetched = page[page.length - 1].id
    queue = queue.slice(queueIndex).concat(page)
    queueIndex = 0
  }
  const take = async (): Promise<FakeReceipt | null> => {
    while (queueIndex >= queue.length) {
      if (exhausted) return null
      fetching ??= refill().finally(() => (fetching = null))
      await fetching
    }
    order.push(queue[queueIndex].id)
    return queue[queueIndex++]
  }
  const advance = () => {
    while (watermarkIndex < order.length && done.has(order[watermarkIndex]))
      watermarkIndex++
    const mark = watermarkIndex === 0 ? checkpointed : order[watermarkIndex - 1]
    if (mark > checkpointed && sinceCheckpoint >= options.batchSize) {
      sinceCheckpoint = 0
      checkpointed = mark
      checkpointing = checkpointing.then(async () => {
        await state.renewLease()
        await state.checkpoint(mark)
      })
    }
  }
  let started = 0
  await Promise.all(
    Array.from({ length: options.concurrency }, async () => {
      for (;;) {
        if (stop() || started >= cap) return
        started++
        const r = await take()
        if (!r) return
        await verifyReceipt(store, r)
        done.add(r.id)
        verified++
        bytes += r.size_bytes
        sinceCheckpoint++
        advance()
      }
    })
  )
  sinceCheckpoint = Infinity
  advance()
  await checkpointing
  cursor = checkpointed
  return { verified, bytes, ms: performance.now() - start, cursor }
}
