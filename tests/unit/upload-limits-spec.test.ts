// Full App spec §12.1 launch limits (S1-UPLOAD): photos 25 MiB, videos
// 250 MiB and 60 s, 20 files per batch, a 1600 px public-quality target that
// is advisory only, and the video length rule finalise applies.
import { describe, expect, it } from "vitest"

import {
  belowPublicQuality,
  MEDIA_LIMITS,
  MEDIA_PIPELINE_VERSION,
} from "@/lib/config/media"
import { validationMessage } from "@/lib/server/media/errors"
import { tooLong } from "@/lib/server/media/finalise"
import { JOURNAL_LIMITS } from "@/lib/upload/journal"

const MiB = 1024 * 1024

describe("media limits", () => {
  it("match the spec's launch defaults", () => {
    expect(MEDIA_LIMITS.maxPhotoBytes).toBe(25 * MiB)
    expect(MEDIA_LIMITS.maxVideoBytes).toBe(250 * MiB)
    expect(MEDIA_LIMITS.maxVideoSeconds).toBe(60)
    expect(MEDIA_LIMITS.maxBatchFiles).toBe(20)
    expect(MEDIA_LIMITS.maxParallelUploads).toBe(2)
    expect(MEDIA_LIMITS.publicQualityLongEdgePx).toBe(1600)
    // The device journal keeps any photo the server would take.
    expect(JOURNAL_LIMITS.maxPhotoBytes).toBe(MEDIA_LIMITS.maxPhotoBytes)
    expect(MEDIA_PIPELINE_VERSION).toMatch(/^img-/)
  })
})

describe("tooLong", () => {
  it("refuses a video over 60 s, with half a second for phone rounding", () => {
    expect(tooLong(undefined)).toBe(false)
    expect(tooLong(12)).toBe(false)
    expect(tooLong(60.04)).toBe(false)
    expect(tooLong(60.5)).toBe(false)
    expect(tooLong(60.6)).toBe(true)
    expect(tooLong(600)).toBe(true)
  })
  it("tells the person what to do", () => {
    expect(validationMessage("video_too_long")).toBe(
      "Videos can be up to 60 seconds. Trim it on your phone, then add it again."
    )
  })
})

describe("belowPublicQuality", () => {
  it("flags a long edge under 1600 px, and never an unknown size", () => {
    expect(belowPublicQuality(1599, 900)).toBe(true)
    expect(belowPublicQuality(900, 1600)).toBe(false)
    expect(belowPublicQuality(4032, 3024)).toBe(false)
    expect(belowPublicQuality(null, null)).toBe(false)
    expect(belowPublicQuality(0, 800)).toBe(false)
  })
})
