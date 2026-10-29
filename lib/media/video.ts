import { open } from "node:fs/promises"
import { MEDIA_LIMITS } from "../config/media"

/** An adapter can issue object-storage Range requests without downloading mdat. */
export interface VideoRangeSource {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

export interface VideoProbe {
  mime: "video/mp4" | "video/quicktime" | "video/webm"
  width?: number
  height?: number
  durationSeconds?: number
  codec?: string
  codecs: string[]
  /** A conservative hint, not a guarantee about a particular browser/device. */
  likelyBrowserPlayable: boolean
}

export class VideoProbeError extends Error {
  constructor(
    public readonly code: "invalid_video" | "unsupported_video" | "probe_limit",
    message: string
  ) {
    super(message)
    this.name = "VideoProbeError"
  }
}

const invalid = (message: string): never => {
  throw new VideoProbeError("invalid_video", message)
}
const text = (b: Uint8Array) =>
  Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1")
const u32 = (b: Uint8Array, n = 0) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(n)
const u64 = (b: Uint8Array, n = 0) => {
  const value = u32(b, n) * 4294967296 + u32(b, n + 4)
  if (!Number.isSafeInteger(value)) invalid("Unsafe container offset")
  return value
}

/**
 * Metadata probe only: this does not decode frames or prove every sample intact.
 * Reads at most 16 MiB in total, with each read capped at 4 MiB. ISO-BMFF
 * top-level headers are followed by offset, so even a tail moov after a 200 MiB
 * mdat needs only headers and moov. WebM metadata must occur in the first 4 MiB;
 * unusually placed metadata fails closed with probe_limit instead of guessing.
 */
export async function probeVideo(
  input: Uint8Array | string | VideoRangeSource
): Promise<VideoProbe> {
  const file = typeof input === "string" ? await open(input, "r") : undefined
  try {
    const source: VideoRangeSource = file
      ? {
          size: (await file.stat()).size,
          read: async (offset, length) => {
            const b = Buffer.alloc(length)
            const { bytesRead } = await file.read(b, 0, length, offset)
            return b.subarray(0, bytesRead)
          },
        }
      : input instanceof Uint8Array
        ? {
            size: input.byteLength,
            read: async (offset, length) =>
              input.subarray(offset, offset + length),
          }
        : (input as VideoRangeSource)
    if (!Number.isSafeInteger(source.size) || source.size < 12)
      invalid("Empty or truncated video")
    let budget: number = MEDIA_LIMITS.maxProbeBytes
    let requests = 0
    const read = async (offset: number, length: number) => {
      if (
        ++requests > MEDIA_LIMITS.maxProbeRequests ||
        length > MEDIA_LIMITS.maxProbeReadBytes ||
        length > budget
      )
        throw new VideoProbeError(
          "probe_limit",
          "Metadata exceeds bounded probe budget"
        )
      if (offset < 0 || length < 0 || offset + length > source.size)
        invalid("Truncated container")
      budget -= length
      const bytes = await source.read(offset, length)
      if (bytes.byteLength !== length) invalid("Incomplete range read")
      return bytes
    }
    const header = await read(0, 12)
    if (u32(header) === 0x1a45dfa3)
      return probeWebm(
        await read(0, Math.min(source.size, MEDIA_LIMITS.maxProbeReadBytes)),
        source.size
      )
    const result: VideoProbe = {
      mime: "video/mp4",
      codecs: [],
      likelyBrowserPlayable: false,
    }
    let moov = false
    let media = false
    let hasFtyp = false
    let videoPlayable = false
    let count = 0
    for (let offset = 0; offset < source.size;) {
      if (++count > MEDIA_LIMITS.maxVideoBoxes)
        throw new VideoProbeError("probe_limit", "Too many container boxes")
      if (source.size - offset < 8) invalid("Truncated box header")
      const h = await read(offset, 8)
      const type = text(h.subarray(4, 8))
      let size = u32(h),
        head = 8
      if (size === 1) {
        size = u64(await read(offset + 8, 8))
        head = 16
      }
      if (size === 0) size = source.size - offset
      if (size < head || offset + size > source.size)
        invalid("Invalid box size")
      if (type === "ftyp") {
        if (size < head + 8 || (size - head) % 4 !== 0) invalid("Invalid ftyp")
        if (hasFtyp) invalid("Duplicate ftyp")
        hasFtyp = true
        const mime = parseFtyp(await read(offset + head, size - head))
        if (!mime)
          throw new VideoProbeError(
            "unsupported_video",
            "Unsupported ftyp brands"
          )
        result.mime = mime
      }
      if (type === "mdat" && size > head) media = true
      if (type === "moov") {
        moov = true
        videoPlayable = parseMoov(
          await read(offset + head, size - head),
          result
        )
      }
      offset += size
    }
    if (
      !moov ||
      !media ||
      !result.width ||
      !result.height ||
      !result.codecs.length
    )
      invalid("Missing video metadata or media payload")
    // Old QuickTime can omit ftyp; its moov/mdat structure still identifies it.
    if (!hasFtyp) result.mime = "video/quicktime"
    result.codec ??= result.codecs[0]
    result.likelyBrowserPlayable = result.mime === "video/mp4" && videoPlayable
    return result
  } catch (error) {
    if (error instanceof VideoProbeError) throw error
    if (error instanceof RangeError) invalid("Truncated video metadata")
    throw error
  } finally {
    await file?.close()
  }
}

function boxes(
  bytes: Uint8Array,
  visit: (type: string, body: Uint8Array) => void
) {
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 8 > bytes.length) invalid("Truncated metadata box")
    let size = u32(bytes, offset),
      head = 8
    if (size === 1) {
      if (offset + 16 > bytes.length) invalid("Truncated extended box")
      size = u64(bytes, offset + 8)
      head = 16
    }
    if (size === 0) size = bytes.length - offset
    if (size < head || offset + size > bytes.length)
      invalid("Invalid metadata box size")
    visit(
      text(bytes.subarray(offset + 4, offset + 8)),
      bytes.subarray(offset + head, offset + size)
    )
    offset += size
  }
}

