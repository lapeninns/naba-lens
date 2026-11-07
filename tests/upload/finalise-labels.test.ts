// What finalise did with labels chosen while a file uploaded (C2) reaches the
// queue, the asset ID reaches it as soon as the server reserves it (so labels
// can be sent by asset ID, C1), and resume keys are kept per account (audit
// finding 15). No storage server: the bytes are already stored ("processing")
// or the transport is faked.
import { describe, expect, it, vi } from "vitest"

import {
  createUploader,
  toQueueUploader,
  type FinaliseLabels,
  type UploadContext,
  type UploadFn,
  type UploadKeyStore,
} from "../../lib/upload"
import { EMPTY_LABEL_SUMMARY } from "../../lib/menus/types"

const LIMITS = {
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

const photo = () =>
  new File([new Uint8Array(64)], "dish.jpg", { type: "image/jpeg" })

const SAVED: FinaliseLabels = {
  state: "saved",
  labels: { ...EMPTY_LABEL_SUMMARY, revision: 1, hasLabels: true },
}

function context(overrides: Partial<UploadContext> = {}): UploadContext {
  return {
    signal: new AbortController().signal,
    onProgress: () => {},
    onProcessing: () => {},
    resumeToken: undefined,
    setResumeToken: () => {},
    attempt: 1,
    ...overrides,
  }
}

describe("createUploader passes finalise's labels on", () => {
  function uploaderWith(finaliseLabels?: FinaliseLabels) {
    return createUploader({
      // The bytes are already stored: no transfer, straight to finalise.
      reserve: async () => ({
        assetId: "asset-1",
        objectKey: "u/asset-1/original.jpg",
        bucket: "media",
        resumable: false,
        state: "processing",
      }),
      finalise: async () =>
        finaliseLabels
          ? { state: "ready", labels: finaliseLabels }
          : { state: "ready" },
      supabaseUrl: "http://storage.invalid",
      getAccessToken: async () => "jwt",
      limits: LIMITS,
    })
  }

  it("returns labels when finalise applied kept labels", async () => {
    const result = await uploaderWith(SAVED)(photo(), { idempotencyKey: "k" })
    expect(result).toEqual({
      assetId: "asset-1",
      state: "ready",
      labels: SAVED,
    })
  })

  it("returns a needs-attention answer as it came", async () => {
    const attention: FinaliseLabels = {
      state: "needs_attention",
      code: "catalogue_changed",
      message: "The menu changed. Check the dish.",
    }
    const result = await uploaderWith(attention)(photo(), {
      idempotencyKey: "k",
    })
    expect(result.labels).toEqual(attention)
  })

  it("has no labels field when nothing was kept", async () => {
    const result = await uploaderWith()(photo(), { idempotencyKey: "k" })
    expect(result).toEqual({ assetId: "asset-1", state: "ready" })
  })
})

describe("toQueueUploader", () => {
  it("reports the reserved asset ID before the file is done, and the finalise labels after", async () => {
    let finish = () => {}
    const reserved = vi.fn()
    const upload: UploadFn = async (_file, options) => {
      options.onReserved?.({ assetId: "asset-7", resumable: false })
      await new Promise<void>((resolve) => (finish = resolve))
      return { assetId: "asset-7", state: "ready", labels: SAVED }
    }
    const running = toQueueUploader(upload, { newKey: () => "key-1" })(
      photo(),
      context({ onReserved: reserved })
    )
    await vi.waitFor(() => expect(reserved).toHaveBeenCalledWith("asset-7"))
    finish()
    await expect(running).resolves.toEqual({
      assetId: "asset-7",
      labels: SAVED,
    })
  })

  it("keeps resume keys per account and purpose", async () => {
    const keys: UploadKeyStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    }
    const upload: UploadFn = async () => ({ assetId: "a", state: "ready" })
    await toQueueUploader(upload, { newKey: () => "key-1", keys })(
      photo(),
      context({ account: "user-1", purpose: "amenity" })
    )
    expect(keys.get).toHaveBeenCalledWith(expect.any(File), {
      purpose: "amenity",
      account: "user-1",
    })
    expect(keys.set).toHaveBeenCalledWith(expect.any(File), "key-1", {
      purpose: "amenity",
      account: "user-1",
    })
    expect(keys.delete).toHaveBeenCalledWith(expect.any(File), {
      purpose: "amenity",
      account: "user-1",
    })
  })
})
