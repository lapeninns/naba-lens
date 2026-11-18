import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EVENT_BATCH_MAX } from "@/lib/metrics/events"
import {
  FLUSH_DELAY_MS,
  QUEUE_MAX,
  flushFlowEvents,
  registerFlowSender,
  resetFlowTracking,
  trackFlow,
  type QueuedFlowEvent,
} from "@/lib/metrics/track"

// S2-METRICS (spec §18.3): events are queued, sent in small batches a few
// seconds later, and a failure never reaches the person adding photos.

let sent: QueuedFlowEvent[][]

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  resetFlowTracking(async (batch) => {
    sent.push(batch)
  })
})

afterEach(() => {
  resetFlowTracking()
  vi.useRealTimers()
})

describe("trackFlow", () => {
  it("sends queued events together after the delay, each with its own id", () => {
    trackFlow({ name: "flow_started", route: "gallery", count: 3 })
    trackFlow({ name: "batch_grouped", route: "gallery", count: 3 })
    expect(sent).toEqual([])
    vi.advanceTimersByTime(FLUSH_DELAY_MS)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.map((e) => e.name)).toEqual([
      "flow_started",
      "batch_grouped",
    ])
    const [a, b] = sent[0]!
    expect(a!.clientEventId).not.toBe(b!.clientEventId)
    expect(Date.parse(a!.occurredAt)).not.toBeNaN()
  })

  it("sends at once when a batch is full", () => {
    for (let i = 0; i < EVENT_BATCH_MAX; i++)
      trackFlow({ name: "subject_selected" })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(EVENT_BATCH_MAX)
  })

  it("drops an unknown name or route", () => {
    trackFlow({ name: "location_seen" as never })
    trackFlow({ name: "submitted", route: "camera" as never })
    flushFlowEvents()
    expect(sent).toEqual([])
  })

  it("holds events until the signed-in shell registers a sender", () => {
    resetFlowTracking(null)
    for (let i = 0; i < QUEUE_MAX + 10; i++)
      trackFlow({ name: "subject_selected", count: i })
    flushFlowEvents()
    expect(sent).toEqual([])
    registerFlowSender(async (batch) => {
      sent.push(batch)
    })
    vi.advanceTimersByTime(FLUSH_DELAY_MS)
    const all = sent.flat()
    // The oldest go first when too many wait.
    expect(all).toHaveLength(QUEUE_MAX)
    expect(all[0]!.count).toBe(10)
  })

  it("never throws when sending fails", () => {
    resetFlowTracking(async () => {
      throw new Error("offline")
    })
    trackFlow({ name: "transfer_failed", stage: "transfer" })
    expect(() => flushFlowEvents()).not.toThrow()
    resetFlowTracking(() => {
      throw new Error("sync failure")
    })
    trackFlow({ name: "transfer_failed", stage: "transfer" })
    expect(() => flushFlowEvents()).not.toThrow()
  })
})
