// Time and peak memory of the server-side media pipeline (lib/media: sniff, sharp
// derivatives, the HEIC worker, the video probe) for a 12 MP JPEG, a 12 MP and a
// 39 MP HEIC and several videos, and how many run at once. No database or stack
// involved: this is the CPU and memory half of finalise (docs/runtime-sizing.md has
// the end-to-end upload numbers). Each scenario runs in its own child process so
// peak RSS belongs to that scenario alone.
//
//   node --import tsx tests/perf/media-bench.mjs [--out docs/perf/raw] [--keep]
//       [--only <text in the scenario name>] [--label <suffix for media-bench*.json>]
//
// Synthetic inputs only. Files are written to a temp directory and removed at the
// end (the 200 MiB video is the only large one).
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { cpus, loadavg, tmpdir, totalmem } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { gitHead, summarise } from "./lib.mjs"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const DIR = join(tmpdir(), "nabalens-perf-media")
const FIX = resolve("tests/fixtures/media")
const MiB = 1024 * 1024

// ---------------------------------------------------------------- child mode
if (argv[0] === "--child") {
  const spec = JSON.parse(argv[1])
  const { default: sharp } = await import("sharp")
  const media = await import(pathToFileURL(resolve("lib/media/index.ts")).href)
  const rssKiB = () => process.memoryUsage().rss / 1024
  const baseline = rssKiB()
  let peak = baseline
  const sampler = setInterval(() => (peak = Math.max(peak, rssKiB())), 10)

  const bytes = spec.kind === "image" ? new Uint8Array(readFileSync(spec.file)) : null
  const run =
    spec.kind === "image"
      ? () => media.validateMedia({ bytes, size: bytes.byteLength, declaredMime: "", filename: "bench" })
      : () => media.validateMedia({ source: spec.file, size: statSync(spec.file).size, declaredMime: "", filename: "bench" })

  const check = await run()
  if (!check.ok) {
    console.log(JSON.stringify({ spec, error: check.error }))
    process.exit(0)
  }
  const cpu0 = process.cpuUsage()
  const times = []
  const batches = []
  if (spec.concurrency) {
    for (const c of spec.concurrency) {
      const walls = []
      for (let rep = 0; rep < spec.batches; rep++) {
        const t = performance.now()
        const results = await Promise.all(Array.from({ length: c }, run))
        walls.push(performance.now() - t)
        if (results.some((r) => !r.ok)) walls.push(NaN)
      }
      batches.push({ concurrency: c, batchMs: summarise(walls.filter(Number.isFinite)), failures: walls.filter((w) => Number.isNaN(w)).length, peakRssMiB: Math.round(peak / 1024) })
    }
  } else {
    for (let i = 0; i < spec.reps; i++) {
      const t = performance.now()
      const r = await run()
      times.push(performance.now() - t)
      if (!r.ok) throw new Error(r.error)
    }
  }
  const cpu = process.cpuUsage(cpu0)
  clearInterval(sampler)
  peak = Math.max(peak, rssKiB())
  console.log(
    JSON.stringify({
      spec,
      mime: check.mime,
      width: check.width ?? null,
      height: check.height ?? null,
      wallMs: times.length ? summarise(times) : null,
      cpuMsPerOp: times.length ? Math.round(((cpu.user + cpu.system) / 1000 / spec.reps) * 10) / 10 : null,
      batches: batches.length ? batches : null,
      baselineRssMiB: Math.round(baseline / 1024),
      peakRssMiB: Math.round(peak / 1024),
      maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
      sharp: { concurrency: sharp.concurrency(), cache: sharp.cache() },
    })
  )
  process.exit(0)
}

// ---------------------------------------------------------------- fixtures
mkdirSync(DIR, { recursive: true })
const { default: sharp } = await import("sharp")

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
const jpeg12 = join(DIR, "photo-12mp.jpg")
if (!existsSync(jpeg12)) await noisyRgb(4032, 3024, 1).jpeg({ quality: 90 }).toFile(jpeg12)
const jpeg8 = join(DIR, "photo-8mp.jpg")
if (!existsSync(jpeg8)) await noisyRgb(3264, 2448, 2).jpeg({ quality: 88 }).toFile(jpeg8)

