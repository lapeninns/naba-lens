// B05-05 capture journal, capability probe and device clean-up (b05-design
// §5.9 unit list). The journal runs over the in-memory backend; the probe
// over a minimal fake IndexedDB (fake-indexeddb is not a dependency).
import { describe, expect, it, vi } from "vitest"

import { detectCaptureCapabilities } from "@/lib/upload/capabilities"
import {
  claimCaptureDataForAccount,
  clearCaptureDataOnDevice,
} from "@/lib/upload/device-cleanup"
import {
  JOURNAL_ACCOUNT_STORAGE_KEY,
  JOURNAL_DB_NAME,
  JOURNAL_LIMITS,
  memoryJournalBackend,
  openCaptureJournal,
  resumeAction,
  type JournalBackend,
  type JournalEntry,
  type PickInput,
} from "@/lib/upload/journal"
import { UPLOAD_KEYS_STORAGE_KEY } from "@/lib/upload/upload-keys"

const MiB = 1024 * 1024
const roomy = { storeBytes: true, quotaBytes: 10_000 * MiB, usageBytes: 0 }

let seq = 0
function photo(size: number, name = `p${++seq}.jpg`) {
  return new File([new Uint8Array(size)], name, { type: "image/jpeg" })
}
function pickOf(file: File, over: Partial<PickInput> = {}): PickInput {
  return {
    purpose: "general",
    subject: { kind: "none", id: null },
    groupKey: null,
    uploadKey: `key-${file.name}`,
    fileFingerprint: `fp-${file.name}`,
    file,
    mediaType: file.type.startsWith("video") ? "video" : "image",
    ...over,
  }
}

async function journal(
  opts: {
    backend?: JournalBackend
    account?: string
    caps?: typeof roomy
    clock?: { t: number }
  } = {}
) {
  const clock = opts.clock ?? { t: 1_000_000 }
  const backend = opts.backend ?? memoryJournalBackend()
  const j = await openCaptureJournal({
    backend,
    accountHash: opts.account ?? "acct-a",
    capabilities: opts.caps ?? roomy,
    now: () => clock.t,
  })
  return { j, backend, clock }
}

describe("capture journal limits", () => {
  it("keeps photo bytes within the limits and never video bytes", async () => {
    const { j } = await journal()
    const p = await j.pick(pickOf(photo(1 * MiB)))
    expect(p?.bytes?.size).toBe(MiB)
    expect(resumeAction(p!)).toEqual({ kind: "continue" })
    const v = await j.pick(
      pickOf(new File([new Uint8Array(10)], "v.mp4", { type: "video/mp4" }))
    )
    expect(v?.bytes).toBeUndefined()
    expect(resumeAction(v!)).toEqual({ kind: "reselect" })
    const big = await j.pick(pickOf(photo(21 * MiB)))
    expect(big?.bytes).toBeUndefined()
  })

  it("keeps bytes only with twice the size free, and never when the probe refused", async () => {
    const tight = await journal({
      caps: { storeBytes: true, quotaBytes: 30 * MiB, usageBytes: 25 * MiB },
    })
    expect((await tight.j.pick(pickOf(photo(3 * MiB))))?.bytes).toBeUndefined()
    const refused = await journal({
      caps: { storeBytes: false, quotaBytes: 10_000 * MiB, usageBytes: 0 },
    })
    expect((await refused.j.pick(pickOf(photo(MiB))))?.bytes).toBeUndefined()
  })

  it("holds at most 10 files and 100 MiB of bytes", async () => {
    const { j } = await journal()
    const kept: (JournalEntry | null)[] = []
    for (let i = 0; i < 6; i++) kept.push(await j.pick(pickOf(photo(19 * MiB))))
    expect(kept.slice(0, 5).every((e) => e?.bytes)).toBe(true)
    expect(kept[5]?.bytes).toBeUndefined()
    const small = await journal()
    const many: (JournalEntry | null)[] = []
    for (let i = 0; i < 11; i++)
      many.push(await small.j.pick(pickOf(photo(1000))))
    expect(many.filter((e) => e?.bytes)).toHaveLength(10)
  })

  it("drops bytes but keeps metadata when a write is refused", async () => {
    const base = memoryJournalBackend()
    const backend: JournalBackend = {
      ...base,
      put: async (e) => {
        if (e.bytes) throw new Error("QuotaExceededError")
        return base.put(e)
      },
    }
    const { j } = await journal({ backend })
    const e = await j.pick(pickOf(photo(MiB)))
    expect(e).toMatchObject({ state: "needs_reselection" })
    expect(e?.bytes).toBeUndefined()
    expect(resumeAction(e!)).toEqual({ kind: "reselect" })
  })

  it("evicts the oldest metadata beyond 50 entries", async () => {
    const clock = { t: 1_000_000 }
    const { j } = await journal({
      clock,
      caps: {
        storeBytes: false,
        quotaBytes: null as unknown as number,
        usageBytes: null as unknown as number,
      },
    })
    const first = await j.pick(pickOf(photo(10, "first.jpg")))
    for (let i = 0; i < JOURNAL_LIMITS.maxEntries; i++) {
      clock.t += 1
      await j.pick(pickOf(photo(10)))
    }
    const left = await j.unfinished()
    expect(left).toHaveLength(JOURNAL_LIMITS.maxEntries)
    expect(left.some((e) => e.id === first?.id)).toBe(false)
  })
})

