/*
 * Advisory photo checks before sending (spec §5.5, §12.1): dark, blurred or
 * small. They only ever give feedback: nothing here stops a photo being sent,
 * because a useful but imperfect photo is still evidence. The measures are
 * cheap and run in the browser on a small copy of the photo; a photo the
 * browser cannot decode (HEIC on most desktops) simply gets no hint.
 *
 * `qualityHints` is pure (tests/unit/upload-quality.test.ts); `measurePhoto`
 * needs a browser with createImageBitmap and a 2D canvas.
 */

import { MEDIA_LIMITS } from "@/lib/config/media"

export type PhotoMeasures = {
  /** The photo's own pixel size, before any downscale. */
  width: number
  height: number
  /** Mean luma, 0 (black) to 255 (white), on the small copy. */
  brightness: number
  /** Variance of the Laplacian on the small copy: low means few edges. */
  sharpness: number
}

export type QualityHint = "dark" | "blurry" | "small"

/** Below this mean luma a photo reads as dark (about 22% grey). */
export const DARK_BELOW = 56
/** Below this Laplacian variance a photo reads as blurred. */
export const BLURRY_BELOW = 60
/** The long edge of the copy the measures are taken on. */
export const MEASURE_EDGE = 256

/** The hints for one photo, most useful first. Never blocking. */
export function qualityHints(m: PhotoMeasures | null): QualityHint[] {
  if (!m || m.width <= 0 || m.height <= 0) return []
  const hints: QualityHint[] = []
  if (m.brightness < DARK_BELOW) hints.push("dark")
  // A dark photo has few edges anyway; say dark, not both.
  else if (m.sharpness < BLURRY_BELOW) hints.push("blurry")
  if (Math.max(m.width, m.height) < MEDIA_LIMITS.publicQualityLongEdgePx)
    hints.push("small")
  return hints
}

/**
 * Brightness and sharpness of greyscale pixels (row-major, one byte each).
 * Pure, so the browser measure and the tests share it.
 */
export function measureGrey(
  grey: ArrayLike<number>,
  width: number,
  height: number
): { brightness: number; sharpness: number } {
  const n = width * height
  if (n === 0) return { brightness: 0, sharpness: 0 }
  let sum = 0
  for (let i = 0; i < n; i += 1) sum += grey[i]
  let lapSum = 0
  let lapSq = 0
  let count = 0
  for (let y = 1; y < height - 1; y += 1)
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      const lap =
        grey[i - width] +
        grey[i + width] +
        grey[i - 1] +
        grey[i + 1] -
        4 * grey[i]
      lapSum += lap
      lapSq += lap * lap
      count += 1
    }
  const mean = count ? lapSum / count : 0
  return {
    brightness: sum / n,
    sharpness: count ? lapSq / count - mean * mean : 0,
  }
}

/** Measures one photo in the browser; null when it cannot be decoded. */
export async function measurePhoto(file: Blob): Promise<PhotoMeasures | null> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  )
    return null
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    const scale = Math.min(1, MEASURE_EDGE / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return null
    context.drawImage(bitmap, 0, 0, w, h)
    const { data } = context.getImageData(0, 0, w, h)
    const grey = new Uint8ClampedArray(w * h)
    for (let i = 0, p = 0; i < grey.length; i += 1, p += 4)
      grey[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    return { width, height, ...measureGrey(grey, w, h) }
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}
