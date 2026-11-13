// B05-05c wiring (contracts/b05-05-journal-wiring-scope.md): the library
// fixes (OD-B5-05-3, OD-B5-05-5), the page's capture session (OD-B5-05-1:
// claim before keys, storage-event invalidation, flush on pagehide) and the
// upload adapter's journal writes (OD-B5-05-4, 6, 7), over the memory
// backend with Node Files.
import { describe, expect, it, vi } from "vitest"

import { detectCaptureCapabilities } from "@/lib/upload/capabilities"
import { clearCaptureDataOnDevice } from "@/lib/upload/device-cleanup"
import {
  annotateCapture,
  captureEntryId,
  createCaptureSessions,
  forgetCapture,
  type CaptureSession,
} from "@/lib/upload/capture-session"
import {
  accountHash,
  JOURNAL_ACCOUNT_STORAGE_KEY,
  JOURNAL_LIMITS,
  JOURNAL_READ_WAIT_MS,
  JOURNAL_STUCK_MS,
  JOURNAL_UNTRUSTED_STORAGE_KEY,
  type JournalBackend,
  memoryJournalBackend,
  openCaptureJournal,
  type JournalEntry,
} from "@/lib/upload/journal"
import {
  JOURNAL_DEADLINE_MS,
  JOURNAL_OPEN_DEADLINE_MS,
  toQueueUploader,
} from "@/lib/upload/queue-adapter"
import type {
  UploadContext,
  UploadFn,
  UploadOptions,
  UploadResult,
} from "@/lib/upload/types"
import type { UploadKeyStore } from "@/lib/upload/upload-keys"

const MiB = 1024 * 1024
const roomy = {
  indexedDb: false,
  persisted: true,
  quotaBytes: 10_000 * MiB,
  usageBytes: 0,
  storeBytes: true,
  reason: null,
  backgroundSync: "unsupported",
  backgroundFetch: "unsupported",
} as const

let n = 0
const photo = (size = 1000, name = `p${++n}.jpg`) =>
  new File([new Uint8Array(size)], name, { type: "image/jpeg" })

function memStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

function sessions(over: { storage?: ReturnType<typeof memStorage> } = {}) {
  const backend = memoryJournalBackend()
  const storage = over.storage ?? memStorage()
  const target = new EventTarget()
  const doc = { visibilityState: "visible" as DocumentVisibilityState }
  const s = createCaptureSessions({
    probe: async () => roomy,
    backend: () => backend,
    cleanup: () => ({ storage }),
    events: () => target as unknown as Window,
    document: () => doc,
  })
  return { s, backend, storage, target, doc }
}

function context(over: Partial<UploadContext> = {}): UploadContext {
  return {
    signal: new AbortController().signal,
    onProgress: () => {},
    onProcessing: () => {},
    resumeToken: undefined,
    setResumeToken: () => {},
    attempt: 1,
    account: "user-1",
    ...over,
  }
}

function memKeys(onGet?: () => void): UploadKeyStore {
  const keys = new Map<File, string>()
  return {
    async get(file) {
      onGet?.()
      return keys.get(file) ?? null
    },
    async set(file, key) {
      keys.set(file, key)
    },
    async delete(file) {
      keys.delete(file)
    },
  }
}

