import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { readFile } from "node:fs/promises"
import {
  createAvatarDerivative,
  createImageDerivatives,
  validateMedia,
} from "../../lib/media"
import { MEDIA_LIMITS } from "../../lib/config/media"

/**
 * The derivatives must stay what the original decode-to-raw-RGBA pipeline
 * produced. `reference*` below is that pipeline, kept here as the oracle; the
 * library now resizes from the encoded input (shrink on load) instead.
 *
 * Tolerance: dimensions, format, alpha and orientation must be identical.
 * Pixels differ only through shrink on load (JPEG and WebP) and the second
 * resize stage for thumbnails, so each compared image may have a mean absolute
 * difference of at most MEAN_DIFF levels (of 255) per sample, and at most
 * MAX_DIFF_SHARE of its samples may be off by more than 24 levels. On these
 * inputs the worst mean was 1.41 (a transparent WebP avatar) and the worst share
 * 0.0009, so the limits leave about 40% and a factor of 10 of room.
 */
const MEAN_DIFF = 2
const MAX_DIFF_SHARE = 0.01

const decode = (bytes: Uint8Array) =>
  sharp(bytes, {
    failOn: "warning",
    limitInputPixels: MEDIA_LIMITS.maxImagePixels,
  })
    .timeout({ seconds: MEDIA_LIMITS.imageTimeoutSeconds })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

