import "server-only"

import sharp from "sharp"

import { MEDIA_LIMITS } from "@/lib/config/media"

import { extensionFor, type ExportProfile } from "./model"

// S1-EXPORT output profiles (§14.1): Original passes the stored bytes through
// unchanged; Website, Social and Custom resize with sharp (the library the
// upload pipeline already uses), fitting inside the profile's box without
// enlarging, applying the EXIF orientation and writing no metadata, so the
// exported file carries no camera details or location. A HEIC original is
// read from its stored preview (already decoded, oriented and stripped at
// upload), since HEIC decoding runs in the upload pipeline's own worker.

export type RenderedFile = {
  bytes: Uint8Array
  ext: string
  format: "original" | "webp" | "jpeg"
  width: number | null
  height: number | null
}

export type RenderSource = {
  bytes: Uint8Array
  mime: string
  width: number | null
  height: number | null
}

export async function renderExportFile(
  source: RenderSource,
  profile: Pick<ExportProfile, "format" | "maxWidth" | "maxHeight" | "quality">
): Promise<RenderedFile> {
  if (profile.format === "original") {
    return {
      bytes: source.bytes,
      ext: extensionFor("original", source.mime),
      format: "original",
      width: source.width,
      height: source.height,
    }
  }
  const quality = profile.quality ?? 85
  const pipeline = sharp(source.bytes, {
    failOn: "error",
    limitInputPixels: MEDIA_LIMITS.maxImagePixels,
  })
    .timeout({ seconds: MEDIA_LIMITS.imageTimeoutSeconds })
    .rotate()
    .resize({
      width: profile.maxWidth ?? undefined,
      height: profile.maxHeight ?? undefined,
      fit: "inside",
      withoutEnlargement: true,
    })
  const encoded =
    profile.format === "webp"
      ? pipeline.webp({ quality })
      : pipeline
          .flatten({ background: "#ffffff" })
          .jpeg({ quality, mozjpeg: true })
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
  return {
    bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    ext: extensionFor(profile.format, ""),
    format: profile.format,
    width: info.width,
    height: info.height,
  }
}
