import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/db/types"
import type { ArchiveStore } from "@/lib/server/archive/core"
import type { ArchiveLeaseClient } from "@/lib/server/archive/audit"

/** Deterministic clock shared by the fake database (lease expiry) and the audit. */
export function createFakeClock(start = Date.parse("2026-10-30T12:00:00Z")) {
  const clock = {
    t: start,
    now: () => clock.t,
    advance(ms: number) {
      clock.t += ms
    },
  }
  return clock
}
export type FakeClock = ReturnType<typeof createFakeClock>

type Row = Record<string, unknown>

export type FakeState = {
  name: "originals"
  cursor_id: number
  cycle_id: string | null
  cycle_started_at: string | null
  cycle_target_id: number | null
  cycle_target_count: number | null
  cycle_checked: number
  last_run_at: string | null
  last_run_outcome: string | null
  last_complete_at: string | null
  last_complete_cycle_started_at: string | null
  last_cycle_duration_seconds: number | null
  last_error: string | null
  consecutive_failures: number
}

export type FakeArchiveService = {
  clock: FakeClock
  state: FakeState
  receipts: Row[]
  runs: Row[]
  missingAssets: string[]
  lease: { holder: string | null; expiresAt: number }
  calls: string[]
  before: ((key: string) => Promise<void> | void) | undefined
  fail(key: string, message?: string, times?: number): void
  addReceipt(id: number): void
  archive(service: unknown, assetId: string): Promise<void>
  leaseClient: ArchiveLeaseClient
  client: SupabaseClient<Database>
}

export type FakeServiceOptions = {
  clock?: FakeClock
  state?: Partial<FakeState>
  /** Receipt ids that exist (gaps allowed). */
  receipts?: number[]
  /** Ready assets without a receipt: drive `missing` and the backfill list. */
  missingAssets?: string[]
}

/**
 * In-memory stand-in for the service-role client, covering exactly the calls the
 * audit and status make. Inject faults with `fail("state.update")` (next call
 * returns a database error; `times` repeats) and interleave other actors with
 * `before` (called with a key such as `rpc.acquire_maintenance_lease` or
 * `receipts.select` before the call runs).
 */
export function createFakeArchiveService(
  options: FakeServiceOptions = {}
): FakeArchiveService {
  const clock = options.clock ?? createFakeClock()
  const state: FakeState = {
    name: "originals",
    cursor_id: 0,
    cycle_id: null,
    cycle_started_at: null,
    cycle_target_id: null,
    cycle_target_count: null,
    cycle_checked: 0,
    last_run_at: null,
    last_run_outcome: null,
    last_complete_at: null,
    last_complete_cycle_started_at: null,
    last_cycle_duration_seconds: null,
    last_error: null,
    consecutive_failures: 0,
    ...options.state,
  }
  const receipts = (options.receipts ?? []).map(fakeReceipt)
  const runs: Row[] = []
  const missingAssets = [...(options.missingAssets ?? [])]
  const tables: Record<string, Row[]> = {
    media_archive_audit_state: [state],
    media_archive_receipts: receipts,
    media_archive_audit_runs: runs,
  }
  const lease: { holder: string | null; expiresAt: number } = {
    holder: null,
    expiresAt: 0,
  }
  const calls: string[] = []
  const failures = new Map<string, { message: string; times: number }>()
  const fake: FakeArchiveService = {
    clock,
    state,
    receipts,
    runs,
    missingAssets,
    lease,
    calls,
    before: undefined,
    fail(key: string, message = "injected_database_failure", times = 1) {
      failures.set(key, { message, times })
    },
    addReceipt(id: number) {
      receipts.push(fakeReceipt(id))
    },
    /** Default backfill: archives the asset, which creates a receipt. */
    archive: async (_service, assetId) => {
      const index = missingAssets.indexOf(assetId)
      if (index < 0) throw new Error("archive_asset_unavailable")
      missingAssets.splice(index, 1)
      fake.addReceipt(Math.max(0, ...receipts.map((r) => r.id as number)) + 1)
    },
    leaseClient: {
      async acquire(holder, ttlSeconds) {
        return acquire(holder, ttlSeconds)
      },
      async release(holder) {
        if (lease.holder === holder) lease.holder = null
      },
    },
    client: undefined as unknown as SupabaseClient<Database>,
  }

  function acquire(holder: string, ttlSeconds: number) {
    if (
      lease.holder !== null &&
      lease.holder !== holder &&
      lease.expiresAt > clock.now()
    )
      return false
    lease.holder = holder
    lease.expiresAt = clock.now() + ttlSeconds * 1000
    return true
  }

  async function guard(key: string) {
    calls.push(key)
    await fake.before?.(key)
    const failure = failures.get(key)
    if (!failure) return null
    if (--failure.times <= 0) failures.delete(key)
    return { message: failure.message }
  }

  function builder(table: string) {
    let mode: "select" | "update" | "delete" | "insert" | null = null
    let patch: Row = {}
    let inserted: Row = {}
    let returning = false
    let count = false
    let head = false
    let descending = false
    let limit = Infinity
    const filters: Array<(row: Row) => boolean> = []
    const compare = (
      column: string,
      test: (a: never, b: never) => boolean,
      value: unknown
    ) => filters.push((row) => test(row[column] as never, value as never))
    const q = {
      select(_columns?: string, opts?: { count?: string; head?: boolean }) {
        if (mode) returning = true
        else {
          mode = "select"
          count = Boolean(opts?.count)
          head = Boolean(opts?.head)
        }
        return q
      },
      update(value: Row) {
        mode = "update"
        patch = value
        return q
      },
      insert(value: Row) {
        mode = "insert"
        inserted = value
        return q
      },
      delete() {
        mode = "delete"
        return q
      },
      eq: (column: string, value: unknown) => (
        compare(column, (a, b) => a === b, value),
        q
      ),
      is: (column: string, value: unknown) => (
        compare(column, (a, b) => a === b, value),
        q
      ),
      gt: (column: string, value: unknown) => (
        compare(column, (a, b) => a > b, value),
        q
      ),
      lt: (column: string, value: unknown) => (
        compare(column, (a, b) => a < b, value),
        q
      ),
      lte: (column: string, value: unknown) => (
        compare(column, (a, b) => a <= b, value),
        q
      ),
      order(_column: string, opts?: { ascending?: boolean }) {
        descending = opts?.ascending === false
        return q
      },
      limit(value: number) {
        limit = value
        return q
      },
      async single() {
        const result = await execute()
        const first = Array.isArray(result.data) ? result.data[0] : null
        return first && !result.error
          ? { data: first, error: null }
          : { data: null, error: result.error ?? { message: "not_found" } }
      },
      then(
        resolve: (value: unknown) => unknown,
        reject?: (error: unknown) => unknown
      ) {
        return execute().then(resolve, reject)
      },
    }
    async function execute() {
      const error = await guard(`${table}.${mode ?? "select"}`)
      if (error) return { data: null, error, count: null }
      const rows = tables[table]
      if (mode === "insert") {
        if (
          table === "media_archive_audit_runs" &&
          runs.some((r) => r.run_id === inserted.run_id)
        )
          return {
            data: null,
            error: { message: "duplicate_run_id" },
            count: null,
          }
        rows.push({ id: rows.length + 1, ...inserted })
        return { data: null, error: null, count: null }
      }
      const matched = rows.filter((row) => filters.every((test) => test(row)))
      if (mode === "update") {
        for (const row of matched) Object.assign(row, patch)
        return {
          data: returning ? matched.map((r) => ({ ...r })) : null,
          error: null,
          count: null,
        }
      }
      if (mode === "delete") {
        for (const row of matched) rows.splice(rows.indexOf(row), 1)
        return { data: null, error: null, count: null }
      }
      const sorted = [...matched].sort((a, b) =>
        descending
          ? (b.id as number) - (a.id as number)
          : (a.id as number) - (b.id as number)
      )
      return {
        data: head ? null : sorted.slice(0, limit).map((r) => ({ ...r })),
        error: null,
        count: count ? matched.length : null,
      }
    }
    return q
  }

  fake.client = {
    from: (table: string) => builder(table),
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const error = await guard(`rpc.${name}`)
      if (error) return { data: null, error }
      if (name === "acquire_maintenance_lease")
        return {
          data: acquire(
            args.p_holder as string,
            Number.parseInt(String(args.p_ttl), 10)
          ),
          error: null,
        }
      if (name === "release_maintenance_lease") {
        await fake.leaseClient.release(args.p_holder as string)
        return { data: null, error: null }
      }
      if (name === "media_archive_missing_count")
        return { data: missingAssets.length, error: null }
      if (name === "media_archive_backfill_candidates")
        return {
          data: missingAssets
            .slice(0, args.p_limit as number)
            .map((asset_id) => ({ asset_id })),
          error: null,
        }
      return { data: null, error: { message: "unknown_rpc" } }
    },
  } as unknown as SupabaseClient<Database>
  return fake
}

