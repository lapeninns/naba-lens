import { describe, expect, it } from "vitest"

import { ConsumerLimiter } from "@/app/api/knowledge/_reader/rate-limit"

function limiter(maxConcurrent = 4) {
  const clock = { now: 0 }
  return {
    clock,
    limiter: new ConsumerLimiter({
      perMinute: 60,
      burst: 10,
      maxConcurrent,
      now: () => clock.now,
    }),
  }
}

describe("per-consumer limits", () => {
  it("allows a burst of 10, then refills one request per second", () => {
    const { clock, limiter: l } = limiter(100)
    for (let i = 0; i < 10; i++) {
      const slot = l.acquire("a")
      expect(slot.ok).toBe(true)
      if (slot.ok) slot.release()
    }
    expect(l.acquire("a")).toEqual({ ok: false, retryAfterSeconds: 1 })
    clock.now += 1000
    expect(l.acquire("a").ok).toBe(true)
    // Another consumer has its own bucket.
    expect(l.acquire("b").ok).toBe(true)
  })

  it("caps concurrent requests at 4 until one is released", () => {
    const { limiter: l } = limiter()
    const slots = [1, 2, 3, 4].map(() => l.acquire("a"))
    expect(slots.every((s) => s.ok)).toBe(true)
    expect(l.acquire("a")).toEqual({ ok: false, retryAfterSeconds: 1 })
    const first = slots[0]
    if (first.ok) {
      first.release()
      first.release() // releasing twice frees one slot only
    }
    expect(l.acquire("a").ok).toBe(true)
    expect(l.acquire("a").ok).toBe(false)
  })
})
