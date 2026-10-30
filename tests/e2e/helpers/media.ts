import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

/** Synthetic media generated per run (no real staff photos in the repo). */
export type SourceFile = { path: string; name: string; sha256: string }

export const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

const dir = mkdtempSync(join(tmpdir(), "nabalens-journey-media-"))

function source(path: string): SourceFile {
  return {
    path,
    name: path.split("/").at(-1)!,
    sha256: sha256(readFileSync(path)),
  }
}

/** A distinct JPEG each call, so every upload has its own hash. */
export async function syntheticJpeg(name: string): Promise<SourceFile> {
  const hue = Math.floor(Math.random() * 200)
  const bytes = await sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: { r: 160, g: 60 + (hue % 80), b: 40 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="1600" height="1200"><circle cx="800" cy="600" r="${250 + hue}" fill="#f4e1c1"/><text x="80" y="1120" font-size="64" fill="#222">DEV FIXTURE ${name}</text></svg>`
        ),
      },
    ])
    .jpeg({ quality: 85 })
    .toBuffer()
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return source(path)
}

/** HEIC made with macOS `sips` from a synthetic JPEG (a real HEIF container). */
export async function syntheticHeic(name: string): Promise<SourceFile> {
  const jpeg = await syntheticJpeg(name.replace(/\.heic$/i, "-src.jpg"))
  const path = join(dir, name)
  execFileSync("sips", ["-s", "format", "heic", jpeg.path, "--out", path], {
    stdio: "ignore",
  })
  return source(path)
}

/** The repo's small H.264 MP4 fixture, copied under a run-specific name. */
export function supportedMp4(name: string): SourceFile {
  const fixture = fileURLToPath(
    new URL("../../fixtures/media/synthetic.mp4", import.meta.url)
  )
  const path = join(dir, name)
  writeFileSync(path, readFileSync(fixture))
  return source(path)
}

/** An HEVC (H.265, hvc1) MP4 generated with ffmpeg, for the playback fallback. */
export function hevcMp4(name: string): SourceFile {
  const path = join(dir, name)
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=15",
      "-t",
      "1",
      "-c:v",
      "libx265",
      "-tag:v",
      "hvc1",
      "-pix_fmt",
      "yuv420p",
      "-x265-params",
      "log-level=error",
      "-y",
      path,
    ],
    { stdio: "ignore" }
  )
  return source(path)
}

export function fileHash(path: string) {
  return sha256(readFileSync(path))
}
