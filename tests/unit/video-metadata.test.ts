// FA-24 (spec §12.3): a colleague's video stream carries no location or
// device metadata. lib/media/video-metadata.ts finds the boxes that hold it
// and renames them to `free` as the bytes stream.
import { describe, expect, it } from "vitest"

import {
  findMetadataBoxes,
  isIsoBmffVideo,
  patchChunk,
  rangeStart,
  stripStream,
} from "@/lib/media/video-metadata"

import { box, phoneVideo } from "./fixtures/iso-bmff"

const sourceOf = (bytes: Uint8Array) => ({
  size: bytes.byteLength,
  read: async (offset: number, length: number) =>
    bytes.subarray(offset, offset + length),
})

const typesAt = (bytes: Uint8Array, patches: { type: number }[]) =>
  patches.map(({ type: o }) =>
    Buffer.from(bytes.subarray(o, o + 4)).toString("latin1")
  )

async function collect(stream: ReadableStream<Uint8Array>) {
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return new Uint8Array(Buffer.concat(parts))
}

function chunked(bytes: Uint8Array, size: number) {
  let at = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.byteLength) return controller.close()
      controller.enqueue(bytes.slice(at, at + size))
      at += size
    },
  })
}

describe("findMetadataBoxes", () => {
  it("finds udta and meta under moov and trak, and the XMP uuid box", async () => {
    const file = phoneVideo()
    const found = await findMetadataBoxes(sourceOf(file))
    expect(found).not.toBeNull()
    expect(typesAt(file, found!)).toEqual(["udta", "meta", "udta", "uuid"])
  })

  it("finds nothing in a file without metadata", async () => {
    const file = new Uint8Array(
      Buffer.concat([
        box("ftyp", new Uint8Array(8)),
        box("moov", box("mvhd", new Uint8Array(4))),
        box("mdat", new Uint8Array(32)),
      ])
    )
    expect(await findMetadataBoxes(sourceOf(file))).toEqual([])
  })

  it("refuses a file that is not ISO-BMFF or is cut short", async () => {
    const file = phoneVideo()
    expect(
      await findMetadataBoxes(sourceOf(file.subarray(0, file.byteLength - 5)))
    ).toBeNull()
    expect(
      await findMetadataBoxes(sourceOf(new Uint8Array([0, 0, 0, 2, 1, 2])))
    ).toBeNull()
    const badChild = box("moov", new Uint8Array([0, 0, 0, 99, 0x61, 0x62]))
    expect(await findMetadataBoxes(sourceOf(badChild))).toBeNull()
  })
})

describe("stripping a stream", () => {
  it("renames each box to free in place, whatever the chunking and range", async () => {
    const file = phoneVideo()
    const patches = (await findMetadataBoxes(sourceOf(file)))!
    const whole = await collect(stripStream(chunked(file, 3), 0, patches))
    expect(whole.byteLength).toBe(file.byteLength)
    expect(typesAt(whole, patches)).toEqual(["free", "free", "free", "free"])
    // Their contents are zeros, so no location is left to read.
    for (const p of patches)
      expect(whole.subarray(p.from, p.to).every((b) => b === 0)).toBe(true)
    expect(Buffer.from(whole).toString("latin1")).not.toMatch(
      /51\.5|Apple|iPhone|xmpmeta/
    )
    // Nothing else changed.
    const differs = [...whole].flatMap((b, i) => (b === file[i] ? [] : [i]))
    expect(
      differs.every((i) =>
        patches.some(
          (p) => (i >= p.type && i < p.type + 4) || (i >= p.from && i < p.to)
        )
      )
    ).toBe(true)
    // A range starting inside a type field still lines up.
    const from = patches[0]!.type + 2
    const part = await collect(
      stripStream(chunked(file.slice(from), 1), from, patches)
    )
    expect(Buffer.from(part)).toEqual(Buffer.from(whole.subarray(from)))
  })

  it("leaves a chunk without patches untouched (no copy)", () => {
    const chunk = new Uint8Array([1, 2, 3])
    expect(
      patchChunk(chunk, 100, [
        { type: 4, from: 8, to: 20 },
        { type: 200, from: 204, to: 210 },
      ])
    ).toBe(chunk)
  })

  it("reads the start of a 206 response and the supported types", () => {
    expect(rangeStart("bytes 30-70/200")).toBe(30)
    expect(rangeStart("bytes 30-70/*")).toBe(30)
    expect(rangeStart(null)).toBe(0)
    expect(isIsoBmffVideo("video/mp4")).toBe(true)
    expect(isIsoBmffVideo("video/quicktime")).toBe(true)
    expect(isIsoBmffVideo("video/webm")).toBe(false)
  })
})
