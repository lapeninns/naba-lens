// When a photo or video was taken, read from the file's own metadata (Full App
// spec §5.1, §11). Only the capture date tags are read: never GPS, device or
// any other tag, and nothing here is logged. Every read is bounded; a file
// without a usable date gives null, which the caller stores as "unknown".
//
// Photos: EXIF DateTimeOriginal (0x9003, else DateTimeDigitized 0x9004), with
// OffsetTimeOriginal/OffsetTimeDigitized when present. EXIF times without an
// offset are wall-clock times, read in the venue's time zone. Located in JPEG
// (APP1), PNG (eXIf), WebP (EXIF chunk) and HEIC/HEIF (the Exif item).
// Videos: the MP4/QuickTime movie header's creation time (UTC), passed in by
// the video probe.

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
const MAX_IFD_ENTRIES = 512
const MAX_SEGMENTS = 256
const EARLIEST = Date.UTC(1990, 0, 1)
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000

/** Venue time zone used for EXIF times without an offset (FA-33 default). */
export const DEFAULT_CAPTURE_TIME_ZONE = "Europe/London"

/** Seconds between 1904-01-01 (QuickTime epoch) and 1970-01-01. */
const QUICKTIME_EPOCH_OFFSET = 2_082_844_800

/** A credible capture instant: not before 1990, not after tomorrow. */
export function credibleCaptureTime(
  date: Date | null,
  now: number = Date.now()
): Date | null {
  if (!date || Number.isNaN(date.getTime())) return null
  const t = date.getTime()
  if (t < EARLIEST || t > now + FUTURE_SLACK_MS) return null
  return date
}

/** The movie header's creation time (seconds since 1904, UTC); 0 is unset. */
export function quickTimeCaptureTime(
  seconds: number | undefined,
  now: number = Date.now()
): Date | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null
  return credibleCaptureTime(
    new Date((seconds - QUICKTIME_EPOCH_OFFSET) * 1000),
    now
  )
}

/** Capture time of a photo from its bytes, or null when it has none. */
export function imageCaptureTime(
  bytes: Uint8Array,
  options: { timeZone?: string; now?: number } = {}
): Date | null {
  let tiff: Uint8Array | null
  try {
    tiff = findTiff(bytes)
  } catch {
    return null
  }
  if (!tiff) return null
  let dates: ExifDates | null
  try {
    dates = readExifDates(tiff)
  } catch {
    return null
  }
  if (!dates) return null
  const wall = dates.original ?? dates.digitized
  const offset = dates.original ? dates.originalOffset : dates.digitizedOffset
  if (!wall) return null
  const date = exifToDate(wall, offset, captureTimeZone(options.timeZone))
  return credibleCaptureTime(date, options.now)
}

/**
 * The time zone to read offsetless EXIF times in: the venue's, when this
 * runtime can use it, else the default. The database accepts any name in
 * pg_timezone_names, and a few of those (e.g. "posix/...") are not valid for
 * Intl; an upload must not fail because of the venue's stored zone.
 */
export function captureTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_CAPTURE_TIME_ZONE
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone })
    return timeZone
  } catch {
    return DEFAULT_CAPTURE_TIME_ZONE
  }
}

// ---------------------------------------------------------------------------
// Locating the TIFF block
// ---------------------------------------------------------------------------

function startsWith(bytes: Uint8Array, at: number, sig: readonly number[]) {
  if (at < 0 || at + sig.length > bytes.length) return false
  for (let i = 0; i < sig.length; i++)
    if (bytes[at + i] !== sig[i]) return false
  return true
}

function isTiffHeader(bytes: Uint8Array, at: number) {
  return (
    startsWith(bytes, at, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, at, [0x4d, 0x4d, 0x00, 0x2a])
  )
}

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length))

/** TIFF data that may or may not start with "Exif\0\0". */
function tiffIn(data: Uint8Array): Uint8Array | null {
  if (isTiffHeader(data, 0)) return data
  if (startsWith(data, 0, EXIF_HEADER) && isTiffHeader(data, 6))
    return data.subarray(6)
  return null
}