describe("capture journal lifecycle", () => {
  it("expires entries 20 h after the last activity", async () => {
    const { j, clock, backend } = await journal()
    await j.pick(pickOf(photo(10)))
    clock.t += JOURNAL_LIMITS.expiryMs - 1
    expect(await j.unfinished()).toHaveLength(1)
    clock.t += 2
    expect(await j.unfinished()).toHaveLength(0)
    // Reopening deletes expired entries from the store.
    await openCaptureJournal({
      backend,
      accountHash: "acct-a",
      capabilities: roomy,
      now: () => clock.t,
    })
    expect((backend as ReturnType<typeof memoryJournalBackend>).size()).toBe(0)
  })

  it("isolates accounts and purges another account's entries before showing anything", async () => {
    const backend = memoryJournalBackend()
    const a = await journal({ backend, account: "acct-a" })
    await a.j.pick(pickOf(photo(10)))
    const b = await journal({ backend, account: "acct-b" })
    expect(await b.j.unfinished()).toEqual([])
    expect(backend.size()).toBe(0)
  })

  it("keeps labels typed before reservation across a re-pick, and the same entry", async () => {
    const { j } = await journal()
    const file = photo(10, "dish.jpg")
    const first = await j.pick(
      pickOf(file, { pendingLabels: { types: ["dish"] } })
    )
    await j.update(first!.id, { state: "reserved", assetId: "asset-1" })
    const again = await j.pick(pickOf(file))
    expect(again).toMatchObject({
      id: first!.id,
      assetId: "asset-1",
      state: "reserved",
      pendingLabels: { types: ["dish"] },
    })
    expect(await j.unfinished()).toHaveLength(1)
  })

  it("throttles progress to one write per 2 s and flushes on demand", async () => {
    const base = memoryJournalBackend()
    const put = vi.fn(base.put)
    const { j, clock } = await journal({ backend: { ...base, put } })
    const e = await j.pick(pickOf(photo(10)))
    put.mockClear()
    await j.progress(e!.id, 100)
    clock.t += 500
    await j.progress(e!.id, 200)
    clock.t += 500
    await j.progress(e!.id, 300)
    expect(put).toHaveBeenCalledTimes(1)
    await j.flush()
    expect(put).toHaveBeenCalledTimes(2)
    expect((await j.unfinished())[0]).toMatchObject({
      state: "transferring",
      transferredBytes: 300,
    })
  })

  it("keeps a permanent failure code on the device and forgets finished entries", async () => {
    const { j } = await journal()
    const e = await j.pick(pickOf(photo(10)))
    await j.fail(e!.id, "unsupported_type", true)
    expect(resumeAction((await j.unfinished())[0]!)).toEqual({
      kind: "choose_different",
      code: "unsupported_type",
    })
    await j.done(e!.id)
    expect(await j.unfinished()).toEqual([])
  })
})

/** A minimal IndexedDB: enough for the probe's Blob round trip. */
function fakeIdb(opts: { failOpen?: boolean; corrupt?: boolean } = {}) {
  const data = new Map<string, unknown>()
  const deleted: string[] = []
  const later = (fn: () => void) => queueMicrotask(fn)
  const factory = {
    open() {
      const req: Record<string, unknown> & {
        result?: unknown
        error?: unknown
      } = {}
      later(() => {
        if (opts.failOpen) {
          req.error = new Error("blocked")
          ;(req.onerror as () => void)?.()
          return
        }
        const db = {
          createObjectStore() {},
          close() {},
          transaction() {
            const tx: Record<string, unknown> = {}
            const store = {
              put(v: unknown, k: string) {
                data.set(k, opts.corrupt ? "not a blob" : v)
                later(() => (tx.oncomplete as () => void)?.())
              },
              get(k: string) {
                const r: Record<string, unknown> = {}
                later(() => {
                  r.result = data.get(k)
                  ;(r.onsuccess as () => void)?.()
                })
                return r
              },
            }
            tx.objectStore = () => store
            return tx
          },
        }
        req.result = db
        ;(req.onupgradeneeded as () => void)?.()
        ;(req.onsuccess as () => void)?.()
      })
      return req
    },
    deleteDatabase(name: string) {
      deleted.push(name)
    },
  }
  return { factory: factory as unknown as IDBFactory, deleted }
}

