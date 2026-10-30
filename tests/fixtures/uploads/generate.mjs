// Generates the synthetic upload-recovery fixtures into a directory (default: a
// temp dir) and prints a JSON manifest. Synthetic pixels only; no real media.
// Requires sharp (dependency), ffmpeg (libx264, libx265, libvpx-vp9) and, for
// HEIC, macOS `sips`. Files are cached by name, so re-runs are cheap.
//
//   node tests/fixtures/uploads/generate.mjs [outdir] [--tus-mib N] [--big]
//
// --big also writes `big-200mib.mp4`, a valid H.264 MP4 of exactly 200 MiB
// (209,715,200 bytes: the product video limit) for the storage-limit check.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { open, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import sharp from "sharp"

const MiB = 1024 * 1024
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const positional = args.filter(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--tus")
)
const out = resolve(positional[0] ?? join(tmpdir(), "nabalens-upload-fixtures"))
mkdirSync(out, { recursive: true })

const path = (name) => join(out, name)
const has = (name) => existsSync(path(name)) && statSync(path(name)).size > 0

function ffmpeg(input, codecArgs, name, extra = []) {
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    input,
    ...codecArgs,
    ...extra,
    path(name),
  ])
}

/** A distinct synthetic photo: coloured background and a circle. */
function photo(seed, width = 1200, height = 900) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: (seed * 53) % 256, g: (seed * 97) % 256, b: 90 },
    },
  }).composite([
    {
      input: Buffer.from(
        `<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${150 + seed * 10}" fill="#f4e1c1"/></svg>`
      ),
    },
  ])
}

if (!has("photo.jpg"))
  await photo(1).jpeg({ quality: 85 }).toFile(path("photo.jpg"))
if (!has("photo.png")) await photo(2).png().toFile(path("photo.png"))
if (!has("photo.webp")) await photo(3).webp().toFile(path("photo.webp"))
if (!has("extra.jpg")) await photo(4).jpeg().toFile(path("extra.jpg"))
if (!has("eleventh.jpg")) await photo(5).jpeg().toFile(path("eleventh.jpg"))
if (!has("retry.jpg")) await photo(6).jpeg().toFile(path("retry.jpg"))
if (!has("cancel-a.jpg")) await photo(7).jpeg().toFile(path("cancel-a.jpg"))
if (!has("cancel-b.jpg")) await photo(8).jpeg().toFile(path("cancel-b.jpg"))

let heic = null
if (has("photo.heic")) heic = path("photo.heic")
else {
  try {
    await photo(9, 1024, 768).png().toFile(path("heic-source.png"))
    execFileSync(
      "sips",
      [
        "-s",
        "format",
        "heic",
        path("heic-source.png"),
        "--out",
        path("photo.heic"),
      ],
      { stdio: "ignore" }
    )
    heic = path("photo.heic")
  } catch {
    heic = null // no sips (not macOS): callers fall back to tests/fixtures/media
  }
}

// HTML renamed .jpg: passes the client's extension check, fails sniffing.
if (!has("disguised.jpg"))
  writeFileSync(
    path("disguised.jpg"),
    "<!doctype html><html><body><script>alert(1)</script></body></html>\n"
  )

// A real JPEG cut at 60%: valid signature, broken scan data.
if (!has("corrupt.jpg")) {
  const bytes = await photo(10).jpeg({ quality: 90 }).toBuffer()
  writeFileSync(
    path("corrupt.jpg"),
    bytes.subarray(0, Math.floor(bytes.length * 0.6))
  )
}

// Valid JPEG followed by zero padding to 21 MiB: over the 20 MiB photo limit.
if (!has("oversized.jpg")) {
  const bytes = await photo(11).jpeg().toBuffer()
  const padded = Buffer.alloc(21 * MiB)
  bytes.copy(padded)
  writeFileSync(path("oversized.jpg"), padded)
}

