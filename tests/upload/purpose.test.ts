// The upload purpose travels from the queue context to the reserve call
// (media_assets.purpose; amenity evidence stays out of the community). The
// reservation is refused after it is recorded, so no transfer runs.
import { describe, expect, it } from "vitest"

import {
  createUploader,
  toQueueUploader,
  type ReserveInput,
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
  new File([new Uint8Array(1024)], "wifi.jpg", { type: "image/jpeg" })

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
