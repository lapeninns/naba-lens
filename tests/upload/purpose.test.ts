// The upload purpose travels from the queue context to the reserve call
// (media_assets.purpose; amenity evidence stays out of the community). The
// reservation is refused after it is recorded, so no transfer runs.
import { describe, expect, it } from "vitest"

import {
  createUploader,
  fileIdentity,
  localUploadKeyStore,
  ReservationGoneError,
  toQueueUploader,
  type ReserveInput,
  type UploadKeyStore,
  type UploadPurpose,
} from "../../lib/upload"

function queueUploader(calls: ReserveInput[]) {
  return toQueueUploader(
    createUploader({
      reserve: async (input) => {
        calls.push(input)
        throw new Error("stop after reserve")
      },
      finalise: async () => ({ state: "ready" }),
      supabaseUrl: "http://storage.invalid",
      getAccessToken: async () => "user-jwt",
      limits: {
        maxPhotoBytes: 20 * 1024 * 1024,
        maxVideoBytes: 200 * 1024 * 1024,
      },
      retryDelays: [],
    }),
    { newKey: () => "purpose-key-1" }
  )
}

const photo = () =>
  new File([new Uint8Array(1024)], "wifi.jpg", {
    type: "image/jpeg",
    lastModified: 1_700_000_000_000,
  })

function context(purpose?: UploadPurpose) {
  return {
    signal: new AbortController().signal,
    onProgress: () => {},
    onProcessing: () => {},
    resumeToken: undefined,
    setResumeToken: () => {},
    attempt: 1,
    ...(purpose ? { purpose } : {}),
  }
}

describe("upload purpose", () => {
  it("sends the context's purpose with the reservation", async () => {
    const calls: ReserveInput[] = []
    await expect(
      queueUploader(calls)(photo(), context("amenity"))
    ).rejects.toThrow()
    expect(calls).toHaveLength(1)
    expect(calls[0].purpose).toBe("amenity")
  })

  it("leaves purpose out when the context has none (server default: general)", async () => {
    const calls: ReserveInput[] = []
    await expect(queueUploader(calls)(photo(), context())).rejects.toThrow()
    expect(calls).toHaveLength(1)
    expect("purpose" in calls[0]).toBe(false)
  })
})

