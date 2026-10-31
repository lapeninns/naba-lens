// In-process stand-ins for R2 and the audit tables. No network, no database.
// Reads cost real SHA-256 work on a repeating synthetic pattern, and wait for
// configurable latency and bandwidth, so per-receipt overhead is measured on the
// same code path shape as lib/server/archive/object-store.ts `verify`.
import { createHash } from "node:crypto"

import type { ArchiveStore } from "../../../lib/server/archive/core"

// A zero wait must not become a 1 ms timer, or it would hide software overhead.
export const sleep = (ms: number) =>
  ms <= 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, ms))

export type FakeNetwork = {
  /** GetObject time to first byte, ms. */
  ttfbMs: number
  /** One stream, MB/s. Infinity disables pacing. */
  streamMBps: number
  /** All streams together, MB/s. Infinity disables pacing. */
  capMBps: number
}

const CHUNK = 256 * 1024
const pattern = Buffer.alloc(CHUNK, 0xa5)

/** SHA-256 of `size` bytes of the repeating pattern; memoised because each distinct size costs one full hash. */
const expected = new Map<number, string>()
export function patternSha(size: number): string {
  const hit = expected.get(size)
  if (hit) return hit
  const hash = createHash("sha256")
  for (let left = size; left > 0; left -= CHUNK)
    hash.update(pattern.subarray(0, Math.min(CHUNK, left)))
  const digest = hash.digest("hex")
  expected.set(size, digest)
  return digest
}

export type FakeStoreStats = {
  gets: number
  bytes: number
  hashedMs: number
}

export type FakeStore = ArchiveStore & { stats: FakeStoreStats }

/**
 * An ArchiveStore whose objects all hold the synthetic pattern. `verify*` reads
 * the whole object like the real store does, so a receipt costs one blob GET and
 * one manifest GET.
 */
export function createFakeStore(net: FakeNetwork): FakeStore {
  const stats: FakeStoreStats = { gets: 0, bytes: 0, hashedMs: 0 }
  let pipeFree = 0
  async function read(size: number, expectedHash: string) {
    stats.gets++
    await sleep(net.ttfbMs)
    const hash = createHash("sha256")
    let streamFree = performance.now()
    for (let left = size; left > 0; left -= CHUNK) {
      const length = Math.min(CHUNK, left)
      const now = performance.now()
      streamFree =
        Math.max(now, streamFree) + (length / (net.streamMBps * 1e6)) * 1000
      pipeFree = Math.max(now, pipeFree) + (length / (net.capMBps * 1e6)) * 1000
      const until = Math.max(streamFree, pipeFree)
      const hashStart = performance.now()
      hash.update(pattern.subarray(0, length))
      stats.hashedMs += performance.now() - hashStart
      if (Number.isFinite(until) && until > performance.now())
        await sleep(until - performance.now())
      else await Promise.resolve()
    }
    stats.bytes += size
    if (hash.digest("hex") !== expectedHash)
      throw new Error("archive_destination_verification_failed")
  }
  return {
    stats,
    async putOriginalIfAbsent() {},
    async putManifestIfAbsent() {},
    verifyOriginal: (_key, sha, size) => read(size, sha),
    verifyManifest: (_key, sha, size) => read(size, sha),
  }
}

export type FakeReceipt = {
  id: number
  blob_key: string
  sha256: string
  size_bytes: number
  manifest_key: string
  manifest_sha256: string
  manifestBytes: number
}

/** Receipts whose manifests are 700 bytes, close to a real manifest's JSON. */
export function makeReceipts(sizes: number[]): FakeReceipt[] {
  const manifestBytes = 700
  return sizes.map((size, i) => ({
    id: i + 1,
    blob_key: `blob/${i + 1}`,
    sha256: patternSha(size),
    size_bytes: size,
    manifest_key: `manifest/${i + 1}`,
    manifest_sha256: patternSha(manifestBytes),
    manifestBytes,
  }))
}

export type FakeStateStats = {
  pageReads: number
  checkpoints: number
  leaseRenewals: number
  dbMs: number
}

/** The audit's database calls with injectable latency: page read, checkpoint, lease renewal. */
export function createFakeState(receipts: FakeReceipt[], dbCallMs: number) {
  const stats: FakeStateStats = {
    pageReads: 0,
    checkpoints: 0,
    leaseRenewals: 0,
    dbMs: 0,
  }
  let cursor = 0
  const call = async () => {
    const start = performance.now()
    await sleep(dbCallMs)
    stats.dbMs += performance.now() - start
  }
  return {
    stats,
    get cursor() {
      return cursor
    },
    async page(after: number, limit: number): Promise<FakeReceipt[]> {
      stats.pageReads++
      await call()
      return receipts.filter((r) => r.id > after).slice(0, limit)
    },
    async checkpoint(to: number) {
      stats.checkpoints++
      await call()
      if (to > cursor) cursor = to
    },
    async renewLease() {
      stats.leaseRenewals++
      await call()
      return true
    },
  }
}

export type FakeState = ReturnType<typeof createFakeState>
