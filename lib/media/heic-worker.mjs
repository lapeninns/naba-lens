// A fresh isolate owns all libheif WASM allocations and is always terminated.
import { parentPort, workerData } from "node:worker_threads"
import decode from "heic-decode"
import sharp from "sharp"
const { bytes, limits, avatar } = workerData
try {
  const frames = await decode.all({ buffer: bytes })
  try {
    // heic-decode/libheif-js does not expose primary-image identity.
    const frame = frames[0]
    if (
      !frame ||
      !frame.width ||
      !frame.height ||
      frame.width * frame.height > limits.maxImagePixels
    )
      throw Error("pixel_limit")
    const decoded = await frame.decode()
    const pixels = Buffer.from(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength
    )
    const source = () =>
      sharp(pixels, {
        raw: { width: decoded.width, height: decoded.height, channels: 4 },
      }).timeout({ seconds: limits.imageTimeoutSeconds })
    const resize = (size) =>
      source()
        .resize({
          width: size,
          height: size,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp()
        .toBuffer()
    const result = avatar
      ? {
          avatar: await source()
            .resize(limits.avatarPixels, limits.avatarPixels, { fit: "cover" })
            .webp()
            .toBuffer(),
        }
      : {
          preview: await resize(limits.previewPixels),
          thumb: await resize(limits.thumbnailPixels),
          width: decoded.width,
          height: decoded.height,
        }
    parentPort.postMessage({ ok: true, result })
  } finally {
    frames.dispose()
  }
} catch (error) {
  parentPort.postMessage({
    ok: false,
    code:
      error.message === "pixel_limit"
        ? "pixel_limit"
        : /timeout/i.test(error.message)
          ? "decode_timeout"
          : "corrupt_media",
  })
}
