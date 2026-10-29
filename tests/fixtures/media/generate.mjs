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