/** An UploadFn that walks the given steps, then returns `result`. */
function fakeUpload(
  result: Omit<UploadResult, "assetId"> & { assetId?: string | null },
  seen: (
    stage: string,
    entries: JournalEntry[]
  ) => Promise<void> = async () => {}
): UploadFn {
  return async (file, options: UploadOptions) => {
    options.onReserved?.({ assetId: "asset-1", resumable: true })
    await seen("reserved", [])
    options.onProgress?.(0.5)
    await seen("progress", [])
    options.onStateChange?.("processing")
    await seen("processing", [])
    return { assetId: result.assetId ?? "asset-1", ...result } as UploadResult
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("library fixes", () => {
  it("OD-3: no storage estimate keeps no bytes, with a reason", async () => {
    const { IDBFactory } = await import("fake-indexeddb")
    expect(
      await detectCaptureCapabilities({ indexedDB: new IDBFactory() })
    ).toMatchObject({
      indexedDb: true,
      storeBytes: false,
      reason: "no_estimate",
    })
  })

  it("OD-5: progress never regresses failed, finalising or needs_reselection", async () => {
    const clock = { t: 1_000_000 }
    const j = await openCaptureJournal({
      backend: memoryJournalBackend(),
      accountHash: "a",
      capabilities: roomy,
      now: () => clock.t,
    })
    const pick = (file: File, over = {}) =>
      j.pick({
        purpose: "general",
        subject: { kind: "none", id: null },
        groupKey: null,
        uploadKey: `k-${file.name}`,
        fileFingerprint: file.name,
        file,
        mediaType: "image",
        ...over,
      })
    const failed = (await pick(photo()))!
    await j.fail(failed.id, "processing_failed", true)
    const finalising = (await pick(photo()))!
    await j.update(finalising.id, { state: "finalising" })
    const reselect = (await pick(photo(), { mediaType: "video" }))!
    await j.update(reselect.id, { state: "needs_reselection" })
    const moving = (await pick(photo()))!
    for (const e of [failed, finalising, reselect, moving]) {
      clock.t += JOURNAL_LIMITS.progressThrottleMs + 1
      await j.progress(e.id, 400)
    }
    // A late tick through flush too.
    for (const e of [failed, finalising]) await j.progress(e.id, 600)
    await j.flush()
    const states = Object.fromEntries(
      (await j.unfinished()).map((e) => [e.id, [e.state, e.transferredBytes]])
    )
    expect(states[failed.id]![0]).toBe("failed")
    expect(states[finalising.id]![0]).toBe("finalising")
    expect(states[reselect.id]![0]).toBe("needs_reselection")
    expect(states[moving.id]).toEqual(["transferring", 400])
    expect(states[failed.id]![1]).toBe(600)
  })

  it("OD-5: a re-pick with the same key keeps its failure", async () => {
    const j = await openCaptureJournal({
      backend: memoryJournalBackend(),
      accountHash: "a",
      capabilities: roomy,
    })
    const file = photo()
    const input = {
      purpose: "general" as const,
      subject: { kind: "none" as const, id: null },
      groupKey: null,
      uploadKey: "same",
      fileFingerprint: "fp",
      file,
      mediaType: "image" as const,
    }
    const first = (await j.pick(input))!
    await j.fail(first.id, "processing_failed", true)
    const again = (await j.pick(input))!
    expect(again.id).toBe(first.id)
    expect(again.failure).toEqual({
      code: "processing_failed",
      permanent: true,
    })
  })

  it("keeps photo bytes up to 20 MiB exactly, not one byte more", async () => {
    const j = await openCaptureJournal({
      backend: memoryJournalBackend(),
      accountHash: "a",
      capabilities: roomy,
    })
    const pick = (file: File) =>
      j.pick({
        purpose: "general",
        subject: { kind: "none", id: null },
        groupKey: null,
        uploadKey: file.name,
        fileFingerprint: file.name,
        file,
        mediaType: "image",
      })
    const at = (await pick(photo(JOURNAL_LIMITS.maxPhotoBytes)))!
    const over = (await pick(photo(JOURNAL_LIMITS.maxPhotoBytes + 1)))!
    expect(at.bytes?.size).toBe(JOURNAL_LIMITS.maxPhotoBytes)
    expect(at.state).toBe("picked")
    expect(over.bytes).toBeUndefined()
    expect(over.state).toBe("needs_reselection")
  })
})

describe("the capture session (OD-B5-05-1)", () => {
  it("is one journal per account; another account drops the old one", async () => {
    const { s } = sessions()
    const a = await s.get("user-a")
    expect(await s.get("user-a")).toBe(a)
    const b = await s.get("user-b")
    expect(b).not.toBe(a)
    expect(a!.alive()).toBe(false)
    expect(b!.alive()).toBe(true)
  })

  it("claims the device before the adapter reads any upload key", async () => {
    const { s, storage } = sessions()
    const hash = await accountHash("user-1")
    let markerAtFirstGet: string | null | undefined
    const keys = memKeys(() => {
      markerAtFirstGet ??= storage.getItem(JOURNAL_ACCOUNT_STORAGE_KEY)
    })
    const upload = toQueueUploader(fakeUpload({ state: "ready" }), {
      keys,
      capture: s.get,
    })
    await upload(photo(), context())
    expect(markerAtFirstGet).toBe(hash)
  })

  it("stops writing when another tab signs out (storage event)", async () => {
    const { s, target, backend } = sessions()
    const session = (await s.get("user-1"))!
    const hash = await accountHash("user-1")
    // Another account's marker in another tab: still keyed, but not ours.
    target.dispatchEvent(
      Object.assign(new Event("storage"), {
        key: JOURNAL_ACCOUNT_STORAGE_KEY,
        newValue: hash,
      })
    )
    expect(session.alive()).toBe(true)
    target.dispatchEvent(
      Object.assign(new Event("storage"), {
        key: JOURNAL_ACCOUNT_STORAGE_KEY,
        newValue: null,
      })
    )
    expect(session.alive()).toBe(false)
    expect(
      await session.journal.pick({
        purpose: "general",
        subject: { kind: "none", id: null },
        groupKey: null,
        uploadKey: "k",
        fileFingerprint: "f",
        file: photo(),
        mediaType: "image",
      })
    ).toBeNull()
    expect(await backend.getAll()).toEqual([])
    // The next ask opens a fresh one.
    expect((await s.get("user-1"))!.alive()).toBe(true)
  })

  it("writes throttled progress on pagehide and when the page is hidden", async () => {
    const { s, target, doc, backend } = sessions()
    const session = (await s.get("user-1"))!
    const entry = (await session.journal.pick({
      purpose: "general",
      subject: { kind: "none", id: null },
      groupKey: null,
      uploadKey: "k",
      fileFingerprint: "f",
      file: photo(),
      mediaType: "image",
    }))!
    await session.journal.progress(entry.id, 100)
    await session.journal.progress(entry.id, 300)
    target.dispatchEvent(new Event("pagehide"))
    await flush()
    expect((await backend.getAll())[0]!.transferredBytes).toBe(300)
    await session.journal.progress(entry.id, 700)
    target.dispatchEvent(new Event("visibilitychange"))
    await flush()
    expect((await backend.getAll())[0]!.transferredBytes).toBe(300)
    doc.visibilityState = "hidden"
    target.dispatchEvent(new Event("visibilitychange"))
    await flush()
    expect((await backend.getAll())[0]!.transferredBytes).toBe(700)
  })
})

describe("the adapter's journal writes (OD-B5-05-4, 6, 7)", () => {
  async function run(
    result: Omit<UploadResult, "assetId">,
    file = photo(1000)
  ) {
    const { s, backend } = sessions()
    const states: string[] = []
    const seen = async () => {
      await flush()
      const [e] = await backend.getAll()
      states.push(
        e ? `${e.state}:${e.assetId ?? ""}:${e.transferredBytes ?? ""}` : "gone"
      )
    }
    const upload = toQueueUploader(fakeUpload(result, seen), {
      keys: memKeys(),
      capture: s.get,
    })
    const outcome = await upload(file, context()).then(
      () => "ok",
      () => "threw"
    )
    await flush()
    return { states, backend, outcome, file, session: await s.get("user-1") }
  }

  it("pick, reserve, progress in bytes, finalising, then done", async () => {
    const { states, backend, outcome } = await run({ state: "ready" })
    expect(outcome).toBe("ok")
    expect(states).toEqual([
      "reserved:asset-1:",
      "transferring:asset-1:500",
      "finalising:asset-1:500",
    ])
    expect(await backend.getAll()).toEqual([])
  })

  it("a permanent failure is kept with its code", async () => {
    const { backend, outcome } = await run({
      state: "failed",
      error: { code: "processing_failed", message: "x", retryable: false },
    })
    expect(outcome).toBe("threw")
    expect(await backend.getAll()).toMatchObject([
      {
        state: "failed",
        failure: { code: "processing_failed", permanent: true },
      },
    ])
  })

  it("finalise_refused is permanent; a retryable failure is not", async () => {
    const refused = await run({
      state: "failed",
      error: { code: "finalise_refused", message: "x", retryable: false },
    })
    expect(await refused.backend.getAll()).toMatchObject([
      { failure: { code: "finalise_refused", permanent: true } },
    ])
    const flaky = await run({
      state: "failed",
      error: { code: "transfer_failed", message: "x", retryable: true },
    })
    expect(await flaky.backend.getAll()).toMatchObject([
      {
        state: "failed",
        failure: { code: "transfer_failed", permanent: false },
      },
    ])
  })

  it("reservation_gone ends the entry (the retry makes a new one)", async () => {
    const { backend } = await run({
      state: "failed",
      error: { code: "reservation_gone", message: "x", retryable: true },
    })
    expect(await backend.getAll()).toEqual([])
  })

  it("aborted (cancel) keeps the entry as it was", async () => {
    const { backend } = await run({
      state: "failed",
      error: { code: "aborted", message: "x", retryable: true },
    })
    expect(await backend.getAll()).toMatchObject([{ state: "finalising" }])
  })

  it("records what the screen knew before the pick, and after", async () => {
    const { s, backend } = sessions()
    let firstPut: JournalEntry | undefined
    const put = backend.put
    backend.put = async (e) => {
      firstPut ??= e
      return put(e)
    }
    const file = photo()
    annotateCapture(file, {
      subject: { kind: "menu_item", id: "item-1" },
      pendingLabels: { venueId: "v1", input: { note: "x" } },
    })
    let entry: JournalEntry | undefined
    const upload = toQueueUploader(
      fakeUpload(
        {
          state: "failed",
          error: { code: "transfer_failed", message: "x", retryable: true },
        },
        async (stage) => {
          if (stage !== "reserved") return
          await flush()
          // The set got its key while the file was on its way.
          annotateCapture(file, { groupKey: "set-key" })
          await flush()
          entry = (await backend.getAll())[0]
        }
      ),
      { keys: memKeys(), capture: s.get }
    )
    await upload(file, context()).catch(() => {})
    expect(entry).toMatchObject({
      subject: { kind: "menu_item", id: "item-1" },
      groupKey: "set-key",
      bytes: file,
    })
    // Picked with the labels, and kept until the label store says the server
    // took them (L1).
    expect(firstPut?.pendingLabels).toEqual({
      venueId: "v1",
      input: { note: "x" },
    })
    expect(entry).toMatchObject({
      pendingLabels: { venueId: "v1", input: { note: "x" } },
    })
    expect(captureEntryId(file)).toBe(entry!.id)
    // Removing the row ends it.
    forgetCapture(file)
    await flush()
    expect(await backend.getAll()).toEqual([])
    expect(captureEntryId(file)).toBeNull()
  })

  it("writes nothing without an account", async () => {
    const { s, backend } = sessions()
    const upload = toQueueUploader(fakeUpload({ state: "ready" }), {
      keys: memKeys(),
      capture: s.get,
    })
    await upload(photo(), context({ account: undefined }))
    expect(await backend.getAll()).toEqual([])
  })
})

describe("blob_refused (J1: WebKit private windows)", () => {
  it("keeps the journal in IndexedDB, entries with no bytes field at all", async () => {
    const { IDBFactory } = await import("fake-indexeddb")
    const { indexedDbJournalBackend } = await import("@/lib/upload/journal")
    const idb = new IDBFactory()
    const storage = memStorage()
    const s = createCaptureSessions({
      probe: async () => ({
        ...roomy,
        indexedDb: true,
        storeBytes: false,
        reason: "blob_refused",
      }),
      indexedDB: () => idb,
      cleanup: () => ({ storage }),
      events: () => null,
    })
    const session = (await s.get("user-1"))!
    expect(session.capabilities.reason).toBe("blob_refused")
    const entry = (await session.journal.pick({
      purpose: "general",
      subject: { kind: "none", id: null },
      groupKey: null,
      uploadKey: "k",
      fileFingerprint: "f",
      file: photo(1000, "kept.jpg"),
      mediaType: "image",
    }))!
    expect(entry.state).toBe("needs_reselection")
    await session.journal.update(entry.id, { state: "reserved", assetId: "a1" })
    // Read back through another connection: it is in IndexedDB, not memory.
    const [stored] = await indexedDbJournalBackend(idb).getAll()
    expect(stored).toMatchObject({
      displayName: "kept.jpg",
      assetId: "a1",
      state: "reserved",
    })
    expect("bytes" in stored!).toBe(false)
  })
})

describe("privacy (§5.8)", () => {
  it("never logs journal content from the files that handle it", async () => {
    const { readFileSync } = await import("node:fs")
    for (const path of [
      "lib/upload/journal.ts",
      "lib/upload/capture-session.ts",
      "lib/upload/queue-adapter.ts",
      "lib/upload/capabilities.ts",
      "lib/upload/device-cleanup.ts",
      "components/nabalens/shell/capture-resume.tsx",
      "app/staff/_shell/add-host.tsx",
    ])
      expect(readFileSync(path, "utf8"), path).not.toMatch(/\bconsole\./)
  })
})

describe("review repairs (K1, K4, K6, K7, K9 to K12)", () => {
  const input = (file: File, key = file.name) => ({
    purpose: "general" as const,
    subject: { kind: "none" as const, id: null },
    groupKey: null,
    uploadKey: key,
    fileFingerprint: key,
    file,
    mediaType: "image" as const,
  })

  it("K1: a sign-out in another tab during the first open is not missed", async () => {
    const storage = memStorage()
    const target = new EventTarget()
    const backend = memoryJournalBackend()
    const s = createCaptureSessions({
      probe: async () => {
        // Another tab signs out while this one probes (only the event is
        // seen here: this tab's marker read still says the account).
        target.dispatchEvent(
          Object.assign(new Event("storage"), {
            key: JOURNAL_ACCOUNT_STORAGE_KEY,
            newValue: null,
          })
        )
        return roomy
      },
      backend: () => backend,
      cleanup: () => ({ storage }),
      events: () => target as unknown as Window,
      document: () => ({ visibilityState: "visible" }),
    })
    expect(await s.get("user-1")).toBeNull()
    expect(await backend.getAll()).toEqual([])
  })

  it("K1: another account's marker written during the open (no event) is caught after it", async () => {
    const storage = memStorage()
    const s = createCaptureSessions({
      probe: async () => {
        storage.setItem(JOURNAL_ACCOUNT_STORAGE_KEY, "someone-else")
        return roomy
      },
      backend: () => memoryJournalBackend(),
      cleanup: () => ({ storage }),
      events: () => null,
    })
    expect(await s.get("user-1")).toBeNull()
  })

  it("K6: once the marker is gone, no write reaches the backend", async () => {
    const { s, storage, backend } = sessions()
    const session = (await s.get("user-1"))!
    const put = vi.spyOn(backend, "put")
    storage.removeItem(JOURNAL_ACCOUNT_STORAGE_KEY)
    expect(session.alive()).toBe(false)
    expect(await session.journal.pick(input(photo()))).toBeNull()
    expect(put).not.toHaveBeenCalled()
  })

  it("K4: a journal that never answers never holds up an upload", async () => {
    vi.useFakeTimers()
    try {
      const stalled = toQueueUploader(fakeUpload({ state: "ready" }), {
        keys: memKeys(),
        capture: () => new Promise(() => {}),
      })
      const done = stalled(photo(), context())
      // The open has its own budget, above the probe's timeout (L2c).
      await vi.advanceTimersByTimeAsync(JOURNAL_OPEN_DEADLINE_MS + 10)
      await expect(done).resolves.toMatchObject({ assetId: "asset-1" })

      // A journal that opens but whose pick stalls.
      const { s } = sessions()
      const session = (await s.get("user-1"))!
      const hung: CaptureSession = {
        ...session,
        journal: { ...session.journal, pick: () => new Promise(() => {}) },
      }
      const slow = toQueueUploader(fakeUpload({ state: "ready" }), {
        keys: memKeys(),
        capture: async () => hung,
      })
      const second = slow(photo(), context())
      await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS + 10)
      await expect(second).resolves.toMatchObject({ assetId: "asset-1" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("K7: the journal is the page's first account's only", async () => {
    const { s, backend } = sessions()
    const upload = toQueueUploader(
      fakeUpload({
        state: "failed",
        error: { code: "transfer_failed", message: "x", retryable: true },
      }),
      { keys: memKeys(), capture: s.get }
    )
    await upload(photo(), context({ account: "user-1" })).catch(() => {})
    await upload(photo(), context({ account: "user-2" })).catch(() => {})
    await flush()
    expect(await backend.getAll()).toHaveLength(1)
  })

  it("K9 and K12: a reserve clears a failure; permanent fail and finalising drop the bytes", async () => {
    const j = await openCaptureJournal({
      backend: memoryJournalBackend(),
      accountHash: "a",
      capabilities: roomy,
    })
    const a = (await j.pick(input(photo())))!
    expect(a.bytes).toBeDefined()
    await j.fail(a.id, "processing_failed", true)
    let [stored] = await j.unfinished()
    expect(stored).not.toHaveProperty("bytes")
    await j.update(a.id, { state: "reserved", assetId: "x" })
    ;[stored] = await j.unfinished()
    expect(stored).not.toHaveProperty("failure")
    const b = (await j.pick(input(photo())))!
    await j.update(b.id, { state: "finalising" })
    expect(
      (await j.unfinished()).find((e) => e.id === b.id)
    ).not.toHaveProperty("bytes")
  })

  it("K10: a row removed before its entry existed has the entry removed when it does", async () => {
    const { s, backend } = sessions()
    const file = photo()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const keys = memKeys()
    const slowKeys: UploadKeyStore = {
      ...keys,
      set: async (f, k, sc) => {
        await gate
        return keys.set(f, k, sc)
      },
    }
    const upload = toQueueUploader(
      fakeUpload({
        state: "failed",
        error: { code: "aborted", message: "x", retryable: true },
      }),
      { keys: slowKeys, capture: s.get }
    )
    const run = upload(file, context()).catch(() => {})
    await flush()
    forgetCapture(file)
    release()
    await run
    await flush()
    expect(await backend.getAll()).toEqual([])
  })

  it("K11: changes fired together don't overwrite each other", async () => {
    const j = await openCaptureJournal({
      backend: memoryJournalBackend(),
      accountHash: "a",
      capabilities: roomy,
    })
    const e = (await j.pick(input(photo())))!
    void j.update(e.id, { groupKey: "g" })
    void j.progress(e.id, 300)
    void j.update(e.id, { assetId: "asset-1" })
    const [stored] = await j.unfinished()
    expect(stored).toMatchObject({
      groupKey: "g",
      transferredBytes: 300,
      assetId: "asset-1",
      state: "transferring",
    })
  })
})

describe("late and hung journal operations (L2)", () => {
  // Timers are faked; crypto digests and the like still need real turns.
  const fake = () =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const turn = () => new Promise((r) => setImmediate(r))
  async function tick(ms: number) {
    for (let t = 0; t < ms; t += 100) {
      for (let i = 0; i < 3; i++) await turn()
      await vi.advanceTimersByTimeAsync(100)
    }
    for (let i = 0; i < 3; i++) await turn()
  }
  // Advances fake time until `done`, bounded. A slow runner can finish the
  // real turns (digests) after a fixed tick has passed, which schedules the
  // backend's delay later in fake time than the test assumed.
  async function tickUntil(done: () => Promise<boolean>, maxMs = 15_000) {
    for (let t = 0; t < maxMs && !(await done()); t += 100) await tick(100)
  }

  const delayedPick = (
    session: CaptureSession,
    ms: number
  ): CaptureSession => ({
    ...session,
    journal: {
      ...session.journal,
      pick: (input) =>
        new Promise((resolve) =>
          setTimeout(() => resolve(session.journal.pick(input)), ms)
        ),
    },
  })

  /** An upload that reserves, sends half, then waits for `release`. */
  function gatedUpload(result: Omit<UploadResult, "assetId">) {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fn: UploadFn = async (_file, options) => {
      options.onReserved?.({ assetId: "asset-1", resumable: true })
      options.onProgress?.(0.5)
      await gate
      return { assetId: "asset-1", ...result } as UploadResult
    }
    return { fn, release: () => release() }
  }

  it("a late pick binds, catches up, and the upload's end then removes it", async () => {
    fake()
    try {
      const { s, backend } = sessions()
      const session = (await s.get("user-1"))!
      const up = gatedUpload({ state: "ready" })
      const upload = toQueueUploader(up.fn, {
        keys: memKeys(),
        capture: async () => delayedPick(session, JOURNAL_DEADLINE_MS + 1000),
      })
      const run = upload(photo(1000), context())
      await tick(JOURNAL_DEADLINE_MS + 1500)
      // Still running: the entry is there, caught up with the upload.
      expect(await backend.getAll()).toMatchObject([
        { state: "transferring", assetId: "asset-1", transferredBytes: 500 },
      ])
      up.release()
      await run
      await tick(10)
      expect(await backend.getAll()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it("a late pick of an earlier tab's entry being continued never removes it", async () => {
    fake()
    try {
      const { s, backend } = sessions()
      const session = (await s.get("user-1"))!
      const file = photo(1000, "kept.jpg")
      // The earlier tab's entry, under the key the file still has.
      const earlier = (await session.journal.pick({
        purpose: "general",
        subject: { kind: "none", id: null },
        groupKey: null,
        uploadKey: "earlier-key",
        fileFingerprint: "f",
        file,
        mediaType: "image",
      }))!
      const keys = memKeys()
      await keys.set(file, "earlier-key")
      const up = gatedUpload({
        state: "failed",
        error: { code: "transfer_failed", message: "x", retryable: true },
      })
      const upload = toQueueUploader(up.fn, {
        keys,
        capture: async () => delayedPick(session, JOURNAL_DEADLINE_MS + 1000),
      })
      const run = upload(file, context()).catch(() => {})
      // The upload ends before the pick answers.
      up.release()
      await tick(JOURNAL_DEADLINE_MS + 1500)
      await run
      await tick(10)
      expect(await backend.getAll()).toMatchObject([
        {
          id: earlier.id,
          state: "failed",
          failure: { code: "transfer_failed", permanent: false },
        },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  const pickInput = (file: File, key = "k") => ({
    purpose: "general" as const,
    subject: { kind: "none" as const, id: null },
    groupKey: null,
    uploadKey: key,
    fileFingerprint: key,
    file,
    mediaType: "image" as const,
  })

  /** A memory backend whose next `put` waits `ms` (forever when Infinity). */
  function slowBackend() {
    const base = memoryJournalBackend()
    const log: string[] = []
    let next: number | null = null
    return {
      log,
      slowNext: (ms: number) => void (next = ms),
      getAll: () => base.getAll(),
      delete: (id: string) => base.delete(id),
      clear: () => base.clear(),
      put: async (e: JournalEntry) => {
        const ms = next
        next = null
        log.push(`start:${e.groupKey ?? e.state}`)
        if (ms === Infinity) return new Promise<void>(() => {})
        if (ms) await new Promise((r) => setTimeout(r, ms))
        await base.put(e)
        log.push(`end:${e.groupKey ?? e.state}`)
      },
    }
  }

  it("M1: a hung storage call degrades the journal; later calls answer at once, untouched", async () => {
    fake()
    try {
      const backend = slowBackend()
      const j = await openCaptureJournal({
        backend,
        accountHash: "a",
        capabilities: roomy,
      })
      const e = (await j.pick(pickInput(photo())))!
      backend.slowNext(Infinity)
      const stuck = j.update(e.id, { groupKey: "g1" })
      const queued = j.update(e.id, { groupKey: "g2" })
      await tick(JOURNAL_STUCK_MS + 100)
      await expect(stuck).resolves.toBeUndefined()
      await expect(queued).resolves.toBeUndefined()
      const writes = backend.log.length
      // Degraded: no queueing, no storage.
      await expect(j.pick(pickInput(photo(), "k2"))).resolves.toBeNull()
      await expect(j.unfinished()).resolves.toEqual([])
      expect(backend.log).toHaveLength(writes)
      // The queued call never ran after the stuck one.
      expect(backend.log.filter((l) => l.includes("g2"))).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it("M1: a slow operation still completes, and the next runs after it, in order", async () => {
    fake()
    try {
      const backend = slowBackend()
      const j = await openCaptureJournal({
        backend,
        accountHash: "a",
        capabilities: roomy,
      })
      const e = (await j.pick(pickInput(photo())))!
      backend.slowNext(2000)
      const first = j.update(e.id, { groupKey: "g1" })
      const second = j.update(e.id, { groupKey: "g2" })
      await tick(2200)
      await first
      await second
      expect(backend.log.slice(-4)).toEqual([
        "start:g1",
        "end:g1",
        "start:g2",
        "end:g2",
      ])
      expect((await j.unfinished())[0]!.groupKey).toBe("g2")
    } finally {
      vi.useRealTimers()
    }
  })

  it("M1: unfinished() is bounded while an operation runs, and doesn't move past it", async () => {
    fake()
    try {
      const backend = slowBackend()
      const j = await openCaptureJournal({
        backend,
        accountHash: "a",
        capabilities: roomy,
      })
      const e = (await j.pick(pickInput(photo())))!
      backend.slowNext(4000)
      const slow = j.update(e.id, { groupKey: "g1" })
      const listed = j.unfinished()
      await tick(JOURNAL_READ_WAIT_MS + 100)
      await expect(listed).resolves.toEqual([])
      await tick(2000)
      await slow
      expect((await j.unfinished())[0]!.groupKey).toBe("g1")
    } finally {
      vi.useRealTimers()
    }
  })

  it("M2: a pick that takes 3 s binds, catches up, and the upload's end is applied", async () => {
    fake()
    try {
      const raw = slowBackend()
      const storage = memStorage()
      const s = createCaptureSessions({
        probe: async () => roomy,
        backend: () => raw,
        cleanup: () => ({ storage }),
        events: () => null,
      })
      const up = gatedUpload({
        state: "failed",
        error: { code: "transfer_failed", message: "x", retryable: true },
      })
      const upload = toQueueUploader(up.fn, {
        keys: memKeys(),
        capture: s.get,
      })
      await s.get("user-1")
      raw.slowNext(3000)
      const run = upload(photo(1000), context()).catch(() => {})
      await tick(3500)
      await tickUntil(async () => (await raw.getAll()).length > 0)
      expect(await raw.getAll()).toMatchObject([
        { state: "transferring", assetId: "asset-1" },
      ])
      up.release()
      await run
      await tick(100)
      expect(await raw.getAll()).toMatchObject([
        { state: "failed", failure: { code: "transfer_failed" } },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("M4: a label clear made while the pick ran reaches the entry once bound", async () => {
    fake()
    try {
      const raw = slowBackend()
      const storage = memStorage()
      const s = createCaptureSessions({
        probe: async () => roomy,
        backend: () => raw,
        cleanup: () => ({ storage }),
        events: () => null,
      })
      await s.get("user-1")
      const file = photo(1000)
      annotateCapture(file, {
        pendingLabels: { venueId: "v", input: { x: 1 } },
      })
      const up = gatedUpload({ state: "ready" })
      const upload = toQueueUploader(up.fn, {
        keys: memKeys(),
        capture: s.get,
      })
      raw.slowNext(3000)
      const run = upload(file, context()).catch(() => {})
      await tick(500)
      // The server confirmed the labels before the entry was bound.
      annotateCapture(file, { pendingLabels: undefined })
      await tick(3000)
      await tickUntil(async () => (await raw.getAll()).length > 0)
      const [entry] = await raw.getAll()
      expect(entry).toBeDefined()
      expect(entry).not.toHaveProperty("pendingLabels")
      up.release()
      await run
    } finally {
      vi.useRealTimers()
    }
  })

  it("the first upload after the page loads is journalled though the probe takes 2.5 s", async () => {
    fake()
    try {
      const storage = memStorage()
      const backend = memoryJournalBackend()
      const s = createCaptureSessions({
        probe: () => new Promise((r) => setTimeout(() => r(roomy), 2500)),
        backend: () => backend,
        cleanup: () => ({ storage }),
        events: () => null,
      })
      const upload = toQueueUploader(
        fakeUpload({
          state: "failed",
          error: { code: "transfer_failed", message: "x", retryable: true },
        }),
        { keys: memKeys(), capture: s.get }
      )
      const run = upload(photo(), context()).catch(() => {})
      await tick(2600)
      await run
      await tick(10)
      expect(await backend.getAll()).toMatchObject([{ state: "failed" }])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("an untrusted store after degrading (N1)", () => {
  const fake = () =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const turn = () => new Promise((r) => setImmediate(r))
  async function tick(ms: number) {
    for (let t = 0; t < ms; t += 100) {
      for (let i = 0; i < 3; i++) await turn()
      await vi.advanceTimersByTimeAsync(100)
    }
    for (let i = 0; i < 3; i++) await turn()
  }
  const input = (file: File, key: string) => ({
    purpose: "general" as const,
    subject: { kind: "none" as const, id: null },
    groupKey: null,
    uploadKey: key,
    fileFingerprint: key,
    file,
    mediaType: "image" as const,
  })

  function page(
    backend: JournalBackend,
    storage: ReturnType<typeof memStorage>
  ) {
    return createCaptureSessions({
      probe: async () => roomy,
      backend: () => backend,
      cleanup: () => ({ storage }),
      events: () => null,
    })
  }

  it("a degraded journal marks the store; the next page clears it before listing", async () => {
    fake()
    try {
      const base = memoryJournalBackend()
      let hang = false
      const backend: JournalBackend = {
        ...base,
        getAll: () => base.getAll(),
        // The finished upload's done() never answers.
        delete: (id) => (hang ? new Promise<void>(() => {}) : base.delete(id)),
        clear: () => base.clear(),
        put: (e) => (hang ? new Promise<void>(() => {}) : base.put(e)),
      }
      const storage = memStorage()
      const first = (await page(backend, storage).get("user-1"))!
      const e = (await first.journal.pick(input(photo(), "a")))!
      await first.journal.pick(input(photo(), "b"))
      hang = true
      void first.journal.done(e.id)
      void first.journal.update(e.id, { groupKey: "g" })
      await tick(JOURNAL_STUCK_MS + 200)
      expect(storage.getItem(JOURNAL_UNTRUSTED_STORAGE_KEY)).toBe("1")
      // A frozen snapshot is still stored...
      expect(await base.getAll()).toHaveLength(2)
      // ...and the next page load trusts none of it.
      hang = false
      const next = (await page(backend, storage).get("user-1"))!
      expect(await next.journal.unfinished()).toEqual([])
      expect(await base.getAll()).toEqual([])
      expect(storage.getItem(JOURNAL_UNTRUSTED_STORAGE_KEY)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("without the mark, the next page lists entries as before", async () => {
    const backend = memoryJournalBackend()
    const storage = memStorage()
    const first = (await page(backend, storage).get("user-1"))!
    await first.journal.pick(input(photo(), "a"))
    const next = (await page(backend, storage).get("user-1"))!
    expect(await next.journal.unfinished()).toHaveLength(1)
  })

  it("sign-out removes the mark", async () => {
    const storage = memStorage()
    storage.setItem(JOURNAL_UNTRUSTED_STORAGE_KEY, "1")
    await clearCaptureDataOnDevice({ storage })
    expect(storage.getItem(JOURNAL_UNTRUSTED_STORAGE_KEY)).toBeNull()
  })
})