async function reference(bytes: Uint8Array) {
  const { data, info } = await decode(bytes)
  const raw = () =>
    sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
  const inside = (size: number) =>
    raw()
      .resize({
        width: size,
        height: size,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp()
      .toBuffer()
  return {
    width: info.width,
    height: info.height,
    preview: await inside(MEDIA_LIMITS.previewPixels),
    thumb: await inside(MEDIA_LIMITS.thumbnailPixels),
    avatar: await raw()
      .resize(MEDIA_LIMITS.avatarPixels, MEDIA_LIMITS.avatarPixels, {
        fit: "cover",
      })
      .webp()
      .toBuffer(),
  }
}

async function expectSameImage(
  actual: Buffer,
  expected: Buffer,
  label: string
) {
  const [a, b] = await Promise.all([
    sharp(actual).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(expected).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  const meta = (m: Buffer) => sharp(m).metadata()
  const [ma, mb] = await Promise.all([meta(actual), meta(expected)])
  expect(ma.format, `${label} format`).toBe("webp")
  expect(
    [ma.width, ma.height, ma.hasAlpha, ma.orientation],
    `${label} geometry`
  ).toEqual([mb.width, mb.height, mb.hasAlpha, mb.orientation])
  expect(ma.exif, `${label} metadata stripped`).toBeUndefined()
  expect([a.info.width, a.info.height]).toEqual([b.info.width, b.info.height])
  let sum = 0
  let far = 0
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i])
    sum += d
    if (d > 24) far++
  }
  const mean = sum / a.data.length
  const share = far / a.data.length
  expect(mean, `${label} mean abs difference`).toBeLessThanOrEqual(MEAN_DIFF)
  expect(
    share,
    `${label} share of samples off by more than 24`
  ).toBeLessThanOrEqual(MAX_DIFF_SHARE)
  return { mean, share }
}

// A smooth scene with edges and colour, so resampling differences are
// meaningful (white noise would exaggerate them).
const scene = (width: number, height: number, alpha = false) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d33"/><stop offset="0.5" stop-color="#3a6"/><stop offset="1" stop-color="#36d"/>
        </linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#g)" ${alpha ? 'fill-opacity="0.5"' : ""}/>
        <circle cx="${width * 0.3}" cy="${height * 0.4}" r="${height * 0.2}" fill="#fc0"/>
        <rect x="${width * 0.55}" y="${height * 0.15}" width="${width * 0.3}" height="${height * 0.5}" fill="#111" ${alpha ? 'fill-opacity="0.7"' : ""}/>
        <polygon points="${width * 0.1},${height * 0.9} ${width * 0.4},${height * 0.6} ${width * 0.7},${height * 0.95}" fill="#fff"/>
      </svg>`
    )
  )

type Case = { name: string; mime: string; make: () => Promise<Buffer> }
const cases: Case[] = [
  {
    name: "JPEG 12 MP",
    mime: "image/jpeg",
    make: () => scene(4032, 3024).jpeg({ quality: 90 }).toBuffer(),
  },
  {
    name: "JPEG 3 MP, below the shrink threshold",
    mime: "image/jpeg",
    make: () => scene(2000, 1500).jpeg({ quality: 90 }).toBuffer(),
  },
  {
    name: "JPEG smaller than the preview, never enlarged",
    mime: "image/jpeg",
    make: () => scene(300, 200).jpeg().toBuffer(),
  },
  ...[3, 6, 8].map((orientation) => ({
    name: `JPEG 8 MP, EXIF orientation ${orientation}`,
    mime: "image/jpeg",
    make: () =>
      scene(3264, 2448)
        .jpeg({ quality: 90 })
        .withMetadata({ orientation })
        .toBuffer(),
  })),
  {
    name: "JPEG with a Display P3 profile",
    mime: "image/jpeg",
    make: () =>
      scene(2400, 1600).withIccProfile("p3").jpeg({ quality: 90 }).toBuffer(),
  },
  {
    name: "JPEG greyscale",
    mime: "image/jpeg",
    make: () => scene(2400, 1600).greyscale().jpeg({ quality: 90 }).toBuffer(),
  },
  {
    name: "JPEG CMYK",
    mime: "image/jpeg",
    make: () =>
      scene(2400, 1600).toColourspace("cmyk").jpeg({ quality: 90 }).toBuffer(),
  },
  {
    name: "PNG 12 MP",
    mime: "image/png",
    make: () => scene(4032, 3024).png({ compressionLevel: 1 }).toBuffer(),
  },
  {
    name: "PNG with partial transparency",
    mime: "image/png",
    make: () => scene(2400, 1600, true).png().toBuffer(),
  },
  {
    name: "PNG 16-bit",
    mime: "image/png",
    make: () => scene(2400, 1600).toColourspace("rgb16").png().toBuffer(),
  },
  {
    name: "PNG palette",
    mime: "image/png",
    make: () => scene(2400, 1600).png({ palette: true }).toBuffer(),
  },
  {
    name: "PNG EXIF-rotated",
    mime: "image/png",
    make: () =>
      scene(2400, 1600).png().withMetadata({ orientation: 6 }).toBuffer(),
  },
  {
    name: "WebP 8 MP",
    mime: "image/webp",
    make: () => scene(3264, 2448).webp({ quality: 90 }).toBuffer(),
  },
  {
    name: "WebP with transparency",
    mime: "image/webp",
    make: () => scene(2400, 1600, true).webp().toBuffer(),
  },
  {
    name: "WebP EXIF-rotated",
    mime: "image/webp",
    make: () =>
      scene(2400, 1600).webp().withMetadata({ orientation: 8 }).toBuffer(),
  },
  {
    name: "animated WebP keeps its first frame",
    mime: "image/webp",
    make: async () => {
      const frames = await Promise.all(
        [0, 1, 2].map((i) =>
          sharp({
            create: {
              width: 1800,
              height: 900,
              channels: 3,
              background: { r: i * 80, g: 40, b: 200 - i * 60 },
            },
          })
            .raw()
            .toBuffer()
        )
      )
      return sharp(Buffer.concat(frames), {
        raw: { width: 1800, height: 2700, channels: 3, pageHeight: 900 },
      })
        .webp({ loop: 0, delay: [100, 100, 100] })
        .toBuffer()
    },
  },
]

describe("image derivatives match the decode-to-raw reference", () => {
  for (const c of cases)
    it(c.name, async () => {
      const bytes = await c.make()
      const expected = await reference(bytes)
      const derived = await createImageDerivatives(bytes, c.mime)
      expect([derived.width, derived.height]).toEqual([
        expected.width,
        expected.height,
      ])
      expect(derived.mime).toBe(c.mime)
      await expectSameImage(derived.preview, expected.preview, "preview")
      await expectSameImage(derived.thumb, expected.thumb, "thumbnail")
      await expectSameImage(
        await createAvatarDerivative(bytes),
        expected.avatar,
        "avatar"
      )
      const validated = await validateMedia({
        bytes,
        declaredMime: c.mime,
        filename: "x",
      })
      expect(validated.ok).toBe(true)
    })

  it("rotates by EXIF orientation: a landscape original reports portrait dimensions", async () => {
    const bytes = await scene(3264, 2448)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const d = await createImageDerivatives(bytes, "image/jpeg")
    expect([d.width, d.height]).toEqual([2448, 3264])
    expect(await sharp(d.preview).metadata()).toMatchObject({
      width: 1200,
      height: 1600,
    })
    expect(await sharp(d.thumb).metadata()).toMatchObject({
      width: 360,
      height: 480,
    })
  })
})

describe("pixel limit", () => {
  it("accepts exactly 40 MP and rejects one row more, as the reference does", async () => {
    const limit = MEDIA_LIMITS.maxImagePixels
    const at = await sharp({
      create: {
        width: 8000,
        height: limit / 8000,
        channels: 3,
        background: "#468",
      },
    })
      .png({ compressionLevel: 1 })
      .toBuffer()
    const over = await sharp({
      create: {
        width: 8000,
        height: limit / 8000 + 1,
        channels: 3,
        background: "#468",
      },
    })
      .png({ compressionLevel: 1 })
      .toBuffer()
    const ok = await validateMedia({
      bytes: at,
      declaredMime: "",
      filename: "x",
    })
    expect(ok).toMatchObject({ ok: true, width: 8000, height: limit / 8000 })
    await expect(decode(at)).resolves.toBeTruthy()
    await expect(decode(over)).rejects.toThrow(/pixel limit/i)
    expect(
      await validateMedia({ bytes: over, declaredMime: "", filename: "x" })
    ).toEqual({ ok: false, error: "pixel_limit" })
  }, 60_000)
})

describe("HEIC fixtures", () => {
  for (const [name, width, height] of [
    ["synthetic-12mp.heic", 4000, 3000],
    ["synthetic-39mp.heic", 7500, 5200],
  ] as const)
    it(`${name} keeps its dimensions, format and derivative sizes`, async () => {
      const bytes = await readFile(
        new URL(`../fixtures/media/${name}`, import.meta.url)
      )
      const d = await createImageDerivatives(bytes, "image/heic")
      expect([d.width, d.height]).toEqual([width, height])
      const scale = (edge: number) => [
        Math.round(width * Math.min(1, edge / Math.max(width, height))),
        Math.round(height * Math.min(1, edge / Math.max(width, height))),
      ]
      for (const [out, edge] of [
        [d.preview, MEDIA_LIMITS.previewPixels],
        [d.thumb, MEDIA_LIMITS.thumbnailPixels],
      ] as const) {
        const m = await sharp(out).metadata()
        expect(m.format).toBe("webp")
        expect([m.width, m.height]).toEqual(scale(edge))
      }
    }, 60_000)
})
