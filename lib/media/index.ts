import sharp from "sharp"
import decodeHeic from "heic-decode"
import { MEDIA_LIMITS } from "../config/media"
export { probeVideo } from "./video"
export class MediaError extends Error {
  constructor(public code: string) {
    super(code)
  }
}
export function sniffMedia(input: Uint8Array) {
  const b = Buffer.from(input)
  const s = (a: number, z: number) => b.toString("latin1", a, z)
  const result = (
    mime: string,
    ext: string,
    kind: "image" | "video" = "image"
  ) => ({ mime, ext, kind })
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return result("image/jpeg", "jpg")
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return result("image/png", "png")
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP")
    return result("image/webp", "webp")
  if (b.length >= 16 && s(4, 8) === "ftyp") {
    const n = b.readUInt32BE(0)
    if (n < 16 || n > b.length) return null
    const brands = [s(8, 12)]
    for (let i = 16; i + 4 <= n; i += 4) brands.push(s(i, i + 4))
    if (
      brands.some((x) =>
        ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(x)
      )
    )
      return result("image/heic", "heic")
    if (brands.includes("qt  "))
      return result("video/quicktime", "mov", "video")
    if (
      brands.some((x) =>
        [
          "isom",
          "iso2",
          "iso3",
          "iso4",
          "iso5",
          "iso6",
          "mp41",
          "mp42",
          "avc1",
          "M4V ",
          "dash",
        ].includes(x)
      )
    )
      return result("video/mp4", "mp4", "video")
  }
  if (
    b.length >= 8 &&
    s(4, 8) === "moov" &&
    b.readUInt32BE(0) >= 8 &&
    b.readUInt32BE(0) <= b.length
  )
    return result("video/quicktime", "mov", "video")
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3)
    return result("video/webm", "webm", "video")
  return null
}
async function image(bytes: Uint8Array) {
  if (bytes.length > MEDIA_LIMITS.maxPhotoBytes)
    throw new MediaError("file_too_large")
  const type = sniffMedia(bytes)
  if (!type || type.kind !== "image") throw new MediaError("unsupported_type")
  if (type.mime === "image/heic") {
    const frames = await decodeHeic.all({ buffer: bytes })
    try {
      const first = frames[0]
      if (!first || first.width * first.height > 40_000_000)
        throw new MediaError("pixel_limit")
      const decoded = await first.decode()
      return sharp(
        Buffer.from(
          decoded.data.buffer,
          decoded.data.byteOffset,
          decoded.data.byteLength
        ),
        { raw: { width: decoded.width, height: decoded.height, channels: 4 } }
      ).rotate()
    } finally {
      frames.dispose()
    }
  }
  return sharp(Buffer.from(bytes), {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  }).rotate()
}
export async function createImageDerivatives(bytes: Uint8Array, mime: string) {
  const type = sniffMedia(bytes)
  if (type?.mime !== (mime === "image/heif" ? "image/heic" : mime))
    throw new MediaError("mime_mismatch")
  const source = await image(bytes)
  const { info } = await source.clone().toBuffer({ resolveWithObject: true })
  return {
    preview: await source
      .clone()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp()
      .toBuffer(),
    thumb: await source
      .clone()
      .resize({
        width: 480,
        height: 480,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp()
      .toBuffer(),
    width: info.width,
    height: info.height,
  }
}
export async function createAvatarDerivative(bytes: Uint8Array) {
  if (bytes.length > MEDIA_LIMITS.maxAvatarBytes)
    throw new MediaError("file_too_large")
  return (await image(bytes))
    .resize(256, 256, { fit: "cover" })
    .webp()
    .toBuffer()
}
export async function validateMedia(
  input: {
    bytes?: Uint8Array
    size?: number
    declaredMime: string
    filename: string
  },
  limits: { maxPhotoBytes: number; maxVideoBytes: number } = MEDIA_LIMITS
) {
  const size = input.bytes?.length ?? input.size
  if (!size || !Number.isSafeInteger(size) || size < 0)
    return { ok: false as const, error: "invalid_size" }
  if (size > limits.maxVideoBytes)
    return { ok: false as const, error: "file_too_large" }
  if (!input.bytes) return { ok: false as const, error: "bytes_required" }
  if (input.size !== undefined && input.size !== size)
    return { ok: false as const, error: "size_mismatch" }
  const type = sniffMedia(input.bytes)
  if (!type) return { ok: false as const, error: "unsupported_type" }
  if (
    size > (type.kind === "image" ? limits.maxPhotoBytes : limits.maxVideoBytes)
  )
    return { ok: false as const, error: "file_too_large" }
  if (
    input.declaredMime.toLowerCase().split(";")[0].trim() !== type.mime &&
    !(type.mime === "image/heic" && input.declaredMime === "image/heif")
  )
    return { ok: false as const, error: "mime_mismatch" }
  try {
    if (type.kind === "image") await (await image(input.bytes)).toBuffer()
    else {
      const { probeVideo } = await import("./video")
      await probeVideo(input.bytes)
    }
    return { ok: true as const, ...type, size }
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof MediaError ? e.code : "corrupt_media",
    }
  }
}
