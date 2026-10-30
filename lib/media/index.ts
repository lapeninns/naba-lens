import sharp from "sharp"
import { open } from "node:fs/promises"
import { MEDIA_LIMITS } from "../config/media"
import { MediaError, view } from "./types"
import { processHeic } from "./heic"
import {
  probeVideo,
  VideoProbeError,
  parseFtyp,
  type VideoRangeSource,
} from "./video"
export { MediaError, probeVideo }
export type { VideoRangeSource }
export function sniffMedia(input: Uint8Array) {
  const b = view(input)
  const text = (a: number, z: number) => b.toString("latin1", a, z)
  const result = (
    mime: string,
    ext: string,
    kind: "image" | "video" = "image"
  ) => ({ mime, ext, kind })
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return result("image/jpeg", "jpg")
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return result("image/png", "png")
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP")
    return result("image/webp", "webp")
  if (b.length >= 16 && text(4, 8) === "ftyp") {
    const n = b.readUInt32BE(0)
    if (n < 16 || n > b.length || n % 4 !== 0) return null
    const major = text(8, 12)
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(major))
      return result("image/heic", "heic")
    if (["avif", "avis"].includes(major)) return null
    const mime = parseFtyp(b.subarray(8, n))
    if (mime) return result(mime, mime === "video/mp4" ? "mp4" : "mov", "video")
  }
  if (b.length >= 8 && text(4, 8) === "moov" && b.readUInt32BE(0) >= 8)
    return result("video/quicktime", "mov", "video")
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3)
    return result("video/webm", "webm", "video")
  return null
}
// Ambiguous browser labels are advisory, never the stored content type.
export function normalizeDeclaredMime(mime = "") {
  const value = mime.toLowerCase().split(";")[0].trim()
  if (
    [
      "",
      "application/octet-stream",
      "binary/octet-stream",
      "image/heif",
      "image/heic",
      "image/x-heic",
      "image/x-heif",
      "image/jpg",
      "image/pjpeg",
      "video/quicktime",
      "video/x-m4v",
    ].includes(value)
  )
    return undefined
  return [
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/webm",
  ].includes(value)
    ? value
    : undefined
}
function checkMime(declared: string, mime: string) {
  const known = normalizeDeclaredMime(declared)
  if (known && known !== mime) throw new MediaError("mime_mismatch")
}
function errorCode(e: unknown) {
  if (e instanceof MediaError || e instanceof VideoProbeError) return e.code
  const message = e instanceof Error ? e.message : ""
  return /pixel limit/i.test(message)
    ? "pixel_limit"
    : /timeout/i.test(message)
      ? "decode_timeout"
      : "corrupt_media"
}
// Reading an original is an operational step. Keep its failures separate from
// parser/decoder failures, which can safely reject the stored media as invalid.
class MediaSourceReadError extends Error {
  constructor(readonly sourceError: unknown) {
    super("Could not read media source")
  }
}
async function decodedImage(bytes: Uint8Array) {
  // A single full decode into raw oriented pixels; derivatives share those pixels.
  return sharp(view(bytes), {
    failOn: "warning",
    limitInputPixels: MEDIA_LIMITS.maxImagePixels,
  })
    .timeout({ seconds: MEDIA_LIMITS.imageTimeoutSeconds })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
}
export async function processImage(bytes: Uint8Array, declaredMime = "") {
  if (bytes.byteLength > MEDIA_LIMITS.maxPhotoBytes)
    throw new MediaError("file_too_large")
  const type = sniffMedia(bytes)
  if (!type || type.kind !== "image") throw new MediaError("unsupported_type")
  checkMime(declaredMime, type.mime)
  try {
    if (type.mime === "image/heic") {
      const r = await processHeic(bytes)
      return {
        preview: r.preview!,
        thumb: r.thumb!,
        width: r.width!,
        height: r.height!,
        ...type,
      }
    }
    const { data, info } = await decodedImage(bytes)
    const resize = (size: number) =>
      sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .timeout({ seconds: MEDIA_LIMITS.imageTimeoutSeconds })
        .resize({
          width: size,
          height: size,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp()
        .toBuffer()
    return {
      preview: await resize(MEDIA_LIMITS.previewPixels),
      thumb: await resize(MEDIA_LIMITS.thumbnailPixels),
      width: info.width,
      height: info.height,
      ...type,
    }
  } catch (e) {
    throw new MediaError(errorCode(e))
  }
}
export async function createImageDerivatives(bytes: Uint8Array, mime: string) {
  return processImage(bytes, mime)
}
export async function createAvatarDerivative(bytes: Uint8Array) {
  if (bytes.byteLength > MEDIA_LIMITS.maxAvatarBytes)
    throw new MediaError("file_too_large")
  const type = sniffMedia(bytes)
  if (!type || type.kind !== "image") throw new MediaError("unsupported_type")
  try {
    if (type.mime === "image/heic")
      return (await processHeic(bytes, true)).avatar!
    const { data, info } = await decodedImage(bytes)
    return sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .timeout({ seconds: MEDIA_LIMITS.imageTimeoutSeconds })
      .resize(MEDIA_LIMITS.avatarPixels, MEDIA_LIMITS.avatarPixels, {
        fit: "cover",
      })
      .webp()
      .toBuffer()
  } catch (e) {
    throw new MediaError(errorCode(e))
  }
}
export async function validateMedia(
  input: {
    bytes?: Uint8Array
    source?: VideoRangeSource | string
    size?: number
    declaredMime: string
    filename: string
  },
  limits: { maxPhotoBytes: number; maxVideoBytes: number } = MEDIA_LIMITS
) {
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file =
      typeof input.source === "string"
        ? await open(input.source, "r")
        : undefined
    const openedFile = file
    const rawSource: VideoRangeSource | undefined = openedFile
      ? {
          size: (await openedFile.stat()).size,
          read: async (offset, length) => {
            const b = Buffer.alloc(length)
            const r = await openedFile.read(b, 0, length, offset)
            return b.subarray(0, r.bytesRead)
          },
        }
      : typeof input.source === "object"
        ? input.source
        : undefined
    const source: VideoRangeSource | undefined = rawSource && {
      size: rawSource.size,
      read: async (offset, length) => {
        try {
          return await rawSource.read(offset, length)
        } catch (error) {
          // Also wrap RangeError: the video parser classifies its own bounds
          // errors as malformed metadata, but source I/O must remain retryable.
          throw new MediaSourceReadError(error)
        }
      },
    }
    const size = input.bytes?.byteLength ?? source?.size ?? input.size
    if (!size || !Number.isSafeInteger(size) || size < 0)
      return { ok: false as const, error: "invalid_size" }
    if (input.size !== undefined && input.size !== size)
      return { ok: false as const, error: "size_mismatch" }
    if (size > limits.maxVideoBytes)
      return { ok: false as const, error: "file_too_large" }
    if (!input.bytes && !source)
      return { ok: false as const, error: "bytes_required" }
    const head =
      input.bytes?.subarray(0, MEDIA_LIMITS.sniffHeadBytes) ??
      (await source!.read(0, Math.min(size, MEDIA_LIMITS.sniffHeadBytes)))
    if (head.byteLength !== Math.min(size, MEDIA_LIMITS.sniffHeadBytes))
      throw new MediaError("invalid_video")
    const type = sniffMedia(head)
    if (!type) return { ok: false as const, error: "unsupported_type" }
    checkMime(input.declaredMime, type.mime)
    if (type.kind === "image") {
      if (size > limits.maxPhotoBytes)
        return { ok: false as const, error: "file_too_large" }
      if (!input.bytes) return { ok: false as const, error: "bytes_required" }
      const processed = await processImage(input.bytes, input.declaredMime)
      return { ok: true as const, ...processed, size }
    }
    const probe = await probeVideo(input.bytes ?? source!)
    if (probe.mime !== type.mime) throw new MediaError("mime_mismatch")
    return { ok: true as const, ...type, ...probe, size }
  } catch (e) {
    if (e instanceof MediaSourceReadError) throw e.sourceError
    return { ok: false as const, error: errorCode(e) }
  } finally {
    await file?.close()
  }
}
