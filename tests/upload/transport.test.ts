import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createUploader,
  guardBeforeUnload,
  type CreateUploaderOptions,
  type UploadState,
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

const KiB = 1024
const MiB = 1024 * KiB
// Small chunks keep the suite fast; production uses Supabase's 6 MiB.
const CHUNK = 64 * KiB

const limits = {
  maxPhotoBytes: 20 * MiB,
  maxVideoBytes: 200 * MiB,
}

let storage: FakeStorage
let backend: ReturnType<typeof createFakeBackend>
let urlStorage: MemoryUrlStorage

beforeEach(async () => {
  storage = await startFakeStorage()
  backend = createFakeBackend(storage)
  urlStorage = new MemoryUrlStorage()
})

afterEach(async () => {
  await storage.close()
})

function makeUploader(overrides: Partial<CreateUploaderOptions> = {}) {
  return createUploader({
    reserve: backend.reserve,
    finalise: backend.finalise,
    supabaseUrl: storage.url,
    getAccessToken: async () => "user-jwt",
    limits,
    chunkSize: CHUNK,
    retryDelays: [0, 10, 20],
    createXhr: () => new NodeXhr(),
    tusAdapters: { fileReader: blobFileReader, urlStorage },
    ...overrides,
  })
}

function bytes(size: number) {
  const buf = new Uint8Array(size)
  for (let i = 0; i < size; i++) buf[i] = (i * 31 + 7) % 251
  return buf
}

function video(size = 5 * CHUNK + 1234) {
  return new File([bytes(size)], "clip.mp4", { type: "video/mp4" })
}

function photo(size = 200 * KiB) {
  return new File([bytes(size)], "dish.jpg", { type: "image/jpeg" })
}

function recorder() {
  const states: UploadState[] = []
  const progress: number[] = []
  return {
    states,
    progress,
    onStateChange: (s: UploadState) => states.push(s),
    onProgress: (p: number) => progress.push(p),
  }
}

const patches = () => storage.requests.filter((r) => r.method === "PATCH")
const posts = () =>
  storage.requests.filter(
    (r) => r.method === "POST" && r.path.includes("resumable")
  )

