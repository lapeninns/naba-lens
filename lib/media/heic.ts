import { Worker } from "node:worker_threads"
import { MEDIA_LIMITS } from "../config/media"
import { createGate } from "./gate"
import { MediaError } from "./types"
const gate = createGate(
  () => MEDIA_LIMITS.maxHeicConcurrency,
  () => MEDIA_LIMITS.heicTimeoutMs
)

export async function processHeic(
  bytes: Uint8Array,
  avatar = false
): Promise<{
  preview?: Buffer
  thumb?: Buffer
  avatar?: Buffer
  width?: number
  height?: number
}> {
  await gate.acquire()
  let worker: Worker | undefined
  try {
    return await new Promise((resolve, reject) => {
      worker = new Worker(new URL("./heic-worker.mjs", import.meta.url), {
        workerData: { bytes, limits: MEDIA_LIMITS, avatar },
        resourceLimits: {
          maxOldGenerationSizeMb: MEDIA_LIMITS.heicWorkerOldGenerationMb,
          maxYoungGenerationSizeMb: MEDIA_LIMITS.heicWorkerYoungGenerationMb,
          stackSizeMb: MEDIA_LIMITS.heicWorkerStackMb,
        },
        stdout: true,
        stderr: true,
      })
      // Drain decoder diagnostics without logging attacker-controlled content.
      worker.stdout?.resume()
      worker.stderr?.resume()
      const timer = setTimeout(
        () => reject(new MediaError("decode_timeout")),
        MEDIA_LIMITS.heicTimeoutMs
      )
      worker.once("message", (message) => {
        clearTimeout(timer)
        if (!message.ok) reject(new MediaError(message.code))
        else {
          const r = message.result
          resolve({
            ...r,
            preview: r.preview && Buffer.from(r.preview),
            thumb: r.thumb && Buffer.from(r.thumb),
            avatar: r.avatar && Buffer.from(r.avatar),
          })
        }
      })
      worker.once("error", () => {
        clearTimeout(timer)
        reject(new MediaError("decoder_failed"))
      })
      worker.once("exit", () => {
        clearTimeout(timer)
        reject(new MediaError("decoder_failed"))
      })
    })
  } finally {
    try {
      await worker?.terminate()
    } finally {
      gate.release()
    }
  }
}