/** Body of ftyp: major brand, minor version (not a brand), compatible brands. */
export function parseFtyp(
  body: Uint8Array
): "video/mp4" | "video/quicktime" | undefined {
  if (body.length < 8 || body.length % 4) invalid("Invalid ftyp")
  const major = text(body.subarray(0, 4))
  if (
    ["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(
      major
    )
  )
    return undefined
  const brands = [major]
  for (let n = 8; n < body.length; n += 4)
    brands.push(text(body.subarray(n, n + 4)))
  if (brands.includes("qt  ")) return "video/quicktime"
  if (
    brands.some((b) =>
      [
        "isom",
        "iso2",
        "iso3",
        "iso4",
        "iso5",
        "iso6",
        "iso7",
        "iso8",
        "iso9",
        "mp41",
        "mp42",
        "avc1",
        "M4V ",
        "dash",
      ].includes(b)
    )
  )
    return "video/mp4"
}

function parseMoov(bytes: Uint8Array, result: VideoProbe): boolean {
  let fragmented = false,
    playable = true,
    selectedVideo = false
  const tracks: Uint8Array[] = []
  boxes(bytes, (type, body) => {
    if (type === "trak") tracks.push(body)
    if (type === "mvex") fragmented = true
    if (type === "mvhd") {
      const version = body[0]
      if (version !== 0 && version !== 1) invalid("Unsupported mvhd version")
      const n = version === 1 ? 20 : 12
      if (body.length < n + (version === 1 ? 12 : 8))
        invalid("Truncated movie duration")
      const scale = u32(body, n)
      const duration = version === 1 ? u64(body, n + 4) : u32(body, n + 4)
      if (!scale) invalid("Zero movie timescale")
      result.durationSeconds = duration > 0 ? duration / scale : undefined
    }
  })
  if (fragmented) result.durationSeconds = undefined
  for (const track of tracks) {
    let enabled = false,
      handler = "",
      matrix: number[] | undefined
    let descriptions: Uint8Array | undefined
    const walk = (data: Uint8Array, depth = 0) => {
      if (depth > 8) invalid("Excessive box nesting")
      boxes(data, (type, body) => {
        if (type === "tkhd") {
          if (body.length < 4 || (body[0] !== 0 && body[0] !== 1))
            invalid("Invalid track header")
          enabled = Boolean(body[3] & 1)
          const offset = body[0] === 1 ? 52 : 40
          if (body.length < offset + 36) invalid("Truncated track matrix")
          const v = new DataView(body.buffer, body.byteOffset, body.byteLength)
          matrix = [0, 4, 12, 16].map((n) => v.getInt32(offset + n) / 65536)
        }
        if (type === "hdlr" && depth === 1) {
          if (body.length < 12) invalid("Truncated handler")
          handler = text(body.subarray(8, 12))
        }
        if (type === "stsd") descriptions = body
        if (["mdia", "minf", "stbl"].includes(type)) walk(body, depth + 1)
      })
    }
    walk(track)
    if (!enabled || !["vide", "soun"].includes(handler) || !descriptions)
      continue
    const stsd: Uint8Array = descriptions
    if (stsd.length < 8) invalid("Truncated sample description")
    let count = 0
    boxes(stsd.subarray(8), (codec, entry) => {
      count++
      if (!result.codecs.includes(codec)) result.codecs.push(codec)
      if (handler === "soun") {
        if (codec !== "mp4a") playable = false
        return
      }
      if (entry.length < 78) invalid("Truncated visual sample entry")
      const v = new DataView(entry.buffer, entry.byteOffset, entry.byteLength)
      const width = v.getUint16(24),
        height = v.getUint16(26)
      if (
        !width ||
        !height ||
        width > MEDIA_LIMITS.maxVideoDimension ||
        height > MEDIA_LIMITS.maxVideoDimension
      )
        invalid("Invalid video dimensions")
      // Only the first enabled video track supplies dimensions, never poster/metadata tracks.
      if (!selectedVideo) {
        const [a, b, c, d] = matrix ?? [1, 0, 0, 1]
        // Support orthogonal phone transforms; reject perspective/scaled geometry.
        if (
          ![a, b, c, d].every((n) => [-1, 0, 1].includes(n)) ||
          Math.abs(a * d - b * c) !== 1 ||
          Math.abs(a) + Math.abs(c) !== 1 ||
          Math.abs(b) + Math.abs(d) !== 1
        )
          invalid("Unsupported track transform")
        result.width = Math.abs(a) * width + Math.abs(c) * height
        result.height = Math.abs(b) * width + Math.abs(d) * height
        result.codec = codec
        selectedVideo = true
      }
      let avcSupported = false
      if (["avc1", "avc3"].includes(codec))
        boxes(entry.subarray(78), (type, config) => {
          // AVC configuration header plus the High-profile chroma/bit-depth extension.
          if (type === "avcC") avcSupported = avc8bit420(config)
        })
      if (!avcSupported) playable = false
    })
    if (count !== u32(stsd, 4)) invalid("Sample description count mismatch")
  }
  return selectedVideo && playable
}