export function findTiff(bytes: Uint8Array): Uint8Array | null {
  // JPEG: APP1 "Exif\0\0" before the image data.
  if (startsWith(bytes, 0, [0xff, 0xd8])) {
    let at = 2
    for (let n = 0; n < MAX_SEGMENTS && at + 4 <= bytes.length; n++) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1]!
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2
        continue
      }
      if (marker === 0xda || marker === 0xd9) return null
      const length = (bytes[at + 2]! << 8) | bytes[at + 3]!
      if (length < 2 || at + 2 + length > bytes.length) return null
      if (marker === 0xe1) {
        const found = tiffIn(bytes.subarray(at + 4, at + 2 + length))
        if (found) return found
      }
      at += 2 + length
    }
    return null
  }
  // PNG: an eXIf chunk holds the TIFF block.
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let at = 8
    for (let n = 0; n < MAX_SEGMENTS * 4 && at + 8 <= bytes.length; n++) {
      const length = view.getUint32(at)
      const type = ascii(bytes, at + 4, 4)
      if (at + 12 + length > bytes.length) return null
      if (type === "eXIf")
        return tiffIn(bytes.subarray(at + 8, at + 8 + length))
      if (type === "IDAT" || type === "IEND") return null
      at += 12 + length
    }
    return null
  }
  // WebP: an EXIF chunk in the RIFF container.
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let at = 12
    for (let n = 0; n < MAX_SEGMENTS && at + 8 <= bytes.length; n++) {
      const type = ascii(bytes, at, 4)
      const length = view.getUint32(at + 4, true)
      if (at + 8 + length > bytes.length) return null
      if (type === "EXIF")
        return tiffIn(bytes.subarray(at + 8, at + 8 + length))
      at += 8 + length + (length % 2)
    }
    return null
  }
  // HEIC/HEIF: the Exif item's data is "Exif\0\0" + TIFF (after a 4-byte
  // offset). Its position comes from iloc; a direct search for the header
  // followed by a TIFF header finds it without parsing the item tables.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const needle = Buffer.from(EXIF_HEADER)
    const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)
    for (
      let at = haystack.indexOf(needle);
      at !== -1;
      at = haystack.indexOf(needle, at + 1)
    ) {
      if (isTiffHeader(bytes, at + 6)) return bytes.subarray(at + 6)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Reading the date tags
// ---------------------------------------------------------------------------

type ExifDates = {
  original?: string
  originalOffset?: string
  digitized?: string
  digitizedOffset?: string
}

const TAG_EXIF_IFD = 0x8769
const TAG_DATE_ORIGINAL = 0x9003
const TAG_DATE_DIGITIZED = 0x9004
const TAG_OFFSET_ORIGINAL = 0x9011
const TAG_OFFSET_DIGITIZED = 0x9012
const TYPE_ASCII = 2
const TYPE_LONG = 4

export function readExifDates(tiff: Uint8Array): ExifDates | null {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const little = tiff[0] === 0x49
  const u16 = (at: number) => view.getUint16(at, little)
  const u32 = (at: number) => view.getUint32(at, little)

  const entries = (ifd: number) => {
    if (ifd < 8 || ifd + 2 > tiff.length) return []
    const count = u16(ifd)
    if (count > MAX_IFD_ENTRIES || ifd + 2 + count * 12 > tiff.length) return []
    return Array.from({ length: count }, (_, i) => {
      const at = ifd + 2 + i * 12
      return {
        field: u16(at),
        type: u16(at + 2),
        count: u32(at + 4),
        at: at + 8,
      }
    })
  }
  const asciiValue = (e: { type: number; count: number; at: number }) => {
    if (e.type !== TYPE_ASCII || e.count < 1 || e.count > 64) return undefined
    const start = e.count <= 4 ? e.at : u32(e.at)
    if (start + e.count > tiff.length) return undefined
    return ascii(tiff, start, e.count).replace(/\0+$/, "").trim() || undefined
  }

  const ifd0 = entries(u32(4))
  const pointer = ifd0.find(
    (e) => e.field === TAG_EXIF_IFD && e.type === TYPE_LONG
  )
  if (!pointer) return null
  const result: ExifDates = {}
  for (const e of entries(u32(pointer.at))) {
    if (e.field === TAG_DATE_ORIGINAL) result.original = asciiValue(e)
    else if (e.field === TAG_DATE_DIGITIZED) result.digitized = asciiValue(e)
    else if (e.field === TAG_OFFSET_ORIGINAL)
      result.originalOffset = asciiValue(e)
    else if (e.field === TAG_OFFSET_DIGITIZED)
      result.digitizedOffset = asciiValue(e)
  }
  return result.original || result.digitized ? result : null
}

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
const OFFSET = /^([+-])(\d{2}):(\d{2})$/

/**
 * An EXIF "YYYY:MM:DD HH:MM:SS" as an instant: with its offset when known,
 * else as a wall-clock time in `timeZone`.
 */
export function exifToDate(
  value: string,
  offset: string | undefined,
  timeZone: string
): Date | null {
  const m = EXIF_DATE.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60)
    return null
  const wallUtc = Date.UTC(y, mo - 1, d, h, mi, s)
  const o = offset ? OFFSET.exec(offset) : null
  if (o) {
    const minutes = (Number(o[2]) * 60 + Number(o[3])) * (o[1] === "-" ? -1 : 1)
    return new Date(wallUtc - minutes * 60_000)
  }
  return new Date(wallUtc - zoneOffsetMs(wallUtc, timeZone))
}

/** The zone's UTC offset at (approximately) a wall-clock time, in ms. */
function zoneOffsetMs(wallUtc: number, timeZone: string): number {
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instant))
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0)
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    )
    return asUtc - Math.floor(instant / 1000) * 1000
  }
  // Two passes settle the offset across a clock change.
  const first = offsetAt(wallUtc)
  return offsetAt(wallUtc - first)
}
