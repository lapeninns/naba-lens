import { describe, expect, it } from "vitest"

import {
  createFakeState,
  createFakeStore,
  makeReceipts,
} from "../../scripts/archive/capacity/fake"
import { runLoop } from "../../scripts/archive/capacity/loops"
import {
  AUDIT_PROPOSAL,
  CURRENT_POLICY,
  DAY,
  HOUR,
  MAX_AGE_SECONDS,
  PRICES,
  RECOMMENDED,
  SCENARIOS,
  SPEEDS,
  analyticReceiptsPerInvocation,
  cycleSeconds,
  maxReceipts,
  monthlyCost,
  projectLibrary,
  throughput,
} from "../../scripts/archive/capacity/model"

const speed = (id: string) => SPEEDS.find((s) => s.id === id)!
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!
const at24 = (id: string) => projectLibrary(scenario(id), 24).receipts

describe("archive capacity model", () => {
  it("projects the synthetic libraries documented in docs/archive-capacity.md", () => {
    expect(at24("low")).toBeCloseTo(23_915, -2)
    expect(at24("expected")).toBeCloseTo(75_050, -2)
    expect(at24("high")).toBeCloseTo(221_150, -2)
  })

  it("shows today's loop covers 1,200 receipts a day and a 24 h cycle at 1,200", () => {
    const t = throughput(speed("nominal"), CURRENT_POLICY, 0.1)
    expect(t.receiptsPerInvocation).toBe(50)
    expect(50 * (DAY / CURRENT_POLICY.intervalSeconds)).toBe(1_200)
    expect(
      maxReceipts(speed("nominal"), CURRENT_POLICY, 0.1, 24 * HOUR, 0)
    ).toBe(1_200)
    expect(
      maxReceipts(speed("nominal"), CURRENT_POLICY, 0.1, MAX_AGE_SECONDS, 0)
    ).toBe(1_300)
  })

  it("keeps the 80 s deadline out of reach on slow R2 for the current loop", () => {
    const slow = throughput(speed("slow"), CURRENT_POLICY, 0.1)
    expect(slow.meanSeconds).toBeGreaterThan(70)
  })

  it("does not let the v0 audit defaults meet 24 h at the 24-month expected library on slow R2", () => {
    expect(maxReceipts(speed("slow"), AUDIT_PROPOSAL, 0.1)).toBeLessThan(
      at24("expected")
    )
  })

  it("lets the recommended budget finish expected@24mo with 3x headroom on slow R2", () => {
    const limit = maxReceipts(speed("slow"), RECOMMENDED, 0.1)
    expect(limit).toBeGreaterThan(3 * at24("expected"))
  })

  it("lets the recommended budget finish high@24mo on slow R2 and nominal R2", () => {
    for (const id of ["slow", "nominal"])
      expect(maxReceipts(speed(id), RECOMMENDED, 0.15)).toBeGreaterThan(
        at24("high")
      )
  })

  it("never passes the hard deadline with the recommended budget", () => {
    for (const s of SPEEDS)
      expect(throughput(s, RECOMMENDED, 0.15).hardDeadlineShare).toBe(0)
    expect(
      RECOMMENDED.hardSeconds - RECOMMENDED.softSeconds
    ).toBeGreaterThanOrEqual(30)
  })

  it("pipelining beats batch barriers, and the closed form is a conservative bound", () => {
    const barrier = { ...RECOMMENDED, pipelined: false, batchBytes: Infinity }
    const nominal = speed("nominal")
    expect(
      throughput(nominal, RECOMMENDED, 0.1).receiptsPerInvocation
    ).toBeGreaterThan(
      throughput(nominal, barrier, 0.1).receiptsPerInvocation * 1.1
    )
    expect(
      analyticReceiptsPerInvocation(nominal, RECOMMENDED, 0.1)
    ).toBeLessThan(
      throughput(nominal, RECOMMENDED, 0.1).receiptsPerInvocation * 1.05
    )
  })

  it("completes the expected 24-month cycle well inside the 24 h target", () => {
    const hours =
      cycleSeconds(at24("expected"), speed("slow"), RECOMMENDED, 0.1) / HOUR
    expect(hours).toBeLessThan(12)
  })

  it("makes the 12 h cycle throttle the difference in cost", () => {
    const lib = at24("expected")
    const free = monthlyCost(lib, speed("nominal"), RECOMMENDED, 0.1, 0.02, 0)
    const throttled = monthlyCost(
      lib,
      speed("nominal"),
      RECOMMENDED,
      0.1,
      0.02,
      12 * HOUR
    )
    expect(throttled.cyclesPerDay).toBeCloseTo(2, 5)
    expect(throttled.totalUsd).toBeLessThan(free.totalUsd / 3)
    expect(throttled.totalUsd).toBeLessThan(20)
  })

  it("prices Infrequent Access retrieval at about $2,000 a month at high@24mo", () => {
    const lib = at24("high")
    const c = monthlyCost(
      lib,
      speed("nominal"),
      RECOMMENDED,
      0.15,
      0.02,
      12 * HOUR
    )
    const retrieval =
      c.readGbPerDay * 30.4375 * PRICES.r2InfrequentRetrievalPerGb
    expect(retrieval).toBeGreaterThan(1_500)
    expect(retrieval).toBeLessThan(3_000)
  })
})

describe("archive capacity harness loops", () => {
  const instant = { ttfbMs: 0, streamMBps: Infinity, capMBps: Infinity }

  it.each([
    ["sequential", 1],
    ["barrier", 4],
    ["pipelined", 8],
  ] as const)(
    "%s verifies every receipt and ends with the cursor on the last id",
    async (mode, concurrency) => {
      const receipts = makeReceipts(
        Array.from({ length: 45 }, (_, i) => 1_000 + i)
      )
      const state = createFakeState(receipts, 0)
      const store = createFakeStore(instant)
      const result = await runLoop(store, state, {
        mode,
        concurrency,
        batchSize: 10,
        softMs: 10_000,
        receiptCap: 45,
      })
      expect(result.verified).toBe(45)
      expect(state.cursor).toBe(45)
      expect(store.stats.gets).toBe(90)
    }
  )

  it("checkpoints the pipelined loop once per batch, not once per receipt", async () => {
    const receipts = makeReceipts(Array.from({ length: 100 }, () => 4096))
    const state = createFakeState(receipts, 0)
    await runLoop(createFakeStore(instant), state, {
      mode: "pipelined",
      concurrency: 8,
      batchSize: 20,
      softMs: 10_000,
      receiptCap: 100,
    })
    expect(state.stats.checkpoints).toBeLessThanOrEqual(8)
    expect(state.cursor).toBe(100)
  })

  it("stops starting receipts after the soft budget", async () => {
    const receipts = makeReceipts(Array.from({ length: 400 }, () => 4096))
    const state = createFakeState(receipts, 0)
    const result = await runLoop(
      createFakeStore({ ttfbMs: 5, streamMBps: Infinity, capMBps: Infinity }),
      state,
      { mode: "pipelined", concurrency: 2, batchSize: 20, softMs: 100 }
    )
    expect(result.verified).toBeLessThan(400)
    expect(result.ms).toBeLessThan(1_000)
  })
})