function avc8bit420(config: Uint8Array): boolean {
  if (config.length < 7 || config[0] !== 1 || config[3] > 51) return false
  if ([66, 77].includes(config[1])) return true
  if (config[1] !== 100) return false
  let offset = 6
  const skipNal = () => {
    if (offset + 2 > config.length) return false
    const size = (config[offset] << 8) | config[offset + 1]
    offset += 2 + size
    return offset <= config.length
  }
  for (let n = 0; n < (config[5] & 31); n++) if (!skipNal()) return false
  if (offset >= config.length) return false
  const pps = config[offset++]
  for (let n = 0; n < pps; n++) if (!skipNal()) return false
  return (
    offset + 3 <= config.length &&
    (config[offset] & 3) === 1 &&
    (config[offset + 1] & 7) === 0 &&
    (config[offset + 2] & 7) === 0
  )
}

function probeWebm(bytes: Uint8Array, total: number): VideoProbe {
  const result: VideoProbe = {
    mime: "video/webm",
    codecs: [],
    likelyBrowserPlayable: false,
  }
  let scale = 1000000,
    duration: number | undefined,
    docType = false,
    segment = false,
    cluster = false
  let elements = 0
  const vint = (offset: number, id = false) => {
    const first = bytes[offset]
    if (!first) invalid("Invalid EBML integer")
    let length = 1,
      mask = 128
    while (!(first & mask)) {
      length++
      mask >>= 1
    }
    if (length > (id ? 4 : 8) || offset + length > bytes.length)
      invalid("Truncated EBML integer")
    let value = id ? first : first & (mask - 1)
    let unknown = !id && (first & (mask - 1)) === mask - 1
    for (let n = 1; n < length; n++) {
      value = value * 256 + bytes[offset + n]
      unknown = unknown && bytes[offset + n] === 255
    }
    if (!unknown && !Number.isSafeInteger(value)) invalid("Unsafe EBML size")
    return { value, length, unknown }
  }
  const uint = (b: Uint8Array) => {
    if (!b.length || b.length > 6) invalid("Invalid EBML numeric field")
    return b.reduce((n, v) => n * 256 + v, 0)
  }
  interface Track {
    enabled: boolean
    type?: number
    codec?: string
    width?: number
    height?: number
  }
  const tracks: Track[] = []
  const walk = (start: number, end: number, depth: number, track?: Track) => {
    if (depth > 8) invalid("Excessive EBML nesting")
    for (let offset = start; offset < end;) {
      if (++elements > 20000) invalid("Too many EBML elements")
      const id = vint(offset, true),
        size = vint(offset + id.length)
      const begin = offset + id.length + size.length
      const finish = size.unknown ? end : begin + size.value
      if (finish > total || finish < begin) invalid("Truncated EBML element")
      if (id.value === 0x1f43b675) {
        cluster = true
        return
      }
      if (finish > bytes.length && id.value !== 0x18538067)
        throw new VideoProbeError(
          "probe_limit",
          "WebM metadata outside initial 4 MiB"
        )
      if (id.value === 0x18538067) segment = true
      if (
        [0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0].includes(
          id.value
        )
      ) {
        const child = id.value === 0xae ? { enabled: true } : track
        if (id.value === 0xae) tracks.push(child as Track)
        walk(begin, Math.min(finish, bytes.length), depth + 1, child)
      } else {
        const b = bytes.subarray(begin, finish)
        if (id.value === 0x4282) docType = text(b) === "webm"
        if (id.value === 0x2ad7b1) scale = uint(b)
        if (id.value === 0x4489) {
          const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
          if (b.length !== 4 && b.length !== 8) invalid("Invalid WebM duration")
          duration = b.length === 4 ? v.getFloat32(0) : v.getFloat64(0)
          if (!Number.isFinite(duration) || duration < 0)
            invalid("Invalid WebM duration")
        }
        if (track) {
          if (id.value === 0xb9) track.enabled = uint(b) !== 0
          if (id.value === 0x83) track.type = uint(b)
          if (id.value === 0x86) track.codec = text(b)
          if (id.value === 0xb0 || id.value === 0xba) {
            const dimension = uint(b)
            if (!dimension || dimension > MEDIA_LIMITS.maxVideoDimension)
              invalid("Invalid WebM dimensions")
            if (id.value === 0xb0) track.width = dimension
            else track.height = dimension
          }
        }
      }
      offset = finish
    }
  }
  walk(0, bytes.length, 0)
  const enabled = tracks.filter(
    (t) => t.enabled && [1, 2].includes(t.type ?? 0)
  )
  const video = enabled.find((t) => t.type === 1)
  result.width = video?.width
  result.height = video?.height
  result.codecs = enabled.flatMap((t) => (t.codec ? [t.codec] : []))
  if (
    !docType ||
    !segment ||
    !cluster ||
    !result.width ||
    !result.height ||
    !result.codecs.some((c) => c.startsWith("V_"))
  )
    invalid("Missing WebM video metadata or cluster")
  if (duration !== undefined) result.durationSeconds = (duration * scale) / 1e9
  result.codec = video?.codec
  result.likelyBrowserPlayable = result.codecs.every((c) =>
    ["V_VP8", "V_VP9", "A_OPUS", "A_VORBIS"].includes(c)
  )
  return result
}
