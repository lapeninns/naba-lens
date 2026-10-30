import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createUploader,
  localUploadKeyStore,
  ReservationGoneError,
  toQueueUploader,
  UPLOAD_KEYS_STORAGE_KEY,
  type ReserveInput,
} from "../../lib/upload"
import { createFakeBackend } from "./helpers/fake-backend"
import {
  startFakeStorage,
  type FakeStorage,
  type Fault,
} from "./helpers/fake-storage"
import {
  blobFileReader,
  MemoryUrlStorage,
  NodeXhr,
} from "./helpers/node-adapters"
import * as ui from "./helpers/ui-queue-contract"

const CHUNK = 64 * 1024

/** In-memory stand-in for window.localStorage. */
function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

function file(name: string, size: number, lastModified = 1_700_000_000_000) {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = i % 251
  return new File([bytes], name, {
    type: name.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
    lastModified,
  })
}

describe("localUploadKeyStore", () => {
  it("remembers a key per file identity without storing the file name", async () => {
    const storage = memoryStorage()
    const store = localUploadKeyStore({ storage })
    const a = file("private-name.jpg", 10)
    await store.set(a, "key-a")
    expect(await store.get(file("private-name.jpg", 10))).toBe("key-a")
    // Different size or modification time: a different file.
    expect(await store.get(file("private-name.jpg", 11))).toBeNull()
    expect(await store.get(file("private-name.jpg", 10, 1))).toBeNull()
    expect(storage.map.get(UPLOAD_KEYS_STORAGE_KEY)).not.toContain(
      "private-name"
    )
    await store.delete(a)
    expect(await store.get(a)).toBeNull()
    expect(storage.map.has(UPLOAD_KEYS_STORAGE_KEY)).toBe(false)
  })

  it("forgets keys before the server's 24 h abandoned-upload window", async () => {
    let now = 0
    const storage = memoryStorage()
    const store = localUploadKeyStore({ storage, now: () => now })
    const a = file("a.jpg", 10)
    await store.set(a, "key-a")
    now = 19 * 60 * 60 * 1000
    expect(await store.get(a)).toBe("key-a")
    now = 20 * 60 * 60 * 1000
    expect(await store.get(a)).toBeNull()
  })

  it("survives unreadable or unavailable storage", async () => {
    const storage = memoryStorage()
    storage.map.set(UPLOAD_KEYS_STORAGE_KEY, "{not json")
    const store = localUploadKeyStore({ storage })
    expect(await store.get(file("a.jpg", 1))).toBeNull()
    const broken = localUploadKeyStore({
      storage: {
        getItem: () => {
          throw new Error("denied")
        },
        setItem: () => {
          throw new Error("quota")
        },
        removeItem: () => {},
      },
    })
    await broken.set(file("a.jpg", 1), "k")
    expect(await broken.get(file("a.jpg", 1))).toBeNull()
  })
})

describe("toQueueUploader with a key store", () => {
  let storage: FakeStorage
  let backend: ReturnType<typeof createFakeBackend>
  let local: ReturnType<typeof memoryStorage>
  let urlStorage: MemoryUrlStorage

  beforeEach(async () => {
    storage = await startFakeStorage()
    backend = createFakeBackend(storage)
    local = memoryStorage()
    // tus URL storage is localStorage in the browser: it survives a reload too.
    urlStorage = new MemoryUrlStorage()
  })
  afterEach(async () => {
    await storage.close()
  })

  /** A fresh page load: new uploader and queue, same browser storage. */
  function pageLoad(
    reserve: (
      input: ReserveInput
    ) => ReturnType<typeof backend.reserve> = backend.reserve
  ) {
    let n = 0
    const prefix = Math.random().toString(36).slice(2, 8)
    return toQueueUploader(
      createUploader({
        reserve,
        finalise: backend.finalise,
        supabaseUrl: storage.url,
        getAccessToken: async () => "user-jwt",
        limits: {
          maxPhotoBytes: 20 * 1024 * 1024,
          maxVideoBytes: 200 * 1024 * 1024,
        },
        chunkSize: CHUNK,
        retryDelays: [],
        createXhr: () => new NodeXhr(),
        tusAdapters: { fileReader: blobFileReader, urlStorage },
      }),
      {
        newKey: () => `${prefix}-key-${++n}`,
        keys: localUploadKeyStore({ storage: local }),
      }
    )
  }

  it("choosing the same file after a reload reuses the asset and resumes the transfer", async () => {
    const video = () => file("clip.mp4", 5 * CHUNK + 99)
    storage.fault = (req): Fault =>
      req.method === "PATCH" && req.offset === 3 * CHUNK ? "fail-500" : "pass"
    const first = ui.createQueueItemDriver(pageLoad(), video())
    await first.run()
    expect(first.status).toBe("failed")

    // Reload: the queue and its resume token are gone; the file is chosen again.
    storage.fault = () => "pass"
    const before = storage.requests.length
    const second = ui.createQueueItemDriver(pageLoad(), video())
    await second.run()
    expect(second.status).toBe("done")

    const keys = backend.calls.reserve.map((r) => r.idempotencyKey)
    expect(new Set(keys).size).toBe(1)
    expect(backend.assets.size).toBe(1)
    const resumed = storage.requests.slice(before)
    expect(resumed.some((r) => r.method === "POST")).toBe(false)
    expect(resumed.find((r) => r.method === "PATCH")!.offset).toBe(3 * CHUNK)
    // Finished: the key is forgotten, so the same file again is a new upload.
    expect(local.map.has(UPLOAD_KEYS_STORAGE_KEY)).toBe(false)
    const third = ui.createQueueItemDriver(pageLoad(), video())
    await third.run()
    expect(backend.assets.size).toBe(2)
  })

  it("the same file twice in one batch gets two reservations", async () => {
    const upload = pageLoad()
    const a = ui.createQueueItemDriver(upload, file("dish.jpg", 1000))
    const b = ui.createQueueItemDriver(upload, file("dish.jpg", 1000))
    await Promise.all([a.run(), b.run()])
    expect([a.status, b.status]).toEqual(["done", "done"])
    expect(backend.assets.size).toBe(2)
  })

  it("a removed reservation fails once with a clear reason; retry starts a new asset", async () => {
    const photo = () => file("dish.jpg", 1000)
    // An earlier page load remembered a key whose asset was then removed.
    await localUploadKeyStore({ storage: local }).set(photo(), "removed-key")
    const reserve = async (input: ReserveInput) => {
      if (input.idempotencyKey === "removed-key")
        throw new ReservationGoneError("This file could not be found.")
      return backend.reserve(input)
    }
    const item = ui.createQueueItemDriver(pageLoad(reserve), photo())
    await item.run()
    expect(item.status).toBe("failed")
    expect(item.error).toMatch(/removed or expired\. Retry/)
    await item.run()
    expect(item.status).toBe("done")
    expect(backend.assets.size).toBe(1)
  })

  it("a transient reserve failure keeps the key, so the retry still reuses the asset", async () => {
    const photo = () => file("dish.jpg", 1000)
    let fail = true
    const reserve = async (input: ReserveInput) => {
      const result = await backend.reserve(input)
      if (fail) {
        fail = false
        throw new Error("Network error")
      }
      return result
    }
    const item = ui.createQueueItemDriver(pageLoad(reserve), photo())
    await item.run()
    expect(item.status).toBe("failed")
    await item.run()
    expect(item.status).toBe("done")
    expect(backend.assets.size).toBe(1)
  })
})