describe("resumable (TUS) transfer", () => {
  it("uploads a video in chunks with Supabase headers and metadata", async () => {
    const file = video()
    const rec = recorder()
    const result = await makeUploader()(file, {
      idempotencyKey: "k1",
      ...rec,
    })

    expect(result).toEqual({ assetId: "asset-1", state: "ready" })
    expect(rec.states).toEqual(["uploading", "processing", "ready"])
    expect(rec.progress.at(-1)).toBe(1)

    const stored = storage.objects.get("media/uploader-1/asset-1/original.mp4")
    expect(stored?.equals(Buffer.from(await file.arrayBuffer()))).toBe(true)

    // 6 chunks: five full ones and a remainder, each PATCH at the next offset.
    expect(patches().map((p) => p.offset)).toEqual([
      0,
      CHUNK,
      2 * CHUNK,
      3 * CHUNK,
      4 * CHUNK,
      5 * CHUNK,
    ])
    const [create] = posts()
    expect(create.path).toBe("/storage/v1/upload/resumable")
    expect(create.headers["x-upsert"]).toBe("false")
    expect(create.headers.authorization).toBe("Bearer user-jwt")
    const metadata = Object.fromEntries(
      String(create.headers["upload-metadata"])
        .split(",")
        .map((pair) => {
          const [k, v] = pair.split(" ")
          return [k, Buffer.from(v, "base64").toString("utf8")]
        })
    )
    expect(metadata).toMatchObject({
      bucketName: "media",
      objectName: "uploader-1/asset-1/original.mp4",
      contentType: "video/mp4",
    })
    expect(backend.calls.finalise).toEqual([
      { assetId: "asset-1", idempotencyKey: "k1" },
    ])
    // Fingerprint removed after success.
    expect(urlStorage.entries.size).toBe(0)
  })

  it("uses TUS for photos above the resumable threshold", async () => {
    const upload = makeUploader({ resumableThresholdBytes: 100 * KiB })
    const result = await upload(photo(300 * KiB), { idempotencyKey: "k1" })
    expect(result.state).toBe("ready")
    expect(posts()).toHaveLength(1)
    expect(backend.calls.reserve[0].preferResumable).toBe(true)
  })

  it("retries a failed chunk within one attempt from the server offset", async () => {
    storage.fault = (req) =>
      req.method === "PATCH" &&
      req.offset === 2 * CHUNK &&
      patches().filter((p) => p.offset === 2 * CHUNK).length === 1
        ? "fail-500"
        : "pass"

    const result = await makeUploader()(video(), { idempotencyKey: "k1" })

    expect(result.state).toBe("ready")
    // HEAD after the failure, then resume at the failed chunk only.
    expect(patches().map((p) => p.offset)).toEqual([
      0,
      CHUNK,
      2 * CHUNK,
      2 * CHUNK,
      3 * CHUNK,
      4 * CHUNK,
      5 * CHUNK,
    ])
    expect(posts()).toHaveLength(1)
  })

  it("resumes an interrupted transfer on retry without re-sending completed chunks", async () => {
    const file = video()
    // The connection dies on the third chunk and retries are exhausted.
    storage.fault = (req) =>
      req.method === "PATCH" && req.offset === 2 * CHUNK ? "fail-500" : "pass"
    const first = await makeUploader({ retryDelays: [] })(file, {
      idempotencyKey: "k1",
    })
    expect(first.state).toBe("failed")
    expect(first.error?.code).toBe("transfer_failed")
    expect(first.error?.retryable).toBe(true)
    expect(backend.calls.finalise).toHaveLength(0)
    expect(urlStorage.entries.size).toBe(1)

    storage.fault = () => "pass"
    const before = storage.requests.length
    const rec = recorder()
    const second = await makeUploader()(file, { idempotencyKey: "k1", ...rec })

    expect(second).toEqual({ assetId: "asset-1", state: "ready" })
    const retryRequests = storage.requests.slice(before)
    // No new TUS upload: HEAD the stored URL, then PATCH from offset 2 chunks.
    expect(retryRequests.map((r) => r.method)[0]).toBe("HEAD")
    expect(retryRequests.some((r) => r.method === "POST")).toBe(false)
    const retryPatches = retryRequests.filter((r) => r.method === "PATCH")
    expect(retryPatches.map((p) => p.offset)).toEqual([
      2 * CHUNK,
      3 * CHUNK,
      4 * CHUNK,
      5 * CHUNK,
    ])
    const resent = retryPatches.reduce((n, p) => n + p.bytes, 0)
    expect(resent).toBe(file.size - 2 * CHUNK)
    // Progress resumes from where the first attempt stopped.
    expect(rec.progress[0]).toBeGreaterThanOrEqual((2 * CHUNK) / file.size)

    const stored = storage.objects.get("media/uploader-1/asset-1/original.mp4")
    expect(stored?.equals(Buffer.from(await file.arrayBuffer()))).toBe(true)
  })

  it("resumes after the storage server is killed mid-transfer", async () => {
    const file = video()
    // The server crashes while the fourth chunk is in flight; the client's
    // own retries hit a dead port and give up.
    storage.fault = async (req): Promise<Fault> => {
      if (req.method === "PATCH" && req.offset === 3 * CHUNK) {
        await storage.kill()
      }
      return "pass"
    }
    const first = await makeUploader({ retryDelays: [0, 10] })(file, {
      idempotencyKey: "k1",
    })
    expect(first.state).toBe("failed")
    expect(first.error?.code).toBe("transfer_failed")

    storage.fault = () => "pass"
    await storage.restart()
    const before = storage.requests.length
    const second = await makeUploader()(file, { idempotencyKey: "k1" })

    expect(second).toEqual({ assetId: "asset-1", state: "ready" })
    const retry = storage.requests.slice(before)
    expect(retry.some((r) => r.method === "POST")).toBe(false)
    const retryPatches = retry.filter((r) => r.method === "PATCH")
    // Chunks the server stored before it died are not sent again.
    expect(retryPatches[0].offset).toBe(3 * CHUNK)
    expect(retryPatches.reduce((n, p) => n + p.bytes, 0)).toBe(
      file.size - 3 * CHUNK
    )
    const stored = storage.objects.get("media/uploader-1/asset-1/original.mp4")
    expect(stored?.equals(Buffer.from(await file.arrayBuffer()))).toBe(true)
    expect(backend.assets.size).toBe(1)
  })

  it("treats 409 'already exists' after a lost final response as uploaded", async () => {
    const file = video()
    // Every byte is stored, but the response to the last PATCH is lost.
    storage.fault = (req) =>
      req.method === "PATCH" && req.offset === 5 * CHUNK
        ? "drop-response"
        : "pass"
    const first = await makeUploader({ retryDelays: [] })(file, {
      idempotencyKey: "k1",
    })
    expect(first.state).toBe("failed")
    expect(storage.objects.has("media/uploader-1/asset-1/original.mp4")).toBe(
      true
    )

    storage.fault = () => "pass"
    const before = storage.requests.length
    const second = await makeUploader()(file, { idempotencyKey: "k1" })

    expect(second).toEqual({ assetId: "asset-1", state: "ready" })
    const retry = storage.requests.slice(before)
    // HEAD -> 404 (finished), POST -> 409, no bytes re-sent.
    expect(retry.map((r) => r.method)).toEqual(["HEAD", "POST"])
    expect(backend.calls.finalise).toHaveLength(1)
    expect(backend.assets.size).toBe(1)
  })

  it("aborts without finalising and stops sending chunks", async () => {
    const controller = new AbortController()
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    storage.fault = async (req): Promise<Fault> => {
      if (req.method === "PATCH" && req.offset === CHUNK) {
        controller.abort()
        await held
      }
      return "pass"
    }

    const rec = recorder()
    const result = await makeUploader()(video(), {
      idempotencyKey: "k1",
      signal: controller.signal,
      ...rec,
    })
    release()
    await new Promise((r) => setTimeout(r, 50))

    expect(result.state).toBe("failed")
    expect(result.error?.code).toBe("aborted")
    expect(result.assetId).toBe("asset-1")
    expect(rec.states).toEqual(["uploading", "failed"])
    expect(backend.calls.finalise).toHaveLength(0)
    expect(patches().map((p) => p.offset)).toEqual([0, CHUNK])
  })
})

