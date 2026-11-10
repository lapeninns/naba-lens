// A finalise the server refused (403, e.g. a manager account's venue access
// ended) fails for good: no Retry. Any other finalise failure, a 503
// included, stays retryable. Keyed on the status, never the message.
import { describe, expect, it } from "vitest"

import {
  createUploader,
  FinaliseRefusedError,
  type FinaliseFn,
} from "../../lib/upload"

const LIMITS = {
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}

const ENDED =
  "Your venue manager access has ended, so this upload can't be finished."
const UNCHECKED = "Could not check this file right now. Try again."

const photo = () =>
  new File([new Uint8Array(64)], "dish.jpg", { type: "image/jpeg" })

function uploaderWith(finalise: FinaliseFn) {
  return createUploader({
    // The bytes are already stored: no transfer, straight to finalise.
    reserve: async () => ({
      assetId: "asset-1",
      objectKey: "u/asset-1/original.jpg",
      bucket: "media",
      resumable: false,
      state: "processing",
    }),
    finalise,
    supabaseUrl: "http://storage.invalid",
    getAccessToken: async () => "jwt",
    limits: LIMITS,
  })
}

describe("a refused finalise", () => {
  it("fails for good with the server's words", async () => {
    const result = await uploaderWith(async () => {
      throw new FinaliseRefusedError(ENDED)
    })(photo(), { idempotencyKey: "k" })
    expect(result).toEqual({
      assetId: "asset-1",
      state: "failed",
      error: { code: "finalise_refused", message: ENDED, retryable: false },
    })
  })

  it("any other failure (the 503) stays retryable", async () => {
    const result = await uploaderWith(async () => {
      throw new Error(UNCHECKED)
    })(photo(), { idempotencyKey: "k" })
    expect(result.error).toEqual({
      code: "finalise_failed",
      message: UNCHECKED,
      retryable: true,
    })
  })
})
