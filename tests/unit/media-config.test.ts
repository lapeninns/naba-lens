import { describe, expect, expectTypeOf, it } from "vitest"

import type { UploadLimits } from "@/components/nabalens"

import {
  abandonedUploadInterval,
  maxBytesFor,
  MEDIA_LIMITS,
} from "@/lib/config/media"
import {
  avatarObjectKey,
  mediaObjectKeys,
  STORAGE_BUCKETS,
} from "@/lib/config/storage"

const MiB = 1024 * 1024

describe("MEDIA_LIMITS (spec v0.2 §5)", () => {
  it("matches the chosen product limits", () => {
    expect(MEDIA_LIMITS).toMatchObject({
      maxBatchFiles: 10,
      maxParallelUploads: 2,
      maxPhotoBytes: 20 * MiB,
      maxVideoBytes: 200 * MiB,
      maxAvatarBytes: 4 * MiB,
      signedUrlExpirySeconds: 60,
      pageSize: 24,
      abandonedUploadWindowHours: 24,
    })
  })

  it("can be passed straight to the UI kit's upload limits", () => {
    expectTypeOf(MEDIA_LIMITS).toExtend<UploadLimits>()
  })

  it("picks the per-kind byte limit", () => {
    expect(maxBytesFor("image")).toBe(20 * MiB)
    expect(maxBytesFor("video")).toBe(200 * MiB)
  })

  it("formats the abandoned window as a Postgres interval", () => {
    expect(abandonedUploadInterval()).toBe("24 hours")
  })
})

describe("storage keys", () => {
  const uploader = "11111111-1111-4111-8111-111111111111"
  const asset = "22222222-2222-4222-8222-222222222222"

  it("derives media keys from server IDs", () => {
    expect(mediaObjectKeys(uploader, asset, ".JPG")).toEqual({
      original: `${uploader}/${asset}/original.jpg`,
      preview: `${uploader}/${asset}/preview.webp`,
      thumbnail: `${uploader}/${asset}/thumb.webp`,
    })
  })

  it("rejects extensions that could escape the key shape", () => {
    expect(() => mediaObjectKeys(uploader, asset, "../x")).toThrow()
    expect(() => mediaObjectKeys(uploader, asset, "")).toThrow()
  })

  it("builds avatar keys inside the user's folder", () => {
    expect(avatarObjectKey(uploader, asset)).toBe(`${uploader}/${asset}.webp`)
    expect(STORAGE_BUCKETS).toEqual({ media: "media", avatars: "avatars" })
  })
})
