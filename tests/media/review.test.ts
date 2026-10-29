import { it, expect, vi } from "vitest"
import { readFile } from "node:fs/promises"
import sharp from "sharp"

import {
  processImage,
  validateMedia,
  sniffMedia,
  createAvatarDerivative,
} from "../../lib/media"
const fixture = (n: string) =>
  readFile(new URL("../fixtures/media/" + n, import.meta.url))
it("normalizes advisory MIME and rejects known contradiction", async () => {
  const bytes = await fixture("synthetic-12mp.heic")
  for (const declaredMime of [
    "",
    "application/octet-stream",
    "IMAGE/HEIF; x=y",
  ])
    expect(
      await validateMedia({ bytes, declaredMime, filename: "x" })
    ).toMatchObject({ ok: true, mime: "image/heic", width: 4000 })
  expect(
    await validateMedia({ bytes, declaredMime: "image/png", filename: "x" })
  ).toMatchObject({ ok: false, error: "mime_mismatch" })
})
it("distinguishes HEIC major, AVIF and minor brand confusion", () => {
  for (const [major, mime] of [
    ["avif", undefined],
    ["isom", "video/mp4"],
    ["heic", "image/heic"],
  ]) {
    const b = Buffer.alloc(24)
    b.writeUInt32BE(24)
    b.write("ftyp", 4)
    b.write(major!, 8)
    b.write("qt  ", 12)
    b.write("mif1", 16)
    expect(sniffMedia(b)?.mime).toBe(mime)
  }
})
it("strips GPS Artist XMP ICC metadata from all outputs", async () => {
  const bytes = await sharp({
    create: { width: 100, height: 60, channels: 3, background: "red" },
  })
    .jpeg()
    .withExif({
      IFD0: { Artist: "PRIVATE" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "51/1 30/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "0/1 1/1 0/1",
      },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">PRIVATE</x:xmpmeta>')
    .withIccProfile("p3")
    .toBuffer()
  const original = await sharp(bytes).metadata()
  expect(original.exif).toBeDefined()
  expect(original.xmp).toBeDefined()
  expect(original.icc).toBeDefined()
  const d = await processImage(bytes)
  for (const b of [d.preview, d.thumb, await createAvatarDerivative(bytes)]) {
    const m = await sharp(b).metadata()
    expect(m.exif).toBeUndefined()
    expect(m.xmp).toBeUndefined()
    expect(m.icc).toBeUndefined()
  }
})
it("documents polyglot policy: sanitized derivatives, unchanged original", async () => {
  const clean = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  })
    .jpeg()
    .toBuffer()
  const bytes = Buffer.concat([
    clean,
    Buffer.from("<html><script>private</script>PK\x03\x04"),
  ])
  const result = await validateMedia({
    bytes,
    declaredMime: "image/jpeg",
    filename: "x",
  })
  expect(result.ok).toBe(true)
  if (result.ok && "preview" in result)
    expect(result.preview.includes(Buffer.from("<script>"))).toBe(false)
  expect(bytes.includes(Buffer.from("<script>"))).toBe(true)
})
it("returns derivatives from validation without a second decode API call", async () => {
  const bytes = await fixture("synthetic-12mp.heic")
  expect(
    await validateMedia({ bytes, declaredMime: "", filename: "x" })
  ).toMatchObject({
    ok: true,
    width: 4000,
    height: 3000,
    preview: expect.any(Buffer),
    thumb: expect.any(Buffer),
  })
})
it("enforces HEIC concurrency one", async () => {
  const b = await fixture("synthetic-12mp.heic")
  const pending = processImage(b)
  await expect(processImage(b)).rejects.toMatchObject({ code: "decoder_busy" })
  await pending
})
it("terminates timed-out workers and releases slot before next decode", async () => {
  const { MEDIA_LIMITS } = await import("../../lib/config/media")
  const config = MEDIA_LIMITS as { heicTimeoutMs: number }
  const old = config.heicTimeoutMs
  const bytes = await fixture("synthetic-12mp.heic")
  try {
    config.heicTimeoutMs = 1
    await expect(processImage(bytes)).rejects.toMatchObject({
      code: "decode_timeout",
    })
  } finally {
    config.heicTimeoutMs = old
  }
  expect((await processImage(bytes)).width).toBe(4000)
})
it("maps sharp pixel ceiling to pixel_limit", async () => {
  const b = await sharp({
    create: { width: 6500, height: 6500, channels: 3, background: "red" },
  })
    .png()
    .toBuffer()
  expect(
    await validateMedia({ bytes: b, declaredMime: "image/png", filename: "x" })
  ).toMatchObject({ ok: false, error: "pixel_limit" })
})
it("validates a 200MiB range source and a sparse path with probe metadata", async () => {
  const { mkdtemp, open, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const bytes = await fixture("synthetic.mp4")
  let ftyp = Buffer.alloc(0),
    moov = Buffer.alloc(0)
  for (let o = 0; o < bytes.length;) {
    const n = bytes.readUInt32BE(o)
    const type = bytes.toString("ascii", o + 4, o + 8)
    if (type === "ftyp") ftyp = bytes.subarray(o, o + n)
    if (type === "moov") moov = bytes.subarray(o, o + n)
    o += n
  }
  const size = 200 * 1024 * 1024
  const tail = size - moov.length
  const mdat = Buffer.alloc(8)
  mdat.writeUInt32BE(tail - ftyp.length)
  mdat.write("mdat", 4)
  let requests = 0,
    readBytes = 0
  const source = {
    size,
    read: async (offset: number, length: number) => {
      requests++
      readBytes += length
      const b = Buffer.alloc(length)
      for (const [start, data] of [
        [0, ftyp],
        [ftyp.length, mdat],
        [tail, moov],
      ] as const) {
        const a = Math.max(start, offset),
          z = Math.min(start + data.length, offset + length)
        if (z > a) data.copy(b, a - offset, a - start, z - start)
      }
      return b
    },
  }
  const result = await validateMedia({
    source,
    declaredMime: "application/octet-stream",
    filename: "huge.mov",
  })
  expect(result).toMatchObject({
    ok: true,
    mime: "video/mp4",
    width: 320,
    height: 240,
    size,
  })
  expect(requests).toBeLessThan(12)
  expect(readBytes).toBeLessThan(100000)
  const dir = await mkdtemp(tmpdir() + "/nl-media-review-")
  try {
    const path = dir + "/large.mp4"
    const file = await open(path, "w")
    try {
      await file.truncate(size)
      await file.write(ftyp, 0, ftyp.length, 0)
      await file.write(mdat, 0, 8, ftyp.length)
      await file.write(moov, 0, moov.length, tail)
    } finally {
      await file.close()
    }
    expect(
      await validateMedia({ source: path, declaredMime: "", filename: "x" })
    ).toMatchObject({ ok: true, mime: "video/mp4", width: 320 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it("preserves probe_limit through validation", async () => {
  const { MEDIA_LIMITS } = await import("../../lib/config/media")
  const config = MEDIA_LIMITS as { maxProbeRequests: number }
  const old = config.maxProbeRequests
  const bytes = await fixture("synthetic.mp4")
  try {
    config.maxProbeRequests = 1
    expect(
      await validateMedia({ bytes, declaredMime: "video/mp4", filename: "x" })
    ).toMatchObject({ ok: false, error: "probe_limit" })
  } finally {
    config.maxProbeRequests = old
  }
})

it("validation calls the HEIC worker processing entry once per upload", async () => {
  const heic = await import("../../lib/media/heic")
  const spy = vi.spyOn(heic, "processHeic")
  try {
    const bytes = await fixture("synthetic-12mp.heic")
    const result = await validateMedia({
      bytes,
      declaredMime: "",
      filename: "x",
    })
    expect(result.ok).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  } finally {
    spy.mockRestore()
  }
})
