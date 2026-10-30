import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import {
  createAvatarDerivative,
  createImageDerivatives,
  sniffMedia,
  validateMedia,
  probeVideo,
} from "../../lib/media"
const fixture = (name: string) =>
  readFile(new URL(`../fixtures/media/${name}`, import.meta.url))
describe("images", () => {
  for (const format of ["jpeg", "png", "webp"] as const)
    it(`decodes ${format}, strips metadata and sizes derivatives`, async () => {
      const b = await sharp({
        create: { width: 1800, height: 900, channels: 3, background: "red" },
      })
        [format]()
        .withMetadata({ orientation: 6 })
        .toBuffer()
      const mime = `image/${format}`
      expect(sniffMedia(b)?.mime).toBe(mime)
      expect(
        (
          await validateMedia({
            bytes: b,
            declaredMime: mime,
            filename: "ignored.exe",
          })
        ).ok
      ).toBe(true)
      const d = await createImageDerivatives(b, mime)
      expect([d.width, d.height]).toEqual([900, 1800])
      const m = await sharp(d.preview).metadata()
      expect(m.width).toBe(800)
      expect(m.height).toBe(1600)
      expect(m.exif).toBeUndefined()
      expect(m.orientation).toBeUndefined()
      expect((await sharp(d.thumb).metadata()).height).toBe(480)
      expect(
        await sharp(await createAvatarDerivative(b)).metadata()
      ).toMatchObject({ width: 256, height: 256, format: "webp" })
      expect(
        (
          await validateMedia(
            { bytes: b, declaredMime: "image/png", filename: "x" },
            { maxPhotoBytes: 1, maxVideoBytes: 1000000 }
          )
        ).ok
      ).toBe(false)
      expect(
        (
          await validateMedia({
            bytes: b.subarray(0, 24),
            declaredMime: mime,
            filename: "x",
          })
        ).ok
      ).toBe(false)
    })
  it("decodes synthetic 12MP HEIC with WASM", async () => {
    const b = await fixture("synthetic-12mp.heic")
    expect(sniffMedia(b)?.mime).toBe("image/heic")
    const d = await createImageDerivatives(b, "image/heic")
    expect([d.width, d.height]).toEqual([4000, 3000])
    expect((await sharp(d.preview).metadata()).width).toBe(1600)
    expect(
      (
        await validateMedia({
          bytes: b,
          declaredMime: "image/heif",
          filename: "x.heif",
        })
      ).ok
    ).toBe(true)
    expect(
      (await sharp(await createAvatarDerivative(b)).metadata()).width
    ).toBe(256)
  })
  it("rejects unsupported, corrupt, mismatched and oversized avatars", async () => {
    for (const b of [
      Buffer.from("<svg/>"),
      Buffer.from([255, 216, 255, 0, 0]),
    ]) {
      await expect(createAvatarDerivative(b)).rejects.toThrow()
      expect(
        (
          await validateMedia({
            bytes: b,
            declaredMime: "image/jpeg",
            filename: "x.jpg",
          })
        ).ok
      ).toBe(false)
    }
    await expect(
      createImageDerivatives(Buffer.from("<html>"), "image/jpeg")
    ).rejects.toThrow()
    await expect(
      createAvatarDerivative(Buffer.alloc(5 * 1024 * 1024 + 1))
    ).rejects.toThrow("file_too_large")
  })
})
describe("video", () => {
  for (const [ext, mime, codec] of [
    ["mp4", "video/mp4", "avc1"],
    ["mov", "video/quicktime", "avc1"],
    ["webm", "video/webm", "V_VP9"],
  ])
    it(`probes real synthetic ${ext}`, async () => {
      const b = await fixture(`synthetic.${ext}`)
      expect(sniffMedia(b)?.mime).toBe(mime)
      const p = await probeVideo(b)
      expect(p).toMatchObject({
        mime,
        width: 320,
        height: 240,
        codec,
        likelyBrowserPlayable: ext !== "mov",
      })
      expect(p.durationSeconds).toBeCloseTo(0.2, 1)
      expect(
        (await validateMedia({ bytes: b, declaredMime: mime, filename: "x" }))
          .ok
      ).toBe(true)
      await expect(probeVideo(b.subarray(0, 40))).rejects.toThrow()
      await expect(
        probeVideo({ size: b.length, read: async () => new Uint8Array(0) })
      ).rejects.toThrow()
    })
  it("rejects unsupported and malformed containers", async () => {
    for (const b of [
      Buffer.from("not video data"),
      Buffer.alloc(30),
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(30).fill(0)]),
    ])
      await expect(probeVideo(b)).rejects.toThrow()
  })
  it("reads tail moov past a 200MiB payload without loading payload", async () => {
    const b = await fixture("synthetic.mp4")
    const parts: Buffer[] = []
    let moov = Buffer.alloc(0)
    for (let o = 0; o < b.length;) {
      const n = b.readUInt32BE(o)
      const t = b.toString("ascii", o + 4, o + 8)
      if (t === "moov") moov = b.subarray(o, o + n)
      else if (t === "ftyp") parts.push(b.subarray(o, o + n))
      o += n
    }
    const prefix = Buffer.concat(parts)
    const payloadSize = 200 * 1024 * 1024
    const header = Buffer.alloc(8)
    header.writeUInt32BE(payloadSize)
    header.write("mdat", 4)
    const tailOffset = prefix.length + payloadSize
    let total = 0
    const p = await probeVideo({
      size: tailOffset + moov.length,
      read: async (o, n) => {
        total += n
        if (o < prefix.length) return prefix.subarray(o, o + n)
        if (o === prefix.length) return header.subarray(0, n)
        if (o >= tailOffset)
          return moov.subarray(o - tailOffset, o - tailOffset + n)
        throw Error("payload read")
      },
    })
    expect(p.width).toBe(320)
    expect(total).toBeLessThan(10000)
  })
})
it("HEIC corrupt/truncated inputs fail without fake previews", async () => {
  const b = await fixture("synthetic-12mp.heic")
  const broken = b.subarray(0, 80)
  await expect(createImageDerivatives(broken, "image/heic")).rejects.toThrow()
  expect(
    (
      await validateMedia({
        bytes: broken,
        declaredMime: "image/heic",
        filename: "x",
      })
    ).ok
  ).toBe(false)
})
it("rejects MIME mismatch, mismatched sizes and oversized derivatives", async () => {
  const b = await fixture("synthetic-12mp.png")
  expect(
    await validateMedia({
      bytes: b,
      declaredMime: "image/jpeg",
      filename: "x.jpg",
    })
  ).toMatchObject({ ok: false, error: "mime_mismatch" })
  expect(
    await validateMedia({
      bytes: b,
      size: 1,
      declaredMime: "image/png",
      filename: "x",
    })
  ).toMatchObject({ ok: false, error: "size_mismatch" })
  await expect(
    createImageDerivatives(
      Buffer.alloc(20 * 1024 * 1024 + 1, 255),
      "image/jpeg"
    )
  ).rejects.toThrow()
})
it("sniffs HEIF brands and legacy QuickTime", () => {
  for (const brand of ["heic", "heix", "mif1", "msf1", "hevc", "hevx"]) {
    const b = Buffer.alloc(20)
    b.writeUInt32BE(20)
    b.write("ftyp", 4)
    b.write(brand, 8)
    expect(sniffMedia(b)?.mime).toBe("image/heic")
  }
})
it("HEVC is accepted as a container with unavailable native preview", async () => {
  const b = Buffer.from(await fixture("synthetic.mp4"))
  const offset = b.indexOf("avc1", b.indexOf("stsd"))
  expect(offset).toBeGreaterThan(0)
  b.write("hvc1", offset)
  expect(await probeVideo(b)).toMatchObject({
    codec: "hvc1",
    likelyBrowserPlayable: false,
  })
})
it("rejects invalid MP4 box lengths and metadata counts", async () => {
  const b = Buffer.from(await fixture("synthetic.mp4"))
  b.writeUInt32BE(b.length + 1, 0)
  await expect(probeVideo(b)).rejects.toThrow()
  const c = Buffer.from(await fixture("synthetic.mp4"))
  const n = c.indexOf("stsd")
  c.writeUInt32BE(9, n + 8)
  await expect(probeVideo(c)).rejects.toThrow()
})
it("probes file paths and rejects missing paths", async () => {
  expect(
    (
      await probeVideo(
        fileURLToPath(
          new URL("../fixtures/media/synthetic.mov", import.meta.url)
        )
      )
    ).width
  ).toBe(320)
  await expect(probeVideo("/does-not-exist/nabalens-video")).rejects.toThrow()
})
it("sniffs legacy moov-first MOV", () => {
  const b = Buffer.alloc(16)
  b.writeUInt32BE(16)
  b.write("moov", 4)
  expect(sniffMedia(b)?.mime).toBe("video/quicktime")
})
