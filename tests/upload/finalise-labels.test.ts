// What finalise did with labels chosen while a file uploaded (C2) reaches the
// queue, the asset ID reaches it as soon as the server reserves it (so labels
// can be sent by asset ID, C1), and resume keys are kept per account (audit
// finding 15). No storage server: the bytes are already stored ("processing")
// or the transport is faked.
import { describe, expect, expectTypeOf, it, vi } from "vitest"

import type { QueueItem } from "../../components/nabalens/upload-queue"
import type { FinaliseLabels as ServerFinaliseLabels } from "../../lib/server/media/finalise"

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

describe("createUploader on a resumed asset an earlier finalise made ready", () => {
  // The tab closed while finalise ran: the server finished the photo, its
  // stored labels in needs_attention, and the browser kept the resume key.
  const attention: FinaliseLabels = {
    state: "needs_attention",
    code: "catalogue_changed",
    message: "The menu changed. Check the dish.",
  }
  function readyUploader(finalise: () => Promise<unknown>) {
    const calls = vi.fn(finalise)
    const upload = createUploader({
      reserve: async () => ({
        assetId: "asset-1",
        objectKey: "u/asset-1/original.jpg",
        bucket: "media",
        resumable: false,
        state: "ready",
      }),
      finalise: calls as never,
      supabaseUrl: "http://storage.invalid",
      getAccessToken: async () => "jwt",
      limits: LIMITS,
    })
    return { upload, calls }
  }

  it("reports labels left needing attention, so the row offers Fix labels", async () => {
    const { upload, calls } = readyUploader(async () => ({
      state: "ready",
      labels: attention,
    }))
    const result = await upload(photo(), { idempotencyKey: "k" })
    expect(calls).toHaveBeenCalledWith({
      assetId: "asset-1",
      idempotencyKey: "k",
    })
    expect(result).toEqual({
      assetId: "asset-1",
      state: "ready",
      labels: attention,
    })
  })

  it("is still ready, without labels, when that check gets no answer", async () => {
    const { upload } = readyUploader(async () => {
      throw new TypeError("Failed to fetch")
    })
    const result = await upload(photo(), { idempotencyKey: "k" })
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
    // A new key (nothing stored for this file): not a resumed upload.
    await vi.waitFor(() =>
      expect(reserved).toHaveBeenCalledWith("asset-7", false)
    )
    finish()
    await expect(running).resolves.toEqual({
      assetId: "asset-7",
      labels: SAVED,
    })
  })

  it("says the reservation is resumed when the file's stored key was reused (B3)", async () => {
    const keys: UploadKeyStore = {
      get: vi.fn(async () => "stored-key"),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    }
    const reserved = vi.fn()
    const upload: UploadFn = async (_file, options) => {
      expect(options.idempotencyKey).toBe("stored-key")
      options.onReserved?.({ assetId: "asset-9", resumable: false })
      return { assetId: "asset-9", state: "ready" }
    }
    await toQueueUploader(upload, { newKey: () => "key-new", keys })(
      photo(),
      context({ onReserved: reserved })
    )
    expect(reserved).toHaveBeenCalledWith("asset-9", true)
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

describe("resume keys of callers that do not name the account", () => {
  const SCOPED = { purpose: undefined, account: "user-2" }
  function store(): UploadKeyStore {
    return {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    }
  }
  const upload: UploadFn = async () => ({ assetId: "a", state: "ready" })

  it("keeps them for whoever is signed in", async () => {
    const keys = store()
    await toQueueUploader(upload, {
      newKey: () => "key-1",
      keys,
      account: async () => "user-2",
    })(photo(), context())
    expect(keys.get).toHaveBeenCalledWith(expect.any(File), SCOPED)
    expect(keys.set).toHaveBeenCalledWith(expect.any(File), "key-1", SCOPED)
    expect(keys.delete).toHaveBeenCalledWith(expect.any(File), SCOPED)
  })

  it("uses the account the caller names, without asking", async () => {
    const keys = store()
    const signedIn = vi.fn(async () => "user-2")
    await toQueueUploader(upload, { keys, account: signedIn })(
      photo(),
      context({ account: "user-1" })
    )
    expect(signedIn).not.toHaveBeenCalled()
    expect(keys.get).toHaveBeenCalledWith(expect.any(File), {
      purpose: undefined,
      account: "user-1",
    })
  })

  it("is unscoped when nobody is known to be signed in", async () => {
    for (const signedIn of [
      async () => null,
      async () => Promise.reject(new Error("offline")),
    ]) {
      const keys = store()
      await toQueueUploader(upload, { keys, account: signedIn })(
        photo(),
        context()
      )
      expect(keys.get).toHaveBeenCalledWith(expect.any(File), {
        purpose: undefined,
        account: undefined,
      })
    }
  })
})

describe("one FinaliseLabels shape (n3)", () => {
  it("the server's answer, the transport and the queue use the same type", () => {
    // lib/upload is client-only and cannot import the server module, so the
    // two declarations are held equal here; the queue uses lib/upload's.
    expectTypeOf<ServerFinaliseLabels>().toEqualTypeOf<FinaliseLabels>()
    expectTypeOf<
      NonNullable<QueueItem["labels"]>
    >().toEqualTypeOf<FinaliseLabels>()
  })
})