function fakeReceipt(id: number): Row {
  return {
    id,
    asset_id: `asset-${id}`,
    blob_key: `blob-${id}`,
    sha256: "hash",
    size_bytes: 4,
    manifest_key: `manifest-${id}`,
    manifest_sha256: "manifest-hash",
    manifest: { id },
  }
}

export type FakeStoreOptions = {
  /** Called before every verify; await a never-settling promise to hang. */
  onVerify?: (
    kind: "original" | "manifest",
    key: string
  ) => Promise<void> | void
}

/**
 * In-process `ArchiveStore`. Keys in `corrupt` fail verification as the real
 * store does; keys in `unavailable` throw `archive_store_unavailable`; keys in
 * `hang` never settle and ignore every signal.
 */
export type FakeArchiveStore = ArchiveStore & {
  corrupt: Set<string>
  unavailable: Set<string>
  hang: Set<string>
  verified: string[]
  active: number
  maxActive: number
  closed: number
  verify(kind: "original" | "manifest", key: string): Promise<void>
}

export function createFakeArchiveStore(
  options: FakeStoreOptions = {}
): FakeArchiveStore {
  const store: FakeArchiveStore = {
    corrupt: new Set<string>(),
    unavailable: new Set<string>(),
    hang: new Set<string>(),
    verified: [] as string[],
    active: 0,
    maxActive: 0,
    closed: 0,
    async verify(kind: "original" | "manifest", key: string) {
      store.maxActive = Math.max(store.maxActive, ++store.active)
      try {
        await options.onVerify?.(kind, key)
        if (store.hang.has(key)) await new Promise<void>(() => undefined)
        if (store.unavailable.has(key))
          throw new Error("archive_store_unavailable")
        if (store.corrupt.has(key))
          throw new Error("archive_destination_verification_failed")
        store.verified.push(key)
      } finally {
        store.active--
      }
    },
    putOriginalIfAbsent: async () => undefined,
    putManifestIfAbsent: async () => undefined,
    verifyOriginal: (key: string) => store.verify("original", key),
    verifyManifest: (key: string) => store.verify("manifest", key),
    close() {
      store.closed++
    },
  }
  return store
}
