import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest"

import {
  createUploader,
  toQueueUploader,
  tusFingerprint,
  type QueueResumeToken,
  type UploadContext,
  type Uploader,
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

let storage: FakeStorage
let backend: ReturnType<typeof createFakeBackend>

beforeEach(async () => {
  storage = await startFakeStorage()
  backend = createFakeBackend(storage)
})

afterEach(async () => {
  await storage.close()
})

function queueUploader(retryDelays: number[] = []) {
  let n = 0
  return toQueueUploader(
    createUploader({
      reserve: backend.reserve,
      finalise: backend.finalise,
      supabaseUrl: storage.url,
      getAccessToken: async () => "user-jwt",
      limits: {
        maxPhotoBytes: 20 * 1024 * 1024,
        maxVideoBytes: 200 * 1024 * 1024,
      },
      chunkSize: CHUNK,
      retryDelays,
      createXhr: () => new NodeXhr(),
      tusAdapters: {
        fileReader: blobFileReader,
        urlStorage: new MemoryUrlStorage(),
      },
    }),
    { newKey: () => `key-${++n}` }
  )
}

function file(name: string, type: string, size: number) {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = i % 251
  return new File([bytes], name, { type })
}

const video = () => file("clip.mp4", "video/mp4", 5 * CHUNK + 99)
const photo = () => file("dish.jpg", "image/jpeg", 50 * 1024)

describe("toQueueUploader against the ui queue contract", () => {
  it("has exactly the ui track's Uploader and UploadContext types", () => {
    expectTypeOf<Uploader>().toEqualTypeOf<ui.Uploader>()
    expectTypeOf<UploadContext>().toEqualTypeOf<ui.UploadContext>()
    expectTypeOf(queueUploader()).toEqualTypeOf<ui.Uploader>()
    // Assignable where the ui expects it, e.g. UploadDialog's `upload` prop.
    const injected: ui.Uploader = queueUploader()
    expect(typeof injected).toBe("function")
  })

  it("reports progress, switches to processing and resolves when ready", async () => {
    const item = ui.createQueueItemDriver(queueUploader(), photo())
    await item.run()

    expect(item.status).toBe("done")
    expect(item.progress).toBe(1)
    expect(item.processingCalls).toBe(1)
    expect(item.resumeToken).toEqual({
      idempotencyKey: "key-1",
      assetId: "asset-1",
      tusFingerprint: undefined,
    } satisfies QueueResumeToken)
  })

  it("stores asset id and tus fingerprint, and a queue retry resumes the same asset", async () => {
    storage.fault = (req): Fault =>
      req.method === "PATCH" && req.offset === 2 * CHUNK ? "fail-500" : "pass"
    const item = ui.createQueueItemDriver(queueUploader(), video())
    await item.run()

    expect(item.status).toBe("failed")
    expect(item.error).toBe("Storage rejected the upload (HTTP 500).")
    expect(item.processingCalls).toBe(0)
    expect(item.resumeToken).toEqual({
      idempotencyKey: "key-1",
      assetId: "asset-1",
      tusFingerprint: tusFingerprint("asset-1"),
    })

    storage.fault = () => "pass"
    const before = storage.requests.length
    await item.run()

    expect(item.status).toBe("done")
    expect(item.attempts).toBe(2)
    const retry = storage.requests.slice(before)
    expect(retry.some((r) => r.method === "POST")).toBe(false)
    expect(retry.filter((r) => r.method === "PATCH")[0].offset).toBe(2 * CHUNK)
    expect(backend.calls.reserve.map((r) => r.idempotencyKey)).toEqual([
      "key-1",
      "key-1",
    ])
    expect(backend.assets.size).toBe(1)
    expect(backend.calls.finalise).toHaveLength(1)
  })

  it("cancel rejects as AbortError, does not finalise, and retry resumes", async () => {
    const uploader = queueUploader()
    const item = ui.createQueueItemDriver(uploader, video())
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    storage.fault = async (req): Promise<Fault> => {
      if (req.method === "PATCH" && req.offset === CHUNK) {
        item.cancel()
        await held
      }
      return "pass"
    }
    await item.run()
    release()

    expect(item.status).toBe("cancelled")
    expect(backend.calls.finalise).toHaveLength(0)

    storage.fault = () => "pass"
    await item.run()
    expect(item.status).toBe("done")
    expect(backend.assets.size).toBe(1)
  })

  it("surfaces preflight rejections as the failure message", async () => {
    const item = ui.createQueueItemDriver(
      queueUploader(),
      file("notes.pdf", "application/pdf", 10)
    )
    await item.run()
    expect(item.status).toBe("failed")
    expect(item.error).toMatch(/not a supported photo or video/)
    expect(storage.requests).toHaveLength(0)
  })
})
