import { LIMITS } from "./contract"

type Bucket = { tokens: number; at: number; active: number }

export type Acquired =
  { ok: true; release: () => void } | { ok: false; retryAfterSeconds: number }

/**
 * Per-consumer token bucket plus a concurrency cap. Per server instance: the
 * contract promises the 429 behaviour, not a shared counter (a shared limiter
 * is required before B06). Only verified consumers reach it, so its memory is
 * bounded by the registry.
 */
export class ConsumerLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly perMs: number

  constructor(
    private readonly options: {
      perMinute: number
      burst: number
      maxConcurrent: number
      now: () => number
    } = {
      perMinute: LIMITS.ratePerMinute,
      burst: LIMITS.burst,
      maxConcurrent: LIMITS.maxConcurrent,
      now: Date.now,
    }
  ) {
    this.perMs = options.perMinute / 60_000
  }

  acquire(consumerId: string): Acquired {
    const now = this.options.now()
    const bucket = this.buckets.get(consumerId) ?? {
      tokens: this.options.burst,
      at: now,
      active: 0,
    }
    bucket.tokens = Math.min(
      this.options.burst,
      bucket.tokens + Math.max(0, now - bucket.at) * this.perMs
    )
    bucket.at = now
    this.buckets.set(consumerId, bucket)
    if (bucket.active >= this.options.maxConcurrent)
      return { ok: false, retryAfterSeconds: 1 }
    if (bucket.tokens < 1)
      return {
        ok: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((1 - bucket.tokens) / this.perMs / 1000)
        ),
      }
    bucket.tokens -= 1
    bucket.active += 1
    let released = false
    return {
      ok: true,
      release: () => {
        if (released) return
        released = true
        bucket.active -= 1
      },
    }
  }
}
