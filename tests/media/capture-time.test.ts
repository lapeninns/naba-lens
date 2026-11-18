// Capture time read from a file's own metadata (lib/media/capture-time.ts;
// Full App spec §5.1, §11). Synthetic TIFF/EXIF blocks in each container the
// app accepts, plus the MP4/MOV movie header time, plus a real JPEG through
// sharp to show the reader agrees with an encoder's EXIF.
import sharp from "sharp"
import { describe, expect, it } from "vitest"

import {
  exifToDate,
  findTiff,
  imageCaptureTime,
  plausibleCaptureTime,
  quickTimeCaptureTime,
  readExifDates,
} from "../../lib/media/capture-time"

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0)

type Tag = { tag: number; value: string }

/** A TIFF block: IFD0 with an Exif IFD pointer, the Exif IFD with ASCII tags. */
function tiff(tags: Tag[], little = true, extraIfd0: Tag[] = []): Uint8Array {
  const buf: number[] = []
  const u16 = (v: number) =>
    little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]
  const u32 = (v: number) =>
    little
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]
      : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
  const ifd0Count = 1 + extraIfd0.length
  const ifd0Size = 2 + ifd0Count * 12 + 4
  const exifAt = 8 + ifd0Size
  const exifSize = 2 + tags.length * 12 + 4
  let dataAt = exifAt + exifSize
  const data: number[] = []
  const entry = (t: Tag) => {
    const bytes = [...Buffer.from(t.value + "\0", "latin1")]
    const out = [...u16(t.tag), ...u16(2), ...u32(bytes.length)]
    if (bytes.length <= 4) {
      while (bytes.length < 4) bytes.push(0)
      return [...out, ...bytes]
    }
    const at = dataAt
    dataAt += bytes.length
    data.push(...bytes)
    return [...out, ...u32(at)]
  }
  buf.push(...(little ? [0x49, 0x49, 0x2a, 0x00] : [0x4d, 0x4d, 0x00, 0x2a]))
  buf.push(...u32(8))
  // IFD0: the extra tags (placed in data after the Exif IFD's), then the pointer.
  const ifd0Entries = extraIfd0.map(entry)
  buf.push(...u16(ifd0Count))
  for (const e of ifd0Entries) buf.push(...e)
  buf.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt))
  buf.push(...u32(0))
  buf.push(...u16(tags.length))
  for (const t of tags) buf.push(...entry(t))
  buf.push(...u32(0))
  return Uint8Array.from([...buf, ...data])
}

const EXIF = [0x45, 0x78, 0x69, 0x66, 0, 0]

function jpeg(t: Uint8Array): Uint8Array {
  const body = [...EXIF, ...t]
  const len = body.length + 2
  return Uint8Array.from([
    0xff,
    0xd8,
    // An APP0 first, as most cameras write, to prove segments are walked.
    0xff,
    0xe0,
    0x00,
    0x04,
    0x4a,
    0x46,
    0xff,
    0xe1,
    (len >> 8) & 0xff,
    len & 0xff,
    ...body,
    0xff,
    0xda,
    0x00,
    0x02,
  ])
}

function png(t: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const len = data.length
    return [
      (len >>> 24) & 0xff,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
      ...Buffer.from(type, "latin1"),
      ...data,
      0,
      0,
      0,
      0,
    ]
  }
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", new Uint8Array(13)),
    ...chunk("eXIf", t),
    ...chunk("IEND", new Uint8Array(0)),
  ])
}

function webp(t: Uint8Array, withExifPrefix = false): Uint8Array {
  const data = withExifPrefix ? Uint8Array.from([...EXIF, ...t]) : t
  const chunk = (type: string, body: Uint8Array) => {
    const out = [
      ...Buffer.from(type, "latin1"),
      body.length & 0xff,
      (body.length >> 8) & 0xff,
      (body.length >> 16) & 0xff,
      (body.length >>> 24) & 0xff,
      ...body,
    ]
    if (body.length % 2) out.push(0)
    return out
  }
  const chunks = [...chunk("VP8X", new Uint8Array(10)), ...chunk("EXIF", data)]
  const size = 4 + chunks.length
  return Uint8Array.from([
    ...Buffer.from("RIFF", "latin1"),
    size & 0xff,
    (size >> 8) & 0xff,
    (size >> 16) & 0xff,
    (size >>> 24) & 0xff,
    ...Buffer.from("WEBP", "latin1"),
    ...chunks,
  ])
}

function heic(t: Uint8Array): Uint8Array {
  const ftyp = [
    0,
    0,
    0,
    24,
    ...Buffer.from("ftypheic", "latin1"),
    0,
    0,
    0,
    0,
    ...Buffer.from("mif1heic", "latin1"),
  ]
  // Noise, then the Exif item: a 4-byte header offset, "Exif\0\0", TIFF.
  return Uint8Array.from([
    ...ftyp,
    ...new Array(64).fill(7),
    0,
    0,
    0,
    6,
    ...EXIF,
    ...t,
  ])
}

const ORIGINAL = 0x9003
const DIGITIZED = 0x9004
const OFFSET_ORIGINAL = 0x9011

