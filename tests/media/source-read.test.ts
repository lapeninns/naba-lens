import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { validateMedia } from "../../lib/media"

const fixture = () =>
  readFile(new URL("../fixtures/media/synthetic.mp4", import.meta.url))

describe("video source read failures", () => {
  it.each([Error, RangeError])(
    "propagates %s from sniff and metadata reads so finalisation can retry",
    async (Failure) => {
      const bytes = await fixture()
      let reads = 0
      let failAt: number | undefined
      const failure = new Failure("storage_range_503")
      const source = {
        size: bytes.length,
        read: async (offset: number, length: number) => {
          if (++reads === failAt) throw failure
          return bytes.subarray(offset, offset + length)
        },
      }
      const input = { source, declaredMime: "video/mp4", filename: "food.mp4" }
      expect(await validateMedia(input)).toMatchObject({ ok: true })
      const readCount = reads
      // Exercise every read, including the sniff, box headers and moov payload.
      expect(readCount).toBeGreaterThan(3)
      for (failAt = 1; failAt <= readCount; failAt++) {
        reads = 0
        await expect(validateMedia(input)).rejects.toBe(failure)
      }
      failAt = undefined
      reads = 0
      expect(await validateMedia(input)).toMatchObject({ ok: true })
    }
  )

  it("still rejects malformed metadata when source reads succeed", async () => {
    const bytes = await fixture()
    // Keep ftyp/sniff intact but corrupt the top-level moov box length.
    for (let offset = 0; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset)
      if (bytes.toString("ascii", offset + 4, offset + 8) === "moov") {
        bytes.writeUInt32BE(bytes.length + 1, offset)
        break
      }
      offset += size
    }
    expect(
      await validateMedia({
        source: {
          size: bytes.length,
          read: async (offset, length) =>
            bytes.subarray(offset, offset + length),
        },
        declaredMime: "video/mp4",
        filename: "food.mp4",
      })
    ).toMatchObject({ ok: false, error: "invalid_video" })
  })
})
