import { describe, expect, it } from "vitest"

import {
  summarize,
  UploadQueue,
  type UploadContext,
  type Uploader,
} from "@/components/nabalens/upload-queue"

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

function file(name: string, size = 1024, type = "image/jpeg") {
  return new File([new Uint8Array(size)], name, { type })
}

/** Fake uploader whose calls are resolved or rejected by the test. */
function controllableUploader() {
  const calls: {
    file: File
    ctx: UploadContext
    resolve: () => void
    reject: (e: unknown) => void
  }[] = []
  const upload: Uploader = (f, ctx) =>
    new Promise<void>((resolve, reject) => {
      ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))
      calls.push({ file: f, ctx, resolve, reject })
    })
  return { upload, calls }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function statuses(queue: UploadQueue) {
  return queue.getSnapshot().map((i) => `${i.file.name}:${i.status}`)
}

describe("UploadQueue", () => {
  it("keeps selected files until start and allows removing them", () => {
    const { upload, calls } = controllableUploader()
    const queue = new UploadQueue(upload, LIMITS)
    queue.add([file("a.jpg"), file("b.jpg")])
    expect(statuses(queue)).toEqual(["a.jpg:selected", "b.jpg:selected"])
    queue.remove(queue.getSnapshot()[0].id)
    expect(statuses(queue)).toEqual(["b.jpg:selected"])
    expect(calls).toHaveLength(0)
  })

  it("runs at most maxParallelUploads transfers at once", async () => {
    const { upload, calls } = controllableUploader()
    const queue = new UploadQueue(upload, LIMITS)
    queue.add([file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg")])
    queue.start()
    expect(calls.map((c) => c.file.name)).toEqual(["a.jpg", "b.jpg"])
    expect(statuses(queue)).toEqual([
      "a.jpg:uploading",
      "b.jpg:uploading",
      "c.jpg:queued",
      "d.jpg:queued",
    ])

    calls[0].resolve()
    await flush()
    expect(calls.map((c) => c.file.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"])
    expect(summarize(queue.getSnapshot())).toMatchObject({ done: 1, active: 3 })
  })

  it("reports progress, then processing, then done", async () => {
    const { upload, calls } = controllableUploader()
    const queue = new UploadQueue(upload, LIMITS)
    queue.add([file("a.jpg")])
    queue.start()
    calls[0].ctx.onProgress(0.4)
    expect(queue.getSnapshot()[0]).toMatchObject({ status: "uploading", progress: 0.4 })
    calls[0].ctx.onProcessing()
    expect(queue.getSnapshot()[0].status).toBe("processing")
    calls[0].resolve()
    await flush()
    expect(queue.getSnapshot()[0]).toMatchObject({ status: "done", progress: 1 })
  })

  it("isolates a failure and retries with the stored resume token", async () => {
    const { upload, calls } = controllableUploader()
    const queue = new UploadQueue(upload, LIMITS)
    queue.add([file("photo.jpg"), file("clip.mp4", 2048, "video/mp4")])
    queue.start()
    calls[0].resolve()
    calls[1].ctx.setResumeToken("asset-123")
    calls[1].reject(new Error("Validation failed"))
    await flush()
    expect(statuses(queue)).toEqual(["photo.jpg:done", "clip.mp4:failed"])
    expect(queue.getSnapshot()[1].error).toBe("Validation failed")

    queue.retry(queue.getSnapshot()[1].id)
    expect(calls).toHaveLength(3)
    expect(calls[2].ctx.resumeToken).toBe("asset-123")
    expect(calls[2].ctx.attempt).toBe(2)
    calls[2].resolve()
    await flush()
    expect(statuses(queue)).toEqual(["photo.jpg:done", "clip.mp4:done"])
  })

  it("cancels queued and running files and moves on to the next", async () => {
    const { upload, calls } = controllableUploader()
    const queue = new UploadQueue(upload, LIMITS)
    queue.add([file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg")])
    queue.start()
    const [a, , c] = queue.getSnapshot()
    queue.cancel(c.id)
    queue.cancel(a.id)
    expect(calls[0].ctx.signal.aborted).toBe(true)
    await flush()
    expect(statuses(queue)).toEqual([
      "a.jpg:cancelled",
      "b.jpg:uploading",
      "c.jpg:cancelled",
      "d.jpg:uploading",
    ])
    // A late progress callback from the cancelled run is ignored.
    calls[0].ctx.onProgress(0.9)
    expect(queue.getSnapshot()[0].status).toBe("cancelled")
  })

  it("rejects unsupported, oversized, empty and over-limit files", () => {
    const { upload } = controllableUploader()
    const queue = new UploadQueue(upload, { ...LIMITS, maxBatchFiles: 2 })
    const result = queue.add([
      file("notes.pdf", 10, "application/pdf"),
      file("huge.jpg", LIMITS.maxPhotoBytes + 1),
      file("empty.png", 0, "image/png"),
      file("one.heic", 10, ""),
      file("two.mov", 10, ""),
      file("three.jpg"),
    ])
    expect(result.added).toBe(2)
    expect(result.rejected.map((r) => r.name)).toEqual([
      "notes.pdf",
      "huge.jpg",
      "empty.png",
      "three.jpg",
    ])
    expect(result.rejected[1].reason).toMatch(/up to 20 MB/)
    expect(result.rejected[3].reason).toMatch(/up to 2 files/)
    expect(queue.getSnapshot().map((i) => i.kind)).toEqual(["image", "video"])
  })

  it("does not count finished files against the batch limit", async () => {
    const { upload, calls } = controllableUploader()
    const queue = new UploadQueue(upload, { ...LIMITS, maxBatchFiles: 1 })
    queue.add([file("a.jpg")])
    queue.start()
    calls[0].resolve()
    await flush()
    expect(queue.add([file("b.jpg")]).added).toBe(1)
  })
})
