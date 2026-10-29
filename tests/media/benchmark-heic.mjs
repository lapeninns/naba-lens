import { readFileSync } from "node:fs"
const start = performance.now()
const { default: decode } = await import("heic-decode")
const imported = performance.now()
const buffer = readFileSync("tests/fixtures/media/synthetic-12mp.heic")
const decoded = await decode({ buffer })
console.log(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    width: decoded.width,
    height: decoded.height,
    inputBytes: buffer.length,
    importMs: imported - start,
    decodeMs: performance.now() - imported,
    rssBytes: process.memoryUsage().rss,
    maxRssKiB: process.resourceUsage().maxRSS,
  })
)
