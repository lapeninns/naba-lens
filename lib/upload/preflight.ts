// Early client-side checks for useful feedback before any network call. The
// server validates the real content; these checks are never a security control.

import type { ClientUploadLimits, MediaKind, UploadError } from "./types"

export const DEFAULT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const

export const DEFAULT_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const

// Phones sometimes send HEIC/MOV with an empty or generic MIME type, so fall
// back to the extension. Mapped to the MIME type it implies.
const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
}

const GENERIC_TYPES = ["", "application/octet-stream"]

function mib(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/** Best-effort MIME type: the browser's value, else one implied by the extension. */
export function guessContentType(file: File): string {
  const type = file.type.toLowerCase()
  if (!GENERIC_TYPES.includes(type)) return type
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSION_TYPES[ext] ?? type
}

export function guessMediaKind(
  file: File,
  limits: ClientUploadLimits
): MediaKind | null {
  const type = guessContentType(file)
  const images = limits.acceptedImageTypes ?? DEFAULT_IMAGE_TYPES
  const videos = limits.acceptedVideoTypes ?? DEFAULT_VIDEO_TYPES
  if (images.includes(type)) return "image"
  if (videos.includes(type)) return "video"
  return null
}

export type PreflightResult =
  | { ok: true; kind: MediaKind; contentType: string }
  | { ok: false; error: UploadError }

export function preflight(
  file: File,
  limits: ClientUploadLimits
): PreflightResult {
  if (file.size === 0) {
    return reject("empty_file", `${file.name} is empty.`)
  }
  const kind = guessMediaKind(file, limits)
  if (!kind) {
    return reject(
      "unsupported_type",
      `${file.name} is not a supported photo or video. Use JPEG, PNG, WebP, HEIC, MP4, MOV or WebM.`
    )
  }
  const max = kind === "image" ? limits.maxPhotoBytes : limits.maxVideoBytes
  if (file.size > max) {
    const label = kind === "image" ? "Photos" : "Videos"
    return reject(
      "too_large",
      `${file.name} is too large. ${label} can be up to ${mib(max)}.`
    )
  }
  return { ok: true, kind, contentType: guessContentType(file) }
}

function reject(code: UploadError["code"], message: string): PreflightResult {
  return { ok: false, error: { code, message, retryable: false } }
}
