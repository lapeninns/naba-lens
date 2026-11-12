// B05-05c wiring (contracts/b05-05-journal-wiring-scope.md): the library
// fixes (OD-B5-05-3, OD-B5-05-5), the page's capture session (OD-B5-05-1:
// claim before keys, storage-event invalidation, flush on pagehide) and the
// upload adapter's journal writes (OD-B5-05-4, 6, 7), over the memory
// backend with Node Files.
import { describe, expect, it } from "vitest"

import { detectCaptureCapabilities } from "@/lib/upload/capabilities"
import {
  annotateCapture,
  captureEntryId,
  createCaptureSessions,
  forgetCapture,
} from "@/lib/upload/capture-session"
import {
  accountHash,
  JOURNAL_ACCOUNT_STORAGE_KEY,
  JOURNAL_LIMITS,
  memoryJournalBackend,
  openCaptureJournal,
  type JournalEntry,
} from "@/lib/upload/journal"
import { toQueueUploader } from "@/lib/upload/queue-adapter"
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
      pendingLabels: { venueId: "v1", input: { note: "x" } },
      bytes: file,
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
