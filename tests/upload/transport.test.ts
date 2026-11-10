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
    // Even a third call after success stays on the same asset: no transfer,
    // only finalise asked what became of its labels.
    const third = await upload(video(), { idempotencyKey: "same" })

    expect(first.assetId).toBe("asset-1")
    expect(second).toEqual({ assetId: "asset-1", state: "ready" })
    expect(third).toEqual({ assetId: "asset-1", state: "ready" })
    expect(backend.calls.reserve).toHaveLength(3)
    expect(backend.assets.size).toBe(1)
    expect(backend.calls.finalise).toHaveLength(2)
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

/** A promise the test opens by hand, and one telling it the code got there. */
function gate() {
  let reach!: () => void
  let open!: () => void
  const reached = new Promise<void>((r) => (reach = r))
  const opened = new Promise<void>((r) => (open = r))
  return {
    reached,
    open,
    pass: async () => {
      reach()
      await opened
    },
  }
}

describe("beforeunload guard: work that leaving would stop", () => {
  function unloadTarget(isActive: () => boolean) {
    const target = new EventTarget()
    const dispose = guardBeforeUnload(isActive, target as Window)
    const asks = () => {
      const event = new Event("beforeunload", { cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    return { asks, dispose }
  }

  it("a held finalise does not ask; a held reservation or transfer beside it does", async () => {
    const finalising = gate()
    const reserving = gate()
    const transferring = gate()
    const upload = makeUploader({
      reserve: async (input) => {
        if (input.idempotencyKey === "second") await reserving.pass()
        return backend.reserve(input)
      },
      finalise: async (input) => {
        if (input.idempotencyKey === "first") await finalising.pass()
        return backend.finalise(input)
      },
    })
    const guard = unloadTarget(() => upload.stoppableCount() > 0)

    // The first photo is stored; only the server's finalise answer is held.
    const first = upload(photo(), { idempotencyKey: "first" })
    await finalising.reached
    expect(upload.activeCount()).toBe(1)
    expect(upload.stoppableCount()).toBe(0)
    expect(guard.asks()).toBe(false)

    // The second waits on its reservation: leaving would stop it.
    storage.fault = async (req): Promise<Fault> => {
      if (req.method === "PUT") await transferring.pass()
      return "pass"
    }
    const second = upload(photo(), { idempotencyKey: "second" })
    await reserving.reached
    expect(upload.activeCount()).toBe(2)
    expect(upload.stoppableCount()).toBe(1)
    expect(guard.asks()).toBe(true)

    // ...and still would while its bytes are in flight.
    reserving.open()
    await transferring.reached
    expect(upload.activeCount()).toBe(2)
    expect(upload.stoppableCount()).toBe(1)
    expect(guard.asks()).toBe(true)

    transferring.open()
    expect(await second).toEqual({ assetId: "asset-2", state: "ready" })
    expect(upload.activeCount()).toBe(1)
    expect(upload.stoppableCount()).toBe(0)
    expect(guard.asks()).toBe(false)

    finalising.open()
    expect(await first).toEqual({ assetId: "asset-1", state: "ready" })
    expect(upload.activeCount()).toBe(0)
    expect(upload.stoppableCount()).toBe(0)
    guard.dispose()
  })

  it("an asset already ready or processing on the server is not stoppable", async () => {
    let held = gate()
    const upload = makeUploader({
      finalise: async (input) => {
        await held.pass()
        return backend.finalise(input)
      },
    })
    held.open()
    await upload(photo(), { idempotencyKey: "k1" })

    // Reserve answers ready: finalise only reports its labels.
    held = gate()
    const again = upload(photo(), { idempotencyKey: "k1" })
    await held.reached
    expect(upload.activeCount()).toBe(1)
    expect(upload.stoppableCount()).toBe(0)
    held.open()
    expect(await again).toEqual({ assetId: "asset-1", state: "ready" })

    // Reserve answers processing: the bytes are stored, no transfer runs.
    backend.assets.get("asset-1")!.state = "processing"
    held = gate()
    const resumed = upload(photo(), { idempotencyKey: "k1" })
    await held.reached
    expect(upload.activeCount()).toBe(1)
    expect(upload.stoppableCount()).toBe(0)
    held.open()
    expect((await resumed).state).toBe("ready")
    expect(upload.activeCount()).toBe(0)
    expect(upload.stoppableCount()).toBe(0)
  })

  it("settles exactly once on every failure and cancellation", async () => {
    const late = new AbortController()
    const reserving = gate()
    // One uploader throughout, so a count taken down twice would show.
    const upload = makeUploader({
      retryDelays: [],
      reserve: async (input) => {
        if (input.idempotencyKey === "reserve-throws")
          throw new Error("Your venue is inactive.")
        if (input.idempotencyKey === "held") await reserving.pass()
        const result = await backend.reserve(input)
        if (input.idempotencyKey === "cancel-after-reserve") late.abort()
        return result
      },
      finalise: async (input) => {
        if (input.idempotencyKey === "finalise-throws")
          throw new TypeError("Failed to fetch")
        if (input.idempotencyKey === "not-a-photo")
          return { state: "failed", error: "Not a real photo" }
        return backend.finalise(input)
      },
    })
    const counts = () => [upload.activeCount(), upload.stoppableCount()]
    const code = async (key: string, file = photo(), signal?: AbortSignal) =>
      (await upload(file, { idempotencyKey: key, signal })).error?.code

    // Preflight rejection never counts.
    expect(
      await code("empty", new File([], "e.jpg", { type: "image/jpeg" }))
    ).toBe("empty_file")
    expect(counts()).toEqual([0, 0])

    expect(await code("reserve-throws")).toBe("reserve_failed")
    expect(counts()).toEqual([0, 0])

    storage.fault = (req) => (req.method === "PUT" ? "fail-500" : "pass")
    expect(await code("transfer-fails")).toBe("transfer_failed")
    expect(counts()).toEqual([0, 0])

    // Cancelled while the bytes are in flight.
    const controller = new AbortController()
    const transferring = gate()
    storage.fault = async (req): Promise<Fault> => {
      if (req.method === "PUT") await transferring.pass()
      return "pass"
    }
    const cancelled = code("cancel-in-transfer", photo(), controller.signal)
    await transferring.reached
    expect(counts()).toEqual([1, 1])
    controller.abort()
    expect(await cancelled).toBe("aborted")
    expect(counts()).toEqual([0, 0])
    transferring.open()
    storage.fault = () => "pass"

    // Cancelled once reserve answers, before any transfer.
    expect(await code("cancel-after-reserve", photo(), late.signal)).toBe(
      "aborted"
    )
    expect(counts()).toEqual([0, 0])

    // Handed to the server, then finalise throws or the file is refused.
    expect(await code("finalise-throws")).toBe("finalise_failed")
    expect(counts()).toEqual([0, 0])
    expect(await code("not-a-photo")).toBe("processing_failed")
    expect(counts()).toEqual([0, 0])

    // Nothing went below zero: a held reservation now counts as one.
    const held = upload(photo(), { idempotencyKey: "held" })
    await reserving.reached
    expect(counts()).toEqual([1, 1])
    reserving.open()
    expect((await held).state).toBe("ready")
    expect(counts()).toEqual([0, 0])
  })
})