const testsrc = "testsrc2=s=640x360:r=25:d=2"
const h264 = [
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
]
if (!has("clip-h264.mp4")) ffmpeg(testsrc, h264, "clip-h264.mp4")
if (!has("clip.mov"))
  ffmpeg(testsrc, ["-c:v", "libx264", "-pix_fmt", "yuv420p"], "clip.mov")
if (!has("clip.webm"))
  ffmpeg(testsrc, ["-c:v", "libvpx-vp9", "-b:v", "500k"], "clip.webm")
// HEVC in MP4 with the hvc1 tag, as iPhones write it.
if (!has("clip-hevc.mp4"))
  ffmpeg(
    testsrc,
    [
      "-c:v",
      "libx265",
      "-pix_fmt",
      "yuv420p",
      "-tag:v",
      "hvc1",
      "-x265-params",
      "log-level=error",
      "-movflags",
      "+faststart",
    ],
    "clip-hevc.mp4"
  )

/**
 * A valid H.264 MP4 of at least `bytes`: lossless noise so the size is driven
 * by duration, then trimmed by stream-copy until it fits. Padding inside a
 * `free` box keeps it a valid file of the exact requested size.
 */
async function sizedVideo(name, bytes) {
  if (has(name) && statSync(path(name)).size === bytes) return
  const seconds = Math.max(2, Math.ceil(bytes / (2.5 * MiB)))
  const tmp = path(`${name}.tmp.mp4`)
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `nullsrc=s=640x360:r=25:d=${seconds},geq=random(1)*255:128:128`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-qp",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    tmp,
  ])
  let data = await readFile(tmp)
  if (data.length > bytes) {
    // Too big: re-encode a proportionally shorter clip.
    const shorter = Math.max(1, Math.floor((seconds * bytes) / data.length) - 1)
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      tmp,
      "-t",
      String(shorter / 1),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      path(`${name}.tmp2.mp4`),
    ])
    data = await readFile(path(`${name}.tmp2.mp4`))
  }
  if (data.length > bytes)
    throw new Error(`${name}: could not fit ${bytes} bytes`)
  // Append a top-level `free` box (size + "free" + zeros) to reach the size.
  const pad = bytes - data.length
  const handle = await open(path(name), "w")
  await handle.write(data)
  if (pad > 0) {
    if (pad < 8) throw new Error("padding too small for a box")
    const header = Buffer.alloc(8)
    header.writeUInt32BE(pad, 0)
    header.write("free", 4, "latin1")
    await handle.write(header)
    const zeros = Buffer.alloc(Math.min(pad - 8, 8 * MiB))
    for (let left = pad - 8; left > 0; left -= zeros.length)
      await handle.write(left >= zeros.length ? zeros : zeros.subarray(0, left))
  }
  await handle.close()
  for (const t of [tmp, path(`${name}.tmp2.mp4`)]) rmSync(t, { force: true })
}

// Several 6 MiB TUS chunks, for interruption and resume.
const tusMiB = option("--tus-mib", 20)
await sizedVideo("tus-video.mp4", tusMiB * MiB)
if (flag("--big")) await sizedVideo("big-200mib.mp4", 200 * MiB)

const manifest = {}
for (const name of [
  "photo.jpg",
  "photo.png",
  "photo.webp",
  "photo.heic",
  "extra.jpg",
  "eleventh.jpg",
  "retry.jpg",
  "cancel-a.jpg",
  "cancel-b.jpg",
  "disguised.jpg",
  "corrupt.jpg",
  "oversized.jpg",
  "clip-h264.mp4",
  "clip.mov",
  "clip.webm",
  "clip-hevc.mp4",
  "tus-video.mp4",
  "big-200mib.mp4",
]) {
  if (name === "photo.heic" && !heic) continue
  if (has(name)) manifest[name.replace(/[.-]/g, "_")] = path(name)
}
console.log(JSON.stringify({ dir: out, files: manifest }))
