// B05-05 capture journal, capability probe and device clean-up (b05-design
// §5.9 unit list). The journal runs over the in-memory backend; the probe
// over a minimal fake IndexedDB (and fake-indexeddb for the real backend).
import { IDBFactory } from "fake-indexeddb"
import { describe, expect, it, vi } from "vitest"

import { detectCaptureCapabilities } from "@/lib/upload/capabilities"
import {
  claimCaptureDataForAccount,
  clearCaptureDataOnDevice,
  TUS_RESUME_KEY_PREFIX,
} from "@/lib/upload/device-cleanup"
import {
  JOURNAL_ACCOUNT_STORAGE_KEY,
  JOURNAL_DB_NAME,
  indexedDbJournalBackend,
  JOURNAL_LIMITS,
  memoryJournalBackend,
  openCaptureJournal,
  resumeAction,
  type JournalBackend,
  type JournalEntry,
  type PickInput,
} from "@/lib/upload/journal"
import { tusFingerprint } from "@/lib/upload/tus"
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
    const again = await j.pick(pickOf(file))
    expect(again).toMatchObject({
      id: first!.id,
      state: "picked",
      pendingLabels: { types: ["dish"] },
    })
    // Reserved, they stay until the server took them (L1)...
    await j.update(first!.id, { state: "reserved", assetId: "asset-1" })
    const reserved = await j.pick(pickOf(file))
    expect(reserved).toMatchObject({
      id: first!.id,
      assetId: "asset-1",
      pendingLabels: { types: ["dish"] },
    })
    // ...and go when the label store says so.
    await j.update(first!.id, { pendingLabels: undefined })
    expect(await j.pick(pickOf(file))).not.toHaveProperty("pendingLabels")
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
function fakeIdb(
  opts: { failOpen?: boolean; corrupt?: boolean; refuseBlob?: boolean } = {}
) {
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
                // WebKit private windows: the Blob's transaction errors, with
                // a null error (J1).
                if (opts.refuseBlob && v instanceof Blob) {
                  tx.error = null
                  later(() => (tx.onerror as () => void)?.())
                  return
                }
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

  it("keeps the journal but no bytes where a Blob write is refused (J1)", async () => {
    const idb = fakeIdb({ refuseBlob: true })
    expect(
      await detectCaptureCapabilities({
        indexedDB: idb.factory,
        storage: storage(1000 * MiB, false),
      })
    ).toMatchObject({
      indexedDb: true,
      storeBytes: false,
      reason: "blob_refused",
    })
    expect(idb.deleted).toContain("nabalens-capture-probe")
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

describe("device clean-up (J-1, review C1 and C2)", () => {
  function memStorage(init: Record<string, string> = {}) {
    const m = new Map(Object.entries(init))
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() {
        return m.size
      },
      map: m,
    }
  }

  it("sign-out removes our keys, every tus-js-client resume entry, the marker and the journal", async () => {
    const idb = new IDBFactory()
    const backend = indexedDbJournalBackend(idb)
    await backend.put(entryFor("acct-a"))
    const s = memStorage({
      [UPLOAD_KEYS_STORAGE_KEY]: "{}",
      [JOURNAL_ACCOUNT_STORAGE_KEY]: "acct-a",
      [`tus::nabalens-media:${crypto.randomUUID()}::1`]:
        "https://storage.test/upload/a",
      [`tus::nabalens-media:${crypto.randomUUID()}::2`]:
        "https://storage.test/upload/b",
      "tus::someone-else::1": "kept",
      other: "kept",
    })
    // The backend's open connection closes on versionchange, so the delete is not blocked.
    expect(await clearCaptureDataOnDevice({ storage: s, indexedDB: idb })).toBe(
      "deleted"
    )
    expect([...s.map.keys()].sort()).toEqual(["other", "tus::someone-else::1"])
    expect((await idb.databases()).map((d) => d.name)).not.toContain(
      JOURNAL_DB_NAME
    )
    // The backend reopens an empty journal afterwards.
    expect(await backend.getAll()).toEqual([])
  })

  it("reports a delete blocked by a connection that does not close", async () => {
    const idb = new IDBFactory()
    const stubborn = await new Promise<IDBDatabase>((resolve) => {
      const req = idb.open(JOURNAL_DB_NAME, 1)
      req.onupgradeneeded = () =>
        req.result.createObjectStore("entries", { keyPath: "id" })
      req.onsuccess = () => resolve(req.result)
    })
    stubborn.onversionchange = () => {}
    expect(
      await clearCaptureDataOnDevice({ storage: memStorage(), indexedDB: idb })
    ).toBe("blocked")
    stubborn.close()
  })

  it("a different account clears everything first; the same account keeps it", () => {
    const s = memStorage({ [UPLOAD_KEYS_STORAGE_KEY]: "{}" })
    const env = { storage: s, indexedDB: new IDBFactory() }
    expect(claimCaptureDataForAccount("acct-a", env)).toBe(false)
    expect(s.map.has(UPLOAD_KEYS_STORAGE_KEY)).toBe(true)
    expect(claimCaptureDataForAccount("acct-a", env)).toBe(false)
    expect(claimCaptureDataForAccount("acct-b", env)).toBe(true)
    expect(s.map.has(UPLOAD_KEYS_STORAGE_KEY)).toBe(false)
    expect(s.map.get(JOURNAL_ACCOUNT_STORAGE_KEY)).toBe("acct-b")
  })

  // The signed-out login page's wiring is tested by behaviour in
  // tests/ui/amenities-capture-signout.test.tsx (J-1).

  it("matches the fingerprint lib/upload/tus.ts gives tus-js-client", () => {
    expect(
      `tus::${tusFingerprint("x")}::`.startsWith(TUS_RESUME_KEY_PREFIX)
    ).toBe(true)
  })
})

function entryFor(
  account: string,
  over: Partial<JournalEntry> = {}
): JournalEntry {
  const t = Date.now()
  return {
    id: crypto.randomUUID(),
    accountHash: account,
    createdAt: t,
    touchedAt: t,
    expiresAt: t + JOURNAL_LIMITS.expiryMs,
    purpose: "general",
    subject: { kind: "none", id: null },
    groupKey: null,
    uploadKey: `key-${crypto.randomUUID()}`,
    fileFingerprint: "fp",
    displayName: "dish.jpg",
    mediaType: "image",
    sizeBytes: 3,
    state: "picked",
    ...over,
  } as JournalEntry
}

describe("IndexedDB journal backend (fake-indexeddb, review C2)", () => {
  it("stores, lists, deletes and clears entries in nabalens-capture-journal", async () => {
    const idb = new IDBFactory()
    const backend = indexedDbJournalBackend(idb)
    const a = entryFor("acct-a")
    const b = entryFor("acct-a", {
      state: "reserved",
      assetId: "asset-1",
      pendingLabels: { types: ["dish"] },
    })
    await backend.put(a)
    await backend.put(b)
    expect((await backend.getAll()).map((e) => e.id).sort()).toEqual(
      [a.id, b.id].sort()
    )
    await backend.delete(a.id)
    expect(await backend.getAll()).toEqual([b])
    await backend.clear()
    expect(await backend.getAll()).toEqual([])
    expect((await idb.databases()).map((d) => d.name)).toContain(
      JOURNAL_DB_NAME
    )
  })

  it("runs the journal end to end and purges another account on open", async () => {
    const idb = new IDBFactory()
    const backend = indexedDbJournalBackend(idb)
    const a = await openCaptureJournal({
      backend,
      accountHash: "acct-a",
      capabilities: { storeBytes: false, quotaBytes: null, usageBytes: null },
    })
    const e = await a.pick(pickOf(photo(10, "kept.jpg")))
    expect(e?.state).toBe("needs_reselection")
    expect(await a.unfinished()).toHaveLength(1)
    const b = await openCaptureJournal({
      backend,
      accountHash: "acct-b",
      capabilities: { storeBytes: false, quotaBytes: null, usageBytes: null },
    })
    expect(await b.unfinished()).toEqual([])
    expect(await backend.getAll()).toEqual([])
  })
})

describe("review L1 to L3", () => {
  it("L1: a photo refused only by the 10-file cap reads needs_reselection", async () => {
    const { j } = await journal()
    const many: (JournalEntry | null)[] = []
    for (let i = 0; i < 11; i++) many.push(await j.pick(pickOf(photo(1000))))
    expect(many[10]).toMatchObject({ state: "needs_reselection" })
    expect(many[10]?.bytes).toBeUndefined()
    const v = await j.pick(
      pickOf(new File([new Uint8Array(10)], "v.mp4", { type: "video/mp4" }))
    )
    expect(v?.state).toBe("picked")
  })

  it("L2: bytes stored since the probe count against the free space", async () => {
    // 50 MiB free at the probe: a 20 MiB photo fits twice over, the next does not once the first is stored.
    const { j } = await journal({
      caps: { storeBytes: true, quotaBytes: 50 * MiB, usageBytes: 0 },
    })
    expect((await j.pick(pickOf(photo(20 * MiB))))?.bytes).toBeDefined()
    expect((await j.pick(pickOf(photo(10 * MiB))))?.bytes).toBeDefined()
    expect((await j.pick(pickOf(photo(15 * MiB))))?.bytes).toBeUndefined()
  })

  it("L3: an IndexedDB open that never answers times out as write_refused", async () => {
    const silent = {
      open: () => ({}),
      deleteDatabase: () => ({}),
    } as unknown as IDBFactory
    const started = Date.now()
    const caps = await detectCaptureCapabilities({
      indexedDB: silent,
      timeoutMs: 50,
      storage: storage(1e10, true),
    })
    expect(caps).toMatchObject({ storeBytes: false, reason: "write_refused" })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("probes a real (fake-indexeddb) database end to end", async () => {
    const caps = await detectCaptureCapabilities({
      indexedDB: new IDBFactory(),
      storage: storage(10_000 * MiB, true),
    })
    expect(caps).toMatchObject({
      indexedDb: true,
      storeBytes: true,
      reason: null,
    })
  })
})