describe("signed URL transfer", () => {
  it("PUTs a small photo with progress and finalises", async () => {
    const file = photo()
    const rec = recorder()
    const result = await makeUploader()(file, {
      idempotencyKey: "k1",
      ...rec,
    })

    expect(result).toEqual({ assetId: "asset-1", state: "ready" })
    expect(rec.states).toEqual(["uploading", "processing", "ready"])
    expect(rec.progress.length).toBeGreaterThan(1)
    expect(rec.progress.at(-1)).toBe(1)
    const [put] = storage.requests
    expect(put.method).toBe("PUT")
    expect(put.headers["x-upsert"]).toBe("false")
    expect(put.headers["content-type"]).toBe("image/jpeg")
    expect(posts()).toHaveLength(0)
    expect(
      storage.objects
        .get("media/uploader-1/asset-1/original.jpg")
        ?.equals(Buffer.from(await file.arrayBuffer()))
    ).toBe(true)
  })

  it("treats a Duplicate (409) answer after a lost response as uploaded", async () => {
    storage.fault = (_req, index) => (index === 0 ? "drop-response" : "pass")
    const result = await makeUploader()(photo(), { idempotencyKey: "k1" })

    expect(result).toEqual({ assetId: "asset-1", state: "ready" })
    expect(storage.requests.map((r) => r.method)).toEqual(["PUT", "PUT"])
    expect(backend.calls.finalise).toHaveLength(1)
  })

  it("aborts a PUT without finalising", async () => {
    const controller = new AbortController()
    storage.fault = async (): Promise<Fault> => {
      controller.abort()
      return "pass"
    }
    const result = await makeUploader()(photo(), {
      idempotencyKey: "k1",
      signal: controller.signal,
    })
    expect(result.error?.code).toBe("aborted")
    expect(backend.calls.finalise).toHaveLength(0)
  })
})

describe("idempotency", () => {
  it("a retry with the same key reuses the reservation and creates no second asset", async () => {
    storage.fault = (req) =>
      req.method === "PATCH" && req.offset === CHUNK ? "fail-500" : "pass"
    const upload = makeUploader({ retryDelays: [] })
    const first = await upload(video(), { idempotencyKey: "same" })
    expect(first.state).toBe("failed")

    storage.fault = () => "pass"
    const second = await upload(video(), { idempotencyKey: "same" })
    // Even a third call after success stays on the same asset and is a no-op.
    const third = await upload(video(), { idempotencyKey: "same" })

    expect(first.assetId).toBe("asset-1")
    expect(second).toEqual({ assetId: "asset-1", state: "ready" })
    expect(third).toEqual({ assetId: "asset-1", state: "ready" })
    expect(backend.calls.reserve).toHaveLength(3)
    expect(backend.assets.size).toBe(1)
    expect(backend.calls.finalise).toHaveLength(1)
    expect(posts()).toHaveLength(1)
  })

  it("skips the transfer when the server already has the bytes (processing)", async () => {
    const upload = makeUploader()
    await upload(photo(), { idempotencyKey: "k1" })
    backend.assets.get("asset-1")!.state = "processing"
    const before = storage.requests.length
    const result = await upload(photo(), { idempotencyKey: "k1" })
    expect(result.state).toBe("ready")
    expect(storage.requests.length).toBe(before)
    expect(backend.calls.finalise).toHaveLength(2)
  })
})

