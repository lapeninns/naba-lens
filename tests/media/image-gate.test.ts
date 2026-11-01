import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { validateMedia } from "../../lib/media"
import { createGate } from "../../lib/media/gate"
import { MEDIA_LIMITS } from "../../lib/config/media"

const photo12mp = () =>
  sharp({
    create: { width: 4032, height: 3024, channels: 3, background: "#468" },
  })
    .jpeg({ quality: 90 })
    .toBuffer()

describe("simultaneous image decodes in one process", () => {
  // Past the gate's slots, callers queue (FIFO, bounded by one decode deadline);
  // none of them may be turned away while the queue drains in about a second.
  for (const callers of [16, 32])
    it(`${callers} simultaneous 12 MP finalise validations all succeed`, async () => {
      const bytes = new Uint8Array(await photo12mp())
      const results = await Promise.all(
        Array.from({ length: callers }, () =>
          validateMedia({
            bytes,
            size: bytes.byteLength,
            declaredMime: "",
            filename: "x",
          })
        )
      )
      expect(results.filter((r) => !r.ok)).toEqual([])
      for (const r of results)
        expect(r).toMatchObject({ ok: true, width: 4032, height: 3024 })
    }, 120_000)

  it("answers decoder_busy when no slot frees within one decode deadline, then recovers", async () => {
    const limits = MEDIA_LIMITS as {
      heicTimeoutMs: number
      maxImageConcurrency: number
    }
    const old = { ...limits }
    const bytes = new Uint8Array(await photo12mp())
    const call = () =>
      validateMedia({
        bytes,
        size: bytes.byteLength,
        declaredMime: "",
        filename: "x",
      })
    try {
      limits.maxImageConcurrency = 1
      limits.heicTimeoutMs = 1
      const [first, second] = await Promise.all([call(), call()])
      expect(first.ok).toBe(true)
      expect(second).toEqual({ ok: false, error: "decoder_busy" })
    } finally {
      Object.assign(limits, old)
    }
    expect((await call()).ok).toBe(true)
  })
})

describe("createGate", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it("never runs more than its limit at once and serves callers in arrival order", async () => {
    const gate = createGate(
      () => 2,
      () => 5_000
    )
    let running = 0
    let peak = 0
    const started: number[] = []
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        gate.run(async () => {
          started.push(i)
          peak = Math.max(peak, ++running)
          await sleep(10)
          running--
        })
      )
    )
    expect(peak).toBe(2)
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it("releases the slot when the work throws", async () => {
    const gate = createGate(
      () => 1,
      () => 5_000
    )
    await expect(
      gate.run(async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")
    await expect(gate.run(async () => "next")).resolves.toBe("next")
  })

  it("rejects a waiter with decoder_busy after its wait, without disturbing the others", async () => {
    const gate = createGate(
      () => 1,
      () => 20
    )
    const slow = gate.run(() => sleep(100).then(() => "slow"))
    await expect(gate.run(async () => "never")).rejects.toMatchObject({
      code: "decoder_busy",
    })
    await expect(slow).resolves.toBe("slow")
    await expect(gate.run(async () => "after")).resolves.toBe("after")
  })
})
