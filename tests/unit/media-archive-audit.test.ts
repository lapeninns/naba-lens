import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  verifyOriginal: vi.fn(),
  verifyManifest: vi.fn(),
  close: vi.fn(),
}))
vi.mock("@/lib/server/archive/config", () => ({
  readArchiveConfig: () => ({ sourceProjectRef: "fixture" }),
}))
vi.mock("@/lib/server/archive/index", () => ({
  ensureMediaOriginalArchived: mocks.archive,
}))
vi.mock("@/lib/server/archive/object-store", () => ({
  createArchiveStore: () => ({
    verifyOriginal: mocks.verifyOriginal,
    verifyManifest: mocks.verifyManifest,
    close: mocks.close,
  }),
}))

import { archiveStatus, runArchiveAudit } from "@/lib/server/archive/audit"
import type { Database } from "@/lib/db/types"
import type { SupabaseClient } from "@supabase/supabase-js"

type State = {
  cursor_id: number
  last_complete_at: string | null
  last_run_at: string | null
  last_error: string | null
}
function serviceFixture(
  options: {
    state?: Partial<State>
    missing?: number
    receipts?: number[]
    candidates?: string[]
    onRead?: () => Promise<void>
  } = {}
) {
  const state: State = {
    cursor_id: 0,
    last_complete_at: null,
    last_run_at: null,
    last_error: null,
    ...options.state,
  }
  const updates: Partial<State>[] = []
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === "acquire_maintenance_lease"
        ? true
        : name === "media_archive_missing_count"
          ? (options.missing ?? 0)
          : name === "media_archive_backfill_candidates"
            ? (options.candidates ?? []).map((asset_id) => ({ asset_id }))
            : null,
  }))
  const client = {
    rpc,
    from(table: string) {
      let patch: Partial<State> | null = null
      const query = {
        select() {
          return query
        },
        eq() {
          return query
        },
        gt() {
          return query
        },
        order() {
          return query
        },
        limit() {
          return query
        },
        update(value: Partial<State>) {
          patch = value
          return query
        },
        async single() {
          await options.onRead?.()
          return { data: state, error: null }
        },
        then(resolve: (value: unknown) => unknown) {
          if (patch) {
            updates.push(patch)
            Object.assign(state, patch)
          }
          const data =
            table === "media_archive_receipts"
              ? (options.receipts ?? []).map((id) => ({
                  id,
                  blob_key: `blob-${id}`,
                  sha256: "hash",
                  size_bytes: 4,
                  manifest_key: `manifest-${id}`,
                  manifest_sha256: "manifest-hash",
                  manifest: { id },
                }))
              : null
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    },
  }
  return {
    client: client as unknown as SupabaseClient<Database>,
    state,
    updates,
    rpc,
  }
}
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe("durable archive audit", () => {
  it("checks both bytes and immutable attribution before completing a cycle", async () => {
    const f = serviceFixture({ receipts: [1, 2] })
    const report = await runArchiveAudit(f.client)
    expect(report).toMatchObject({ complete: true, checked: 2, missing: 0 })
    expect(mocks.verifyOriginal).toHaveBeenCalledTimes(2)
    expect(mocks.verifyManifest).toHaveBeenCalledTimes(2)
    expect(f.state.cursor_id).toBe(0)
    expect(f.state.last_complete_at).not.toBeNull()
    expect(f.rpc).toHaveBeenLastCalledWith(
      "release_maintenance_lease",
      expect.any(Object)
    )
  })
  it("retains a resumable cursor for a multi-invocation cycle and does not claim completion", async () => {
    const f = serviceFixture({
      receipts: Array.from({ length: 51 }, (_, index) => index + 1),
    })
    const report = await runArchiveAudit(f.client)
    expect(report).toMatchObject({ complete: false, checked: 50 })
    expect(f.state.cursor_id).toBe(50)
    expect(f.state.last_complete_at).toBeNull()
  })
  it("checkpoints only successfully verified entries and records a failed audit", async () => {
    const f = serviceFixture({ receipts: [1, 2] })
    mocks.verifyOriginal
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private details"))
    await expect(runArchiveAudit(f.client)).rejects.toThrow(
      "archive_audit_failed"
    )
    expect(f.state.cursor_id).toBe(1)
    expect(f.state.last_complete_at).toBeNull()
    expect(f.state.last_error).toBe("archive_audit_failed")
    expect(mocks.close).toHaveBeenCalledOnce()
  })
  it("backfills earlier ready originals before claiming full coverage", async () => {
    const f = serviceFixture({ candidates: ["legacy-original"], missing: 1 })
    const report = await runArchiveAudit(f.client)
    expect(mocks.archive).toHaveBeenCalledWith(
      f.client,
      "legacy-original",
      undefined,
      expect.any(AbortSignal)
    )
    expect(report).toMatchObject({ copied: 1, complete: false, missing: 1 })
    expect(f.state.last_complete_at).toBeNull()
  })
})

describe("independent archive freshness status", () => {
  const now = Date.parse("2026-10-30T12:00:00Z")
  it("fails for no completed audit, stale/future timestamps, missing copies or last failure", async () => {
    for (const options of [
      {},
      { state: { last_complete_at: "2026-10-28T00:00:00Z" } },
      { state: { last_complete_at: "2026-11-01T00:00:00Z" } },
      { state: { last_complete_at: "2026-10-30T11:00:00Z" }, missing: 1 },
      {
        state: {
          last_complete_at: "2026-10-30T11:00:00Z",
          last_error: "archive_audit_failed",
        },
      },
    ]) {
      expect(
        (await archiveStatus(serviceFixture(options).client, now)).ok
      ).toBe(false)
    }
  })
  it("reports progress separately while a recent complete verified cycle is still current", async () => {
    const f = serviceFixture({
      state: { last_complete_at: "2026-10-30T11:00:00Z", cursor_id: 50 },
    })
    expect(await archiveStatus(f.client, now)).toMatchObject({
      ok: true,
      inProgress: true,
      status: "current",
    })
  })
  it("samples freshness after awaited reads while preserving an explicitly injected now", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(now)
    const f = serviceFixture({
      state: { last_complete_at: new Date(now + 1000).toISOString() },
      onRead: async () => {
        vi.setSystemTime(now + 2000)
      },
    })
    // The cycle completed after request start but before the query returned.
    expect(await archiveStatus(f.client)).toMatchObject({
      ok: true,
      status: "current",
    })
    // Explicit clock injection keeps its existing fixed-instant semantics.
    expect(await archiveStatus(f.client, now)).toMatchObject({
      ok: false,
      status: "stale",
    })
  })
  it("rejects a cycle that becomes stale during a slow status read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(now)
    const f = serviceFixture({
      state: {
        last_complete_at: new Date(
          now - 26 * 60 * 60 * 1000 + 1000
        ).toISOString(),
      },
      onRead: async () => {
        vi.setSystemTime(now + 2000)
      },
    })
    expect(await archiveStatus(f.client)).toMatchObject({
      ok: false,
      status: "stale",
    })
    expect(await archiveStatus(f.client, now)).toMatchObject({
      ok: true,
      status: "current",
    })
  })
})
