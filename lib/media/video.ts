import { open } from "node:fs/promises"

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
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1")
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
    let budget = 16 * 1024 * 1024
    const read = async (offset: number, length: number) => {
      if (length > 4 * 1024 * 1024 || length > budget)
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
        await read(0, Math.min(source.size, 4 * 1024 * 1024)),
        source.size
      )
    const result: VideoProbe = {
      mime: "video/mp4",
      codecs: [],
      likelyBrowserPlayable: false,
    }
    let moov = false
    let media = false
    let recognized = false
    let count = 0
    for (let offset = 0; offset < source.size;) {
      if (++count > 10000) invalid("Too many container boxes")
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
        const brands = text(await read(offset + head, size - head))
        if (brands.includes("qt  ")) result.mime = "video/quicktime"
        recognized = /isom|iso[2-9]|mp4[12]|avc1|M4V |qt  |dash/.test(brands)
      }
      if (type === "mdat" && size > head) media = true
      if (type === "moov") {
        moov = true
        parseMoov(await read(offset + head, size - head), result)
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
    if (!recognized) result.mime = "video/quicktime"
    result.codec =
      result.codecs.find((c) => /^(avc|hvc|hev|vp0|av01)/.test(c)) ??
      result.codecs[0]
    result.likelyBrowserPlayable = result.codecs.every((c) =>
      ["avc1", "avc3", "mp4a", "vp08", "vp09", "av01", "Opus"].includes(c)
    )
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

function parseMoov(bytes: Uint8Array, result: VideoProbe, depth = 0) {
  if (depth > 8) invalid("Excessive box nesting")
  boxes(bytes, (type, body) => {
    if (["trak", "mdia", "minf", "stbl"].includes(type))
      parseMoov(body, result, depth + 1)
    if (type === "mvhd") {
      const version = body[0]
      if (version !== 0 && version !== 1) invalid("Unsupported mvhd version")
      const n = version === 1 ? 20 : 12
      if (body.length < n + (version === 1 ? 12 : 8))
        invalid("Truncated movie duration")
      const scale = u32(body, n)
      const duration = version === 1 ? u64(body, n + 4) : u32(body, n + 4)
      if (!scale) invalid("Zero movie timescale")
      result.durationSeconds = duration / scale
    }
    if (type === "stsd") {
      if (body.length < 8) invalid("Truncated sample description")
      let count = 0
      boxes(body.subarray(8), (codec, entry) => {
        count++
        if (!result.codecs.includes(codec)) result.codecs.push(codec)
        if (
          [
            "avc1",
            "avc3",
            "hvc1",
            "hev1",
            "vp08",
            "vp09",
            "av01",
            "mp4v",
            "jpeg",
          ].includes(codec)
        ) {
          if (entry.length < 70) invalid("Truncated visual sample entry")
          const v = new DataView(
            entry.buffer,
            entry.byteOffset,
            entry.byteLength
          )
          const width = v.getUint16(24),
            height = v.getUint16(26)
          if (!width || !height) invalid("Invalid video dimensions")
          result.width = width
          result.height = height
        }
      })
      if (count !== u32(body, 4)) invalid("Sample description count mismatch")
    }
  })
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
  const walk = (start: number, end: number, depth: number) => {
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
      )
        walk(begin, Math.min(finish, bytes.length), depth + 1)
      else {
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
        if (id.value === 0x86) result.codecs.push(text(b))
        if (id.value === 0xb0) result.width = uint(b)
        if (id.value === 0xba) result.height = uint(b)
      }
      offset = finish
    }
  }
  walk(0, bytes.length, 0)
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
  result.codec = result.codecs.find((c) => c.startsWith("V_"))
  result.likelyBrowserPlayable = result.codecs.every((c) =>
    ["V_VP8", "V_VP9", "V_AV1", "A_OPUS", "A_VORBIS"].includes(c)
  )
  return result
}