const storage = (quota: number, persisted: boolean) => ({
  estimate: async () => ({ quota, usage: 0 }),
  persisted: async () => persisted,
})

describe("detectCaptureCapabilities", () => {
  it("reports missing IndexedDB, a refused write, zero quota and private mode", async () => {
    expect(
      await detectCaptureCapabilities({ storage: storage(1e10, true) })
    ).toMatchObject({ storeBytes: false, reason: "no_indexeddb" })
    expect(
      await detectCaptureCapabilities({
        indexedDB: fakeIdb({ failOpen: true }).factory,
        storage: storage(1e10, true),
      })
    ).toMatchObject({ storeBytes: false, reason: "write_refused" })
    expect(
      await detectCaptureCapabilities({
        indexedDB: fakeIdb({ corrupt: true }).factory,
      })
    ).toMatchObject({ reason: "write_refused" })
    expect(
      await detectCaptureCapabilities({
        indexedDB: fakeIdb().factory,
        storage: storage(0, false),
      })
    ).toMatchObject({ storeBytes: false, reason: "quota_zero" })
    expect(
      await detectCaptureCapabilities({
        indexedDB: fakeIdb().factory,
        storage: storage(100 * MiB, false),
      })
    ).toMatchObject({ storeBytes: false, reason: "private_mode" })
  })

  it("allows bytes after a round trip with room, and never offers background upload", async () => {
    const idb = fakeIdb()
    const caps = await detectCaptureCapabilities({
      indexedDB: idb.factory,
      storage: storage(10_000 * MiB, true),
    })
    expect(caps).toMatchObject({
      indexedDb: true,
      storeBytes: true,
      reason: null,
      backgroundSync: "unsupported",
      backgroundFetch: "unsupported",
    })
    expect(idb.deleted).toContain("nabalens-capture-probe")
  })
})

describe("device clean-up (J-1)", () => {
  function memStorage(init: Record<string, string> = {}) {
    const m = new Map(Object.entries(init))
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      map: m,
    }
  }

  it("sign-out removes the upload resume keys, the journal database and the account marker", () => {
    const s = memStorage({
      [UPLOAD_KEYS_STORAGE_KEY]: "{}",
      [JOURNAL_ACCOUNT_STORAGE_KEY]: "acct-a",
      other: "kept",
    })
    const deleted: string[] = []
    clearCaptureDataOnDevice({
      storage: s,
      indexedDB: {
        deleteDatabase: (n: string) => (
          deleted.push(n),
          {} as IDBOpenDBRequest
        ),
      },
    })
    expect([...s.map.keys()]).toEqual(["other"])
    expect(deleted).toEqual([JOURNAL_DB_NAME])
  })

  it("a different account clears everything first; the same account keeps it", () => {
    const s = memStorage({ [UPLOAD_KEYS_STORAGE_KEY]: "{}" })
    const deleted: string[] = []
    const env = {
      storage: s,
      indexedDB: {
        deleteDatabase: (n: string) => (
          deleted.push(n),
          {} as IDBOpenDBRequest
        ),
      },
    }
    expect(claimCaptureDataForAccount("acct-a", env)).toBe(false)
    expect(s.map.has(UPLOAD_KEYS_STORAGE_KEY)).toBe(true)
    expect(claimCaptureDataForAccount("acct-a", env)).toBe(false)
    expect(claimCaptureDataForAccount("acct-b", env)).toBe(true)
    expect(s.map.has(UPLOAD_KEYS_STORAGE_KEY)).toBe(false)
    expect(deleted).toEqual([JOURNAL_DB_NAME])
    expect(s.map.get(JOURNAL_ACCOUNT_STORAGE_KEY)).toBe("acct-b")
  })

  it("is wired into the signed-out login page", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync("app/login/login-card-host.tsx", "utf8")
    expect(src).toMatch(/clearCaptureDataOnDevice\(\)/)
    expect(src).toMatch(/clearAllDrafts\(\)/)
  })
})
