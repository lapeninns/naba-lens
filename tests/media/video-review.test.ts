import { it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { probeVideo, parseFtyp } from "../../lib/media/video"
import { MEDIA_LIMITS } from "../../lib/config/media"
const fixture = (name: string) =>
  readFile(new URL(`../fixtures/media/${name}`, import.meta.url))
function box(type: string, body: Buffer = Buffer.alloc(0)) {
  const b = Buffer.alloc(8 + body.length)
  b.writeUInt32BE(b.length)
  b.write(type, 4)
  body.copy(b, 8)
  return b
}
const mutate = (
  bytes: Buffer,
  fn: (type: string, body: Buffer) => Buffer
): Buffer => {
  const out: Buffer[] = []
  for (let o = 0; o < bytes.length;) {
    const n = bytes.readUInt32BE(o),
      t = bytes.toString("ascii", o + 4, o + 8)
    out.push(box(t, fn(t, bytes.subarray(o + 8, o + n))))
    o += n
  }
  return Buffer.concat(out)
}
it("ftyp skips minor version, never matches across compatible brands and rejects unknown majors", async () => {
  const b = await fixture("synthetic.mp4")
  const n = b.readUInt32BE(0)
  const minor = Buffer.from(b)
  minor.write("qt  ", 12)
  expect((await probeVideo(minor)).mime).toBe("video/mp4")
  expect(parseFtyp(Buffer.from("isomqt  xxqt  yy"))).toBe("video/mp4")
  const unknown = Buffer.from(b)
  unknown.write("3gp4", 8)
  for (let o = 16; o < n; o += 4) unknown.write("3gp4", o)
  await expect(probeVideo(unknown)).rejects.toMatchObject({
    code: "unsupported_video",
  })
  expect(parseFtyp(Buffer.from("avif0000mif1"))).toBeUndefined()
})
it("applies tkhd portrait rotation", async () => {
  const b = await fixture("synthetic.mp4")
  const i = b.indexOf("tkhd") + 4 + 40
  for (const [o, v] of [
    [0, 0],
    [4, 65536],
    [12, -65536],
    [16, 0],
  ])
    b.writeInt32BE(v, i + o)
  expect(await probeVideo(b)).toMatchObject({ width: 240, height: 320 })
})
it("ignores metadata and disabled video tracks when selecting dimensions and codecs", async () => {
  const original = await fixture("synthetic.mp4")
  const modified = mutate(original, (type, body) => {
    if (type !== "moov") return body
    let extra = Buffer.alloc(0)
    mutate(body, (type, track) => {
      if (type === "trak") {
        const metadata = Buffer.from(track)
        metadata.write("meta", metadata.indexOf("hdlr") + 12)
        const disabled = Buffer.from(track)
        disabled.writeUInt32BE(0, disabled.indexOf("tkhd") + 4)
        disabled.write(
          "jpeg",
          disabled.indexOf("avc1", disabled.indexOf("stsd"))
        )
        extra = Buffer.concat([box("trak", metadata), box("trak", disabled)])
      }
      return track
    })
    return Buffer.concat([body, extra])
  })
  expect((await probeVideo(modified)).codecs).toEqual(["avc1"])
  const disabled = Buffer.from(original)
  disabled.writeUInt32BE(0, disabled.indexOf("tkhd") + 4)
  await expect(probeVideo(disabled)).rejects.toThrow()
})
it("fragmented MP4 does not store zero duration", async () => {
  expect(
    await probeVideo(await fixture("review-fragmented.mp4"))
  ).toMatchObject({ width: 320, height: 240, durationSeconds: undefined })
})
it("real locally encoded HEVC MOV is accepted with fallback", async () => {
  expect(await probeVideo(await fixture("review-hevc.mov"))).toMatchObject({
    mime: "video/quicktime",
    codec: "hvc1",
    width: 320,
    height: 240,
    likelyBrowserPlayable: false,
  })
})
it("bounds top-level range requests and reports probe_limit", async () => {
  const free = box("free")
  const b = Buffer.concat(Array(MEDIA_LIMITS.maxVideoBoxes + 2).fill(free))
  let requests = 0
  await expect(
    probeVideo({
      size: b.length,
      read: async (o, n) => {
        requests++
        return b.subarray(o, o + n)
      },
    })
  ).rejects.toMatchObject({ code: "probe_limit" })
  expect(requests).toBeLessThanOrEqual(MEDIA_LIMITS.maxProbeRequests)
})
it("high 10-bit H264 profile is not hinted playable", async () => {
  const b = await fixture("synthetic.mp4")
  b[b.indexOf("avcC") + 5] = 110
  expect((await probeVideo(b)).likelyBrowserPlayable).toBe(false)
})
// Minimal EBML files exercise absent duration and invalid large dimensions.
function ebml(id: number, body: Buffer) {
  const hex = id
    .toString(16)
    .padStart(Math.ceil(id.toString(16).length / 2) * 2, "0")
  if (body.length >= 127) throw Error("test body too long")
  return Buffer.concat([
    Buffer.from(hex, "hex"),
    Buffer.from([0x80 + body.length]),
    body,
  ])
}
function webm(dimension = Buffer.from([0x40])) {
  return Buffer.concat([
    ebml(0x1a45dfa3, ebml(0x4282, Buffer.from("webm"))),
    ebml(
      0x18538067,
      Buffer.concat([
        ebml(
          0x1654ae6b,
          ebml(
            0xae,
            Buffer.concat([
              ebml(0x83, Buffer.from([1])),
              ebml(0x86, Buffer.from("V_VP9")),
              ebml(
                0xe0,
                Buffer.concat([
                  ebml(0xb0, dimension),
                  ebml(0xba, Buffer.from([48])),
                ])
              ),
            ])
          )
        ),
        ebml(0x1f43b675, Buffer.from([0])),
      ])
    ),
  ])
}
it("WebM no duration returns undefined; dimensions are bounded", async () => {
  const p = await probeVideo(webm())
  expect(p).toMatchObject({ width: 64, height: 48 })
  expect(p.durationSeconds).toBeUndefined()
  await expect(
    probeVideo(webm(Buffer.from([255, 255, 255, 255, 255, 255])))
  ).rejects.toMatchObject({ code: "invalid_video" })
})
it("WebM metadata outside range budget returns probe_limit", async () => {
  const header = ebml(0x1a45dfa3, ebml(0x4282, Buffer.from("webm")))
  const prefix = Buffer.concat([
    header,
    Buffer.from("1853806701ffffffffffffffec0100000000500000", "hex"),
  ])
  await expect(
    probeVideo({
      size: 6 * 1024 * 1024,
      read: async (o, n) => {
        const b = Buffer.alloc(n)
        prefix.copy(b, 0, o, o + n)
        return b
      },
    })
  ).rejects.toMatchObject({ code: "probe_limit" })
})
