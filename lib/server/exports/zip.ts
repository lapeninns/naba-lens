// S1-EXPORT: a minimal streaming ZIP writer (stored entries, no compression:
// photos are already compressed). One entry is buffered at a time, so memory
// stays at one file however large the package. No ZIP64: the download route
// refuses a package whose files would pass 4 GiB (ZIP_MAX_BYTES).
//
// Format: PKWARE APPNOTE 6.3.x, sections 4.3.7 (local header), 4.3.12
// (central directory) and 4.3.16 (end of central directory). Names are UTF-8
// (general purpose bit 11).

/** Largest total the 32-bit offsets can address, with room for headers. */
export const ZIP_MAX_BYTES = 0xffff_ffff - 64 * 1024 * 1024

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++)
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS time and date fields (local time is not known; UTC is written). */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getUTCFullYear())
  return {
    time:
      (at.getUTCHours() << 11) |
      (at.getUTCMinutes() << 5) |
      Math.floor(at.getUTCSeconds() / 2),
    date:
      ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  }
}

type Entry = {
  name: Uint8Array
  crc: number
  size: number
  offset: number
}

/**
 * Builds a ZIP as a sequence of chunks. `add` returns the bytes to send for
 * one entry; `finish` returns the central directory and end record.
 */
export class ZipWriter {
  private readonly entries: Entry[] = []
  private offset = 0
  private readonly stamp: { time: number; date: number }
  private readonly names = new Set<string>()

  constructor(at: Date = new Date()) {
    this.stamp = dosDateTime(at)
  }

  /** Bytes written so far. */
  get size(): number {
    return this.offset
  }

  add(name: string, data: Uint8Array): Uint8Array[] {
    if (
      !name ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.includes("..")
    )
      throw new Error("zip_bad_name")
    if (this.names.has(name)) throw new Error("zip_duplicate_name")
    const encoded = new TextEncoder().encode(name)
    if (encoded.length > 0xffff) throw new Error("zip_bad_name")
    const headerSize = 30 + encoded.length
    if (this.offset + headerSize + data.length > ZIP_MAX_BYTES)
      throw new Error("zip_too_large")
    this.names.add(name)
    const crc = crc32(data)
    const header = new Uint8Array(headerSize)
    const v = new DataView(header.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true) // version needed: 2.0
    v.setUint16(6, 0x0800, true) // UTF-8 names
    v.setUint16(8, 0, true) // stored
    v.setUint16(10, this.stamp.time, true)
    v.setUint16(12, this.stamp.date, true)
    v.setUint32(14, crc, true)
    v.setUint32(18, data.length, true)
    v.setUint32(22, data.length, true)
    v.setUint16(26, encoded.length, true)
    v.setUint16(28, 0, true)
    header.set(encoded, 30)
    this.entries.push({
      name: encoded,
      crc,
      size: data.length,
      offset: this.offset,
    })
    this.offset += headerSize + data.length
    return [header, data]
  }

  finish(): Uint8Array {
    const centralSize = this.entries.reduce((n, e) => n + 46 + e.name.length, 0)
    const out = new Uint8Array(centralSize + 22)
    const v = new DataView(out.buffer)
    let p = 0
    for (const e of this.entries) {
      v.setUint32(p, 0x02014b50, true)
      v.setUint16(p + 4, 0x0314, true) // made by: Unix, 2.0
      v.setUint16(p + 6, 20, true)
      v.setUint16(p + 8, 0x0800, true)
      v.setUint16(p + 10, 0, true)
      v.setUint16(p + 12, this.stamp.time, true)
      v.setUint16(p + 14, this.stamp.date, true)
      v.setUint32(p + 16, e.crc, true)
      v.setUint32(p + 20, e.size, true)
      v.setUint32(p + 24, e.size, true)
      v.setUint16(p + 28, e.name.length, true)
      v.setUint16(p + 30, 0, true) // extra
      v.setUint16(p + 32, 0, true) // comment
      v.setUint16(p + 34, 0, true) // disk
      v.setUint16(p + 36, 0, true) // internal attributes
      v.setUint32(p + 38, (0o100644 << 16) >>> 0, true) // -rw-r--r--
      v.setUint32(p + 42, e.offset, true)
      out.set(e.name, p + 46)
      p += 46 + e.name.length
    }
    v.setUint32(p, 0x06054b50, true)
    v.setUint16(p + 4, 0, true)
    v.setUint16(p + 6, 0, true)
    v.setUint16(p + 8, this.entries.length, true)
    v.setUint16(p + 10, this.entries.length, true)
    v.setUint32(p + 12, centralSize, true)
    v.setUint32(p + 16, this.offset, true)
    v.setUint16(p + 20, 0, true)
    this.offset += out.length
    return out
  }
}
