// Spec §5.5: dark, blurred and small photos get a hint, never a block.
import { describe, expect, it } from "vitest"

import {
  BLURRY_BELOW,
  DARK_BELOW,
  measureGrey,
  qualityHints,
} from "@/lib/upload/quality"

const big = { width: 4032, height: 3024 }

describe("qualityHints", () => {
  it("says nothing about a bright, sharp, large photo", () => {
    expect(qualityHints({ ...big, brightness: 140, sharpness: 900 })).toEqual(
      []
    )
  })

  it("says dark, not blurred too, for a dark photo", () => {
    expect(
      qualityHints({ ...big, brightness: DARK_BELOW - 1, sharpness: 5 })
    ).toEqual(["dark"])
  })

  it("says blurred for a soft photo", () => {
    expect(
      qualityHints({ ...big, brightness: 120, sharpness: BLURRY_BELOW - 1 })
    ).toEqual(["blurry"])
  })

  it("says small under 1600 pixels on the long edge, and not at it", () => {
    expect(
      qualityHints({
        width: 1200,
        height: 900,
        brightness: 120,
        sharpness: 500,
      })
    ).toEqual(["small"])
    expect(
      qualityHints({
        width: 1600,
        height: 900,
        brightness: 120,
        sharpness: 500,
      })
    ).toEqual([])
  })

  it("says nothing when the photo could not be measured", () => {
    expect(qualityHints(null)).toEqual([])
    expect(
      qualityHints({ width: 0, height: 0, brightness: 0, sharpness: 0 })
    ).toEqual([])
  })
})

describe("measureGrey", () => {
  it("reads a flat grey as no edges and its own brightness", () => {
    const flat = new Uint8Array(16 * 16).fill(30)
    expect(measureGrey(flat, 16, 16)).toEqual({ brightness: 30, sharpness: 0 })
  })

  it("reads a checkerboard as sharp", () => {
    const w = 16
    const board = Uint8Array.from({ length: w * w }, (_, i) =>
      (Math.floor(i / w) + (i % w)) % 2 ? 255 : 0
    )
    const m = measureGrey(board, w, w)
    expect(m.brightness).toBeCloseTo(127.5, 0)
    expect(m.sharpness).toBeGreaterThan(BLURRY_BELOW * 100)
  })

  it("copes with an empty image", () => {
    expect(measureGrey([], 0, 0)).toEqual({ brightness: 0, sharpness: 0 })
  })
})
