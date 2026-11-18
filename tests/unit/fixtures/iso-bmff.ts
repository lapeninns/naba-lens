// Tiny ISO-BMFF (MP4/QuickTime) files for the FA-24 metadata tests.

const ascii = (text: string) => new Uint8Array(Buffer.from(text, "latin1"))

/** One box: 32-bit size, 4-character type, payload. */
export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const payload = Buffer.concat(parts)
  const out = new Uint8Array(8 + payload.byteLength)
  new DataView(out.buffer).setUint32(0, out.byteLength)
  out.set(ascii(type), 4)
  out.set(payload, 8)
  return out
}

/** A box with a 64-bit size (size field 1). */
export function largeBox(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + payload.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, 1)
  out.set(ascii(type), 4)
  view.setBigUint64(8, BigInt(out.byteLength))
  out.set(payload, 16)
  return out
}

/**
 * ftyp, moov (mvhd, udta with ©xyz and ©mak, meta with Apple's location key,
 * trak with its own udta), a top-level XMP uuid box and mdat.
 */
export function phoneVideo(): Uint8Array {
  return new Uint8Array(
    Buffer.concat([
      box("ftyp", ascii("qt  "), new Uint8Array(4), ascii("qt  ")),
      box(
        "moov",
        box("mvhd", new Uint8Array(12)),
        box(
          "udta",
          box("©xyz", ascii("+51.5074-000.1278/")),
          box("©mak", ascii("Apple"))
        ),
        box(
          "meta",
          box("keys", ascii("com.apple.quicktime.location.ISO6709")),
          box("ilst", ascii("+51.5074-000.1278+010.000/"))
        ),
        box(
          "trak",
          box("tkhd", new Uint8Array(12)),
          box("udta", box("©mod", ascii("iPhone 17")))
        )
      ),
      box("uuid", ascii("XMP<x:xmpmeta GPSLatitude=51.5/>")),
      largeBox("mdat", ascii("frames frames frames")),
    ])
  )
}