// A saved key is matched per purpose, and a key the server refuses for this
// purpose (reserve_media_asset's reservation_purpose_mismatch, a 404 that the
// app's reserve turns into ReservationGoneError) is discarded so the retry
// reserves a new asset with the requested purpose.
describe("saved upload keys and purpose", () => {
  function memoryStorage() {
    const map = new Map<string, string>()
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    }
  }

  /** reserve_media_asset's key rules: one purpose per key, fixed at reservation. */
  function fakeServer() {
    const purposes = new Map<string, UploadPurpose>()
    const calls: ReserveInput[] = []
    let interrupt = false
    const reserve = async (input: ReserveInput) => {
      calls.push(input)
      const purpose = input.purpose ?? "general"
      const existing = purposes.get(input.idempotencyKey)
      if (existing && existing !== purpose) {
        throw new ReservationGoneError(
          "This unfinished upload was started somewhere else."
        )
      }
      purposes.set(input.idempotencyKey, purpose)
      if (interrupt) throw new Error("Network error")
      return {
        assetId: `asset-${input.idempotencyKey}`,
        objectKey: `u/asset-${input.idempotencyKey}/original.jpg`,
        bucket: "media" as const,
        resumable: false,
        state: "ready" as const,
      }
    }
    return {
      calls,
      purposes,
      reserve,
      interrupt: (value: boolean) => void (interrupt = value),
    }
  }

  let n = 0
  /** A page load: new uploader and queue, same browser key store. */
  function queue(server: ReturnType<typeof fakeServer>, keys: UploadKeyStore) {
    return toQueueUploader(
      createUploader({
        reserve: server.reserve,
        finalise: async () => ({ state: "ready" }),
        supabaseUrl: "http://storage.invalid",
        getAccessToken: async () => "user-jwt",
        limits: {
          maxPhotoBytes: 20 * 1024 * 1024,
          maxVideoBytes: 200 * 1024 * 1024,
        },
        retryDelays: [],
      }),
      { newKey: () => `fresh-key-${++n}`, keys }
    )
  }

  /** One queue item: the resume token survives between attempts. */
  function item(purpose?: UploadPurpose) {
    let token: unknown
    let attempt = 0
    return (upload: ReturnType<typeof queue>) =>
      upload(photo(), {
        signal: new AbortController().signal,
        onProgress: () => {},
        onProcessing: () => {},
        resumeToken: token,
        setResumeToken: (value) => void (token = value),
        attempt: ++attempt,
        ...(purpose ? { purpose } : {}),
      })
  }

  /** A store that, like the one before purposes, matches by file only. */
  function purposeBlindStore(): UploadKeyStore & { keys: Map<string, string> } {
    const keys = new Map<string, string>()
    return {
      keys,
      get: async (file) => keys.get(file.name) ?? null,
      set: async (file, key) => void keys.set(file.name, key),
      delete: async (file) => void keys.delete(file.name),
    }
  }

  const sent = (server: ReturnType<typeof fakeServer>) =>
    server.calls.map((c) => [c.idempotencyKey, c.purpose ?? "general"])

  it("keeps separate keys per purpose; general keeps the original identity", async () => {
    const store = localUploadKeyStore({ storage: memoryStorage() })
    await store.set(photo(), "general-key")
    expect(await store.get(photo())).toBe("general-key")
    expect(await store.get(photo(), "general")).toBe("general-key")
    expect(await store.get(photo(), "amenity")).toBeNull()
    await store.set(photo(), "amenity-key", "amenity")
    expect(await store.get(photo(), "amenity")).toBe("amenity-key")
    await store.delete(photo(), "amenity")
    expect(await store.get(photo())).toBe("general-key")
    expect(await fileIdentity(photo(), "general")).toBe(
      await fileIdentity(photo())
    )
  })

  it("an interrupted portfolio upload is not resumed as amenity evidence", async () => {
    n = 0
    const server = fakeServer()
    const keys = localUploadKeyStore({ storage: memoryStorage() })
    server.interrupt(true)
    await expect(item()(queue(server, keys))).rejects.toThrow()
    server.interrupt(false)

    // The same file chosen from the amenity form: its own key, never the
    // portfolio upload's.
    await expect(item("amenity")(queue(server, keys))).resolves.toEqual({
      assetId: "asset-fresh-key-2",
    })
    expect(sent(server)).toEqual([
      ["fresh-key-1", "general"],
      ["fresh-key-2", "amenity"],
    ])
    // The portfolio upload still resumes with its own key.
    await expect(item()(queue(server, keys))).resolves.toEqual({
      assetId: "asset-fresh-key-1",
    })
  })

  it("a key the server refuses for this purpose is discarded; the retry reserves a new asset", async () => {
    for (const [first, second] of [
      ["amenity", "general"],
      ["general", "amenity"],
    ] as const) {
      n = 0
      const server = fakeServer()
      const keys = purposeBlindStore()
      server.interrupt(true)
      await expect(item(first)(queue(server, keys))).rejects.toThrow()
      server.interrupt(false)
      expect(keys.keys.get("wifi.jpg")).toBe("fresh-key-1")

      const resumed = item(second)
      const upload = queue(server, keys)
      await expect(resumed(upload)).rejects.toMatchObject({
        error: { code: "reservation_gone" },
      })
      expect(keys.keys.has("wifi.jpg")).toBe(false)
      await expect(resumed(upload)).resolves.toEqual({
        assetId: "asset-fresh-key-2",
      })
      expect(sent(server)).toEqual([
        ["fresh-key-1", first],
        ["fresh-key-1", second],
        ["fresh-key-2", second],
      ])
      // The first reservation keeps its purpose; the new asset has the
      // requested one.
      expect(server.purposes.get("fresh-key-1")).toBe(first)
      expect(server.purposes.get("fresh-key-2")).toBe(second)
    }
  })
})
