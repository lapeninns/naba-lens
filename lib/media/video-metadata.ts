import type { VideoRangeSource } from "./video"

/*
 * Location and device metadata out of a colleague's video stream (FA-24,
 * spec §12.3). Phones write it into MP4/QuickTime boxes: `udta` (©xyz
 * location, ©mak/©mod device) and `meta` (Apple's
 * com.apple.quicktime.location.ISO6709 and make/model keys) under `moov` and
 * each `trak`, and XMP in a top-level `uuid` box. Each of those boxes is
 * renamed to `free` and its contents zeroed in the bytes as they stream:
 * same size, so every offset, Content-Length and Range stays valid, players
 * skip `free` boxes, and nothing of the location is left in them. The
 * original in storage is never changed; owners and admins still receive it
 * as is.
 */

/** One box to blank: its type at `type`, its contents `from` to `to` (exclusive). */
export type MetadataPatch = { type: number; from: number; to: number }

/** Box types renamed to `free` wherever this walk meets them. */
const STRIPPED = new Set(["udta", "meta", "uuid"])
/** Containers walked into for more of them. */
const CONTAINERS = new Set(["moov", "trak"])
/** Largest `moov` read whole (a minute of phone video has well under 1 MB). */
const MAX_MOOV_BYTES = 32 * 1024 * 1024
const MAX_BOXES = 20_000

const FREE = new Uint8Array([0x66, 0x72, 0x65, 0x65])

type Box = { start: number; size: number; header: number; type: string }

function typeAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at]!,
    bytes[at + 1]!,
    bytes[at + 2]!,
    bytes[at + 3]!
  )
}

/** Reads one box header from `bytes` at `at` (relative), within `limit`. */
function boxAt(
  bytes: Uint8Array,
  at: number,
  limit: number,
  base: number
): Box | null {
  if (at + 8 > limit) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let size = view.getUint32(at)
  let header = 8
  if (size === 1) {
    if (at + 16 > limit) return null
    const big = view.getBigUint64(at + 8)
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null
    size = Number(big)
    header = 16
  } else if (size === 0) {
    size = limit - at
  }
  if (size < header || at + size > limit) return null
  return { start: base + at, size, header, type: typeAt(bytes, at + 4) }
}

const patchOf = (box: Box): MetadataPatch => ({
  type: box.start + 4,
  from: box.start + box.header,
  to: box.start + box.size,
})

/** The boxes (absolute offsets) to blank inside a container. */
function walk(
  bytes: Uint8Array,
  from: number,
  to: number,
  base: number,
  out: MetadataPatch[],
  budget: { boxes: number }
): boolean {
  let at = from
  while (at < to) {
    if (--budget.boxes < 0) return false
    const box = boxAt(bytes, at, to, base)
    if (!box) return false
    if (STRIPPED.has(box.type)) out.push(patchOf(box))
    else if (CONTAINERS.has(box.type)) {
      const inner = at + box.header
      if (!walk(bytes, inner, at + box.size, base, out, budget)) return false
    }
    at += box.size
  }
  return true
}

/**
 * Every box to blank, in file order, or null when the file cannot be read
 * as ISO-BMFF (then nothing is streamed to a colleague).
 */
export async function findMetadataBoxes(
  source: VideoRangeSource
): Promise<MetadataPatch[] | null> {
  const out: MetadataPatch[] = []
  const budget = { boxes: MAX_BOXES }
  let offset = 0
  while (offset < source.size) {
    if (--budget.boxes < 0) return null
    const remaining = source.size - offset
    const head = await source.read(offset, Math.min(16, remaining))
    if (head.byteLength < 8) return null
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    const raw = view.getUint32(0)
    let size = raw
    let header = 8
    if (raw === 1) {
      if (head.byteLength < 16) return null
      const big = view.getBigUint64(8)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null
      size = Number(big)
      header = 16
    } else if (raw === 0) {
      size = remaining
    }
    if (size < header || size > remaining) return null
    const type = typeAt(head, 4)
    if (STRIPPED.has(type))
      out.push({ type: offset + 4, from: offset + header, to: offset + size })
    else if (CONTAINERS.has(type)) {
      if (size > MAX_MOOV_BYTES) return null
      const body = await source.read(offset, size)
      if (body.byteLength !== size) return null
      if (!walk(body, header, size, offset, out, budget)) return null
    }
    offset += size
  }
  return out.sort((a, b) => a.type - b.type)
}

/**
 * Applies every patch to the part of this chunk it covers: `free` over the
 * type, zeros over the contents. `chunkStart` is the chunk's absolute
 * offset. A chunk no patch touches is returned as is.
 */
export function patchChunk(
  chunk: Uint8Array,
  chunkStart: number,
  patches: readonly MetadataPatch[]
): Uint8Array {
  const end = chunkStart + chunk.byteLength
  let copy: Uint8Array | null = null
  for (const patch of patches) {
    if (patch.to <= chunkStart) continue
    if (patch.type >= end) break
    copy ??= new Uint8Array(chunk)
    for (let i = 0; i < 4; i++) {
      const pos = patch.type + i - chunkStart
      if (pos >= 0 && pos < copy.byteLength) copy[pos] = FREE[i]!
    }
    const from = Math.max(patch.from, chunkStart) - chunkStart
    const to = Math.min(patch.to, end) - chunkStart
    if (to > from) copy.fill(0, from, to)
  }
  return copy ?? chunk
}

/** A stream of the file from `start` with every patch applied. */
export function stripStream(
  body: ReadableStream<Uint8Array>,
  start: number,
  patches: readonly MetadataPatch[]
): ReadableStream<Uint8Array> {
  if (patches.length === 0) return body
  let at = start
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(patchChunk(chunk, at, patches))
        at += chunk.byteLength
      },
    })
  )
}

/** The first byte of a 206 response (`Content-Range: bytes a-b/n`), else 0. */
export function rangeStart(contentRange: string | null): number {
  const match = contentRange?.match(/^bytes (\d+)-\d+\/(?:\d+|\*)$/)
  return match ? Number(match[1]) : 0
}

/** MIME types this patcher understands. */
export function isIsoBmffVideo(mime: string): boolean {
  return mime === "video/mp4" || mime === "video/quicktime"
}