describe("imageCaptureTime", () => {
  it("reads DateTimeOriginal with its offset from every container", () => {
    const t = tiff([
      { tag: ORIGINAL, value: "2026:07:14 19:30:05" },
      { tag: OFFSET_ORIGINAL, value: "+01:00" },
    ])
    const want = new Date(Date.UTC(2026, 6, 14, 18, 30, 5)).toISOString()
    for (const file of [jpeg(t), png(t), webp(t), webp(t, true), heic(t)]) {
      expect(imageCaptureTime(file, { now: NOW })?.toISOString()).toBe(want)
    }
  })

  it("reads big-endian TIFF too", () => {
    const t = tiff(
      [
        { tag: ORIGINAL, value: "2026:01:02 03:04:05" },
        { tag: OFFSET_ORIGINAL, value: "-05:00" },
      ],
      false
    )
    expect(imageCaptureTime(jpeg(t), { now: NOW })?.toISOString()).toBe(
      "2026-01-02T08:04:05.000Z"
    )
  })

  it("reads a time without an offset in the venue's time zone", () => {
    // 14 July: London is on BST (UTC+1).
    const summer = tiff([{ tag: ORIGINAL, value: "2026:07:14 19:30:05" }])
    expect(imageCaptureTime(jpeg(summer), { now: NOW })?.toISOString()).toBe(
      "2026-07-14T18:30:05.000Z"
    )
    // 14 January: GMT.
    const winter = tiff([{ tag: ORIGINAL, value: "2026:01:14 19:30:05" }])
    expect(imageCaptureTime(jpeg(winter), { now: NOW })?.toISOString()).toBe(
      "2026-01-14T19:30:05.000Z"
    )
  })

  it("falls back to DateTimeDigitized, never IFD0 DateTime", () => {
    const digitized = tiff([{ tag: DIGITIZED, value: "2025:12:01 10:00:00" }])
    expect(imageCaptureTime(jpeg(digitized), { now: NOW })?.toISOString()).toBe(
      "2025-12-01T10:00:00.000Z"
    )
    // IFD0 DateTime (0x0132) is when the file was last changed: not a
    // capture time, so a file with only that is unknown.
    const changedOnly = tiff([], true, [
      { tag: 0x0132, value: "2026:11:18 09:00:00" },
    ])
    expect(imageCaptureTime(jpeg(changedOnly), { now: NOW })).toBeNull()
  })

  it("gives null for files without EXIF, damaged EXIF or implausible dates", () => {
    expect(imageCaptureTime(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBe(
      null
    )
    expect(imageCaptureTime(new Uint8Array(0))).toBeNull()
    expect(imageCaptureTime(Buffer.from("not an image"))).toBeNull()
    const zero = tiff([{ tag: ORIGINAL, value: "0000:00:00 00:00:00" }])
    expect(imageCaptureTime(jpeg(zero), { now: NOW })).toBeNull()
    const future = tiff([{ tag: ORIGINAL, value: "2030:01:01 00:00:00" }])
    expect(imageCaptureTime(jpeg(future), { now: NOW })).toBeNull()
    const ancient = tiff([{ tag: ORIGINAL, value: "1970:01:01 00:00:00" }])
    expect(imageCaptureTime(jpeg(ancient), { now: NOW })).toBeNull()
    // A truncated TIFF block.
    const cut = tiff([{ tag: ORIGINAL, value: "2026:07:14 19:30:05" }])
    expect(imageCaptureTime(jpeg(cut.subarray(0, 20)), { now: NOW })).toBeNull()
  })

  it("agrees with the EXIF sharp writes into a real JPEG", async () => {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#808080" },
    })
      .withExif({
        IFD0: { Make: "TEST" },
        IFD2: {
          DateTimeOriginal: "2026:03:10 08:15:00",
          OffsetTimeOriginal: "+00:00",
        },
      })
      .jpeg()
      .toBuffer()
    expect(imageCaptureTime(bytes, { now: NOW })?.toISOString()).toBe(
      "2026-03-10T08:15:00.000Z"
    )
  })
})

describe("readExifDates and findTiff", () => {
  it("returns only the date tags", () => {
    const t = tiff([
      { tag: ORIGINAL, value: "2026:07:14 19:30:05" },
      { tag: 0x9010, value: "+01:00" },
    ])
    expect(readExifDates(t)).toEqual({ original: "2026:07:14 19:30:05" })
    expect(findTiff(jpeg(t))).not.toBeNull()
  })
})

describe("exifToDate", () => {
  it("rejects malformed values", () => {
    expect(exifToDate("2026-07-14", undefined, "Europe/London")).toBeNull()
    expect(
      exifToDate("2026:13:01 00:00:00", undefined, "Europe/London")
    ).toBeNull()
  })
})

describe("quickTimeCaptureTime", () => {
  it("converts the 1904 epoch and ignores an unset value", () => {
    const seconds = 2_082_844_800 + Date.UTC(2026, 4, 1, 12, 0, 0) / 1000
    expect(quickTimeCaptureTime(seconds, NOW)?.toISOString()).toBe(
      "2026-05-01T12:00:00.000Z"
    )
    expect(quickTimeCaptureTime(0, NOW)).toBeNull()
    expect(quickTimeCaptureTime(undefined, NOW)).toBeNull()
    // 1904 itself (a camera with no clock) is not plausible.
    expect(quickTimeCaptureTime(1, NOW)).toBeNull()
  })
})

describe("plausibleCaptureTime", () => {
  it("allows up to a day ahead, for clock drift", () => {
    expect(plausibleCaptureTime(new Date(NOW + 3600_000), NOW)).not.toBeNull()
    expect(plausibleCaptureTime(new Date(NOW + 2 * 86400_000), NOW)).toBeNull()
    expect(plausibleCaptureTime(new Date(Number.NaN), NOW)).toBeNull()
  })
})
