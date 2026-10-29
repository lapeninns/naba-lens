// Synthetic pixels only. Run from repository root; requires local sips and ffmpeg.
import sharp from "sharp"
import { execFileSync } from "node:child_process"
const raw = Buffer.alloc(4000 * 3000 * 3)
for (let y = 0; y < 3000; y++)
  for (let x = 0; x < 4000; x++) {
    const i = (y * 4000 + x) * 3
    raw[i] = x % 256
    raw[i + 1] = y % 256
    raw[i + 2] = (x + y) % 256
  }
const dir = "tests/fixtures/media/"
await sharp(raw, { raw: { width: 4000, height: 3000, channels: 3 } })
  .png()
  .toFile(dir + "synthetic-12mp.png")
execFileSync("sips", [
  "-s",
  "format",
  "heic",
  dir + "synthetic-12mp.png",
  "--out",
  dir + "synthetic-12mp.heic",
])
for (const [ext, args] of [
  ["mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]],
  ["mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]],
  ["webm", ["-c:v", "libvpx-vp9"]],
])
  execFileSync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x240:d=0.2",
    ...args,
    dir + "synthetic." + ext,
    "-loglevel",
    "error",
  ])

// 39 MP gradient fixture, still below the shared 40 MP pixel ceiling.
const largeWidth = 7500,
  largeHeight = 5200
const large = Buffer.alloc(largeWidth * largeHeight * 3)
for (let y = 0; y < largeHeight; y++)
  for (let x = 0; x < largeWidth; x++) {
    const i = (y * largeWidth + x) * 3
    large[i] = x % 256
    large[i + 1] = y % 256
    large[i + 2] = (x + y) % 256
  }
const { mkdtemp, rm } = await import("node:fs/promises")
const { tmpdir } = await import("node:os")
const temporary = await mkdtemp(tmpdir() + "/nabalens-media-")
try {
  await sharp(large, {
    raw: { width: largeWidth, height: largeHeight, channels: 3 },
  })
    .png()
    .toFile(temporary + "/39mp.png")
  execFileSync("sips", [
    "-s",
    "format",
    "heic",
    temporary + "/39mp.png",
    "--out",
    dir + "synthetic-39mp.heic",
  ])
} finally {
  await rm(temporary, { recursive: true, force: true })
}
