import { Worker } from "node:worker_threads"
import { MEDIA_LIMITS } from "../config/media"
import { MediaError } from "./types"
let active = 0
const waiting: Array<() => void> = []
// Callers wait for a slot in arrival order, at most one decode deadline
// (heicTimeoutMs), then get `decoder_busy`. The queue holds only these
// resolvers: each caller already holds its own bytes. Polling for the slot
// instead left the decoder idle between jobs and starved late arrivals.
function acquire(): Promise<void> {
  if (active < MEDIA_LIMITS.maxHeicConcurrency) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const take = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      waiting.splice(waiting.indexOf(take), 1)
      reject(new MediaError("decoder_busy"))
    }, MEDIA_LIMITS.heicTimeoutMs)
    waiting.push(take)
  })
}
/** Hands the slot straight to the next waiter, so `active` never dips. */
function release() {
  const next = waiting.shift()
  if (next) next()
  else active--
}
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
  await acquire()
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
      release()
    }
  }
}