describe("finalise outcomes", () => {
  it("reports processing failure from the server", async () => {
    const upload = makeUploader({
      finalise: async () => ({ state: "failed", error: "Not a real video" }),
    })
    const rec = recorder()
    const result = await upload(video(), { idempotencyKey: "k1", ...rec })
    expect(result.error).toEqual({
      code: "processing_failed",
      message: "Not a real video",
      retryable: false,
    })
    expect(rec.states).toEqual(["uploading", "processing", "failed"])
  })

  it("reports a reserve failure as retryable", async () => {
    const upload = makeUploader({
      reserve: async () => {
        throw new Error("Your venue is inactive.")
      },
    })
    const result = await upload(photo(), { idempotencyKey: "k1" })
    expect(result).toEqual({
      assetId: null,
      state: "failed",
      error: {
        code: "reserve_failed",
        message: "Your venue is inactive.",
        retryable: true,
      },
    })
  })
})

describe("client-side early checks", () => {
  it.each([
    [
      "oversize photo",
      new File([bytes(1)], "big.jpg", { type: "image/jpeg" }),
      { maxPhotoBytes: 0.5, maxVideoBytes: 10 },
      "too_large",
    ],
    [
      "oversize video",
      new File([bytes(11)], "big.mov", { type: "video/quicktime" }),
      { maxPhotoBytes: 100, maxVideoBytes: 10 },
      "too_large",
    ],
    [
      "unsupported type",
      new File([bytes(10)], "notes.pdf", { type: "application/pdf" }),
      limits,
      "unsupported_type",
    ],
    [
      "empty file",
      new File([], "empty.jpg", { type: "image/jpeg" }),
      limits,
      "empty_file",
    ],
  ])("rejects %s before any network call", async (_label, file, l, code) => {
    const reserve = vi.fn(backend.reserve)
    const getAccessToken = vi.fn(async () => "user-jwt")
    const rec = recorder()
    const result = await makeUploader({ reserve, getAccessToken, limits: l })(
      file,
      { idempotencyKey: "k1", ...rec }
    )
    expect(result.state).toBe("failed")
    expect(result.assetId).toBeNull()
    expect(result.error?.code).toBe(code)
    expect(result.error?.retryable).toBe(false)
    expect(rec.states).toEqual(["failed"])
    expect(reserve).not.toHaveBeenCalled()
    expect(getAccessToken).not.toHaveBeenCalled()
    expect(storage.requests).toHaveLength(0)
  })

  it("accepts HEIC and MOV with an empty browser MIME type by extension", async () => {
    const upload = makeUploader()
    const heic = await upload(new File([bytes(1000)], "IMG_1.HEIC"), {
      idempotencyKey: "h",
    })
    const mov = await upload(new File([bytes(1000)], "clip.MOV"), {
      idempotencyKey: "m",
    })
    expect(heic.state).toBe("ready")
    expect(mov.state).toBe("ready")
    expect(
      backend.calls.reserve.map((r) => [r.contentType, r.mediaType])
    ).toEqual([
      ["image/heic", "image"],
      ["video/quicktime", "video"],
    ])
  })
})

describe("beforeunload guard", () => {
  it("prompts only while uploads are active and can be removed", () => {
    const target = new EventTarget()
    let active = 1
    const dispose = guardBeforeUnload(() => active > 0, target as Window)

    const fire = () => {
      const event = new Event("beforeunload", { cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(fire()).toBe(true)
    active = 0
    expect(fire()).toBe(false)
    active = 1
    dispose()
    expect(fire()).toBe(false)
  })

  it("the uploader reports its active count", async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const upload = makeUploader({
      finalise: async (input) => {
        await held
        return backend.finalise(input)
      },
    })
    expect(upload.activeCount()).toBe(0)
    const pending = upload(photo(), { idempotencyKey: "k1" })
    await vi.waitFor(() => expect(backend.calls.reserve).toHaveLength(1))
    expect(upload.activeCount()).toBe(1)
    release()
    await pending
    expect(upload.activeCount()).toBe(0)
  })
})
