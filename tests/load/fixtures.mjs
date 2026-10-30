// Generates the synthetic load fixtures (noise pixels and test-pattern video, no
// real photos) into a temp directory and prints it. Large files are not committed.
// Requires sharp (repo dependency), macOS `sips` for HEIC and `ffmpeg` for video.
//
//   F=$(node tests/load/fixtures.mjs [dir])
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import sharp from "sharp"

const dir = resolve(process.argv[2] ?? join(tmpdir(), "nabalens-load-fixtures"))
mkdirSync(dir, { recursive: true })
const MiB = 1024 * 1024

/** Camera-like pixels: a gradient with per-pixel noise, so codecs cannot cheat. */
function noisyRgb(width, height, seed) {
  const raw = Buffer.alloc(width * height * 3)
  let s = seed >>> 0 || 1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      s ^= s << 13
      s ^= s >>> 17
      s ^= s << 5
      const n = s & 63
      const i = (y * width + x) * 3
      raw[i] = ((x >> 4) + n) & 255
      raw[i + 1] = ((y >> 4) + (n >> 1)) & 255
      raw[i + 2] = ((x + y) >> 5) & 255
    }
  return sharp(raw, { raw: { width, height, channels: 3 } })
}

async function once(name, make) {
  const path = join(dir, name)
  if (!existsSync(path)) await make(path)
  return path
}

// 12 MP phone-sized stills.
await once("photo-12mp.jpg", (p) =>
  noisyRgb(4032, 3024, 1).jpeg({ quality: 90 }).toFile(p)
)
await once("photo-8mp.jpg", (p) =>
  noisyRgb(3264, 2448, 2).jpeg({ quality: 88 }).toFile(p)
)
await once("photo-2mp.png", (p) => noisyRgb(1920, 1080, 3).png().toFile(p))
await once("photo-12mp.webp", (p) =>
  noisyRgb(4032, 3024, 4).webp({ quality: 85 }).toFile(p)
)
const png12 = await once("photo-12mp-src.png", (p) =>
  noisyRgb(4032, 3024, 5).png().toFile(p)
)
await once("photo-12mp.heic", (p) =>
  execFileSync("sips", ["-s", "format", "heic", png12, "--out", p], {
    stdio: "ignore",
  })
)

function video(name, seconds, bitrate, size, extra = []) {
  return once(name, (p) =>
    execFileSync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=${size}:r=30:d=${seconds},noise=alls=30:allf=t`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      bitrate,
      "-maxrate",
      bitrate,
      "-bufsize",
      bitrate,
      ...extra,
      p,
      "-loglevel",
      "error",
    ])
  )
}
// Batch clip (~20 MiB, resumable path) and the 200 MiB ceiling case. Both keep
// ffmpeg's default moov-at-end layout, as phone recordings usually do.
await video("clip-20mib.mp4", 8, "20M", "1920x1080")
await video("video-200mib.mp4", 64, "28M", "1920x1080", [
  "-fs",
  String(200 * MiB - 512 * 1024),
])

for (const name of [
  "photo-12mp.jpg",
  "photo-8mp.jpg",
  "photo-2mp.png",
  "photo-12mp.webp",
  "photo-12mp.heic",
  "clip-20mib.mp4",
  "video-200mib.mp4",
])
  console.error(`${name}\t${statSync(join(dir, name)).size}`)
console.log(dir)