function ffmpegVideo(name, seconds, bitrate, size, extra = []) {
  const path = join(DIR, name)
  if (existsSync(path)) return path
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc2=s=${size}:r=30:d=${seconds},noise=alls=30:allf=t`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bitrate, ...extra, path, "-loglevel", "error"])
  return path
}
const clip20 = ffmpegVideo("clip-20mib.mp4", 8, "20M", "1920x1080")
const video200 = ffmpegVideo("video-200mib.mp4", 64, "28M", "1920x1080", ["-fs", String(200 * MiB - 512 * 1024)])
const fixture = (n) => join(FIX, n)

// ---------------------------------------------------------------- scenarios
const size = (p) => statSync(p).size
const scenarios = [
  { name: "JPEG 12 MP (4032x3024)", kind: "image", file: jpeg12, reps: 15 },
  { name: "JPEG 8 MP (3264x2448)", kind: "image", file: jpeg8, reps: 15 },
  { name: "PNG 12 MP (synthetic-12mp.png, 2.4 MiB)", kind: "image", file: fixture("synthetic-12mp.png"), reps: 10 },
  { name: "HEIC 12 MP (synthetic-12mp.heic)", kind: "image", file: fixture("synthetic-12mp.heic"), reps: 12 },
  { name: "HEIC 39 MP (synthetic-39mp.heic)", kind: "image", file: fixture("synthetic-39mp.heic"), reps: 6 },
  { name: "video MP4 tiny (synthetic.mp4)", kind: "video", file: fixture("synthetic.mp4"), reps: 15 },
  { name: "video MOV tiny (synthetic.mov)", kind: "video", file: fixture("synthetic.mov"), reps: 15 },
  { name: "video WebM tiny (synthetic.webm)", kind: "video", file: fixture("synthetic.webm"), reps: 15 },
  { name: "video HEVC MOV (review-hevc.mov)", kind: "video", file: fixture("review-hevc.mov"), reps: 15 },
  { name: "video MP4 20 MiB, moov at end", kind: "video", file: clip20, reps: 10 },
  { name: "video MP4 200 MiB, moov at end", kind: "video", file: video200, reps: 10 },
  { name: "JPEG 12 MP, concurrent 1/2/4/8/10/16", kind: "image", file: jpeg12, concurrency: [1, 2, 4, 8, 10, 16], batches: 4 },
  { name: "PNG 12 MP, concurrent 1/4/10", kind: "image", file: fixture("synthetic-12mp.png"), concurrency: [1, 4, 10], batches: 4 },
  { name: "HEIC 39 MP, concurrent 1/4", kind: "image", file: fixture("synthetic-39mp.heic"), concurrency: [1, 4], batches: 2 },
  { name: "HEIC 12 MP, concurrent 1/2/4/8 (queue of 1 worker)", kind: "image", file: fixture("synthetic-12mp.heic"), concurrency: [1, 2, 4, 8], batches: 3 },
  { name: "video 200 MiB probe, concurrent 1/4/8", kind: "video", file: video200, concurrency: [1, 4, 8], batches: 3 },
]

// One child per concurrency level: ru_maxrss only ever grows, so levels sharing
// a process would inherit the peak of the levels before them.
const runs = scenarios
  .flatMap((s) =>
    s.concurrency
      ? s.concurrency.map((c) => ({ ...s, name: `${s.name.split(",")[0]}, concurrent ${c}`, concurrency: [c] }))
      : [s]
  )
  .filter((s) => !arg("only") || s.name.includes(arg("only")))
const results = []
for (const s of runs) {
  const res = spawnSync(
    process.execPath,
    ["--import", "tsx", process.argv[1], "--child", JSON.stringify({ ...s, bytes: size(s.file) })],
    { encoding: "utf8", cwd: resolve("."), maxBuffer: 64 * MiB }
  )
  const line = res.stdout.trim().split("\n").pop()
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    parsed = { error: `child failed: ${(res.stderr || res.stdout).slice(0, 400)}` }
  }
  results.push({ name: s.name, inputBytes: size(s.file), ...parsed, spec: undefined })
  const w = parsed.wallMs
  console.error(
    `${s.name.padEnd(54)} ${w ? `p50 ${w.p50} ms p95 ${w.p95} ms cpu/op ${parsed.cpuMsPerOp} ms ` : ""}peak RSS ${parsed.peakRssMiB} MiB (baseline ${parsed.baselineRssMiB})${parsed.error ? " ERROR " + parsed.error : ""}${parsed.batches ? " " + parsed.batches.map((b) => `c${b.concurrency}:${b.batchMs.p50}ms/${b.peakRssMiB}MiB`).join(" ") : ""}`
  )
}

if (!argv.includes("--keep")) rmSync(DIR, { recursive: true, force: true })
const OUT = resolve(arg("out", "docs/perf/raw"), "media")
mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, `media-bench${arg("label", "")}.json`),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      revision: gitHead(),
      machine: { cpus: cpus().length, model: cpus()[0].model, memGiB: Math.round(totalmem() / 1024 ** 3), node: process.version },
      loadAverage: loadavg(),
      results,
    },
    null,
    2
  )
)
console.error(`wrote ${join(OUT, `media-bench${arg("label", "")}.json`)}`)
