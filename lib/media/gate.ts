import { MediaError } from "./types"

/**
 * A FIFO concurrency gate. Callers wait for a slot in arrival order, at most
 * `waitMs()` (one decode deadline), then get `decoder_busy`. The queue holds only
 * resolvers: each caller already holds its own bytes. Polling for the slot
 * instead left the decoder idle between jobs and starved late arrivals.
 * Limits are read on every call so tests and operators can change them live.
 */
export function createGate(limit: () => number, waitMs: () => number) {
  let active = 0
  const waiting: Array<() => void> = []

  function acquire(): Promise<void> {
    if (active < limit()) {
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
      }, waitMs())
      waiting.push(take)
    })
  }

  /** Hands the slot straight to the next waiter, so `active` never dips. */
  function release() {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  return {
    acquire,
    release,
    async run<T>(work: () => Promise<T>): Promise<T> {
      await acquire()
      try {
        return await work()
      } finally {
        release()
      }
    },
  }
}
