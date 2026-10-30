import { it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { processImage } from "../../lib/media"
import { MEDIA_LIMITS } from "../../lib/config/media"
it("recycles HEIC isolates: 12MP, 39MP, 30 sequential and 100 malformed remain bounded", async () => {
  const sample = await readFile(
    new URL("../fixtures/media/synthetic-12mp.heic", import.meta.url)
  )
  const large = await readFile(
    new URL("../fixtures/media/synthetic-39mp.heic", import.meta.url)
  )
  const malformed = Buffer.alloc(19 * 1024 * 1024)
  malformed.writeUInt32BE(20)
  malformed.write("ftypheic", 4)
  async function measure(
    name: string,
    count: number,
    bytes: Buffer,
    valid: boolean
  ) {
    const startRss = process.memoryUsage().rss
    let peak = startRss
    const start = performance.now()
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss)
    }, 5)
    try {
      for (let i = 0; i < count; i++) {
        if (valid) {
          const result = await processImage(bytes)
          expect(result.width * result.height).toBeLessThanOrEqual(
            MEDIA_LIMITS.maxImagePixels
          )
        } else
          await expect(processImage(bytes)).rejects.toMatchObject({
            code: "corrupt_media",
          })
        peak = Math.max(peak, process.memoryUsage().rss)
      }
    } finally {
      clearInterval(timer)
    }
    const endRss = process.memoryUsage().rss
    const result = {
      name,
      count,
      inputBytes: bytes.length,
      ms: Math.round(performance.now() - start),
      startRss,
      peakRss: peak,
      endRss,
    }
    console.log(JSON.stringify(result))
    return result
  }
  const single = await measure("12MP", 1, sample, true)
  const largeResult = await measure("39MP", 1, large, true)
  const repeat = await measure("30 sequential 12MP", 30, sample, true)
  const bad = await measure("100 malformed 19MiB", 100, malformed, false)
  // Broad allocator tolerance, but far below the previous multi-GB leak.
  expect(single.peakRss - single.startRss).toBeLessThan(512 * 1024 * 1024)
  expect(largeResult.peakRss - largeResult.startRss).toBeLessThan(
    1024 * 1024 * 1024
  )
  expect(repeat.endRss - repeat.startRss).toBeLessThan(384 * 1024 * 1024)
  expect(bad.endRss - bad.startRss).toBeLessThan(384 * 1024 * 1024)
}, 120000)
