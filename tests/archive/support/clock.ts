import { vi } from "vitest"

export const T0 = Date.parse("2026-10-31T00:00:00.000Z")

type Timer = { at: number; seq: number; fire: () => void }

/**
 * Deterministic clock with its own timer queue. `AbortSignal.timeout` and the
 * network stack are not driven by vitest fake timers, so everything that needs
 * to wait (store latency, hangs, deadlines) goes through this clock instead.
 * `install()` also pins `Date` so code reading `Date.now()` sees the same time.
 */
export class TestClock {
  private current: number
  private seq = 0
  private timers: Timer[] = []
  private installed = false

  constructor(start = T0) {
    this.current = start
  }

  now = () => this.current
  iso = (at = this.current) => new Date(at).toISOString()

  install() {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(this.current)
    this.installed = true
    return this
  }

  uninstall() {
    if (this.installed) vi.useRealTimers()
    this.installed = false
    this.timers = []
  }

  /** Resolves once the clock has advanced `ms`; rejects with AbortError on abort. */
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError())
      const timer: Timer = {
        at: this.current + ms,
        seq: this.seq++,
        fire: () => {
          signal?.removeEventListener("abort", onAbort)
          resolve()
        },
      }
      const onAbort = () => {
        this.timers = this.timers.filter((candidate) => candidate !== timer)
        reject(abortError())
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      this.timers.push(timer)
    })
  }

  /** An AbortSignal that aborts when this clock passes `now + ms`. */
  deadline(ms: number): AbortSignal {
    const controller = new AbortController()
    const timer: Timer = {
      at: this.current + ms,
      seq: this.seq++,
      fire: () =>
        controller.abort(
          new DOMException("The operation timed out.", "TimeoutError")
        ),
    }
    this.timers.push(timer)
    return controller.signal
  }

  /** Move time forward, firing due timers in order and flushing microtasks between them. */
  async advance(ms: number) {
    const target = this.current + ms
    await flush()
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0]
      if (!due) break
      this.timers = this.timers.filter((timer) => timer !== due)
      this.setTime(Math.max(this.current, due.at))
      due.fire()
      await flush()
    }
    this.setTime(target)
    await flush()
  }

  /**
   * Run `work` to completion by jumping to each pending timer in turn (or by
   * `step` when none is pending). Fails if it has not settled after `maxMs` of
   * simulated time: a hang the code under test failed to bound.
   */
  async drive<T>(
    work: Promise<T>,
    step = 1_000,
    maxMs = 3_600_000
  ): Promise<T> {
    let settled = false
    const guarded = work.finally(() => {
      settled = true
    })
    guarded.catch(() => undefined)
    const startedAt = this.current
    await flush()
    while (!settled && this.current - startedAt < maxMs) {
      const next = this.nextTimerAt()
      const delta = next === null ? step : Math.max(next - this.current, 0)
      await this.advance(Math.min(delta, startedAt + maxMs - this.current))
    }
    if (!settled)
      throw new Error(`work still pending after ${maxMs}ms of simulated time`)
    return guarded
  }

  private nextTimerAt() {
    return this.timers.length === 0
      ? null
      : Math.min(...this.timers.map((timer) => timer.at))
  }

  private setTime(value: number) {
    this.current = value
    if (this.installed) vi.setSystemTime(value)
  }
}

export function abortError() {
  return new DOMException("The operation was aborted.", "AbortError")
}

/** Let every already-resolved promise continuation run. */
export async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++)
    await new Promise<void>((r) => setImmediate(r))
}

/** What the fake bucket needs from a clock. */
export type BucketClock = Pick<TestClock, "now" | "sleep">

/** Wall-clock stand-in for suites that run against a real database. */
export const realClock: BucketClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError())
      const onAbort = () => {
        clearTimeout(timer)
        reject(abortError())
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      }, ms)
      signal?.addEventListener("abort", onAbort, { once: true })
    }),
}
