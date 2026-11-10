import { describe, expect, it } from "vitest"

import { getAssistJob } from "@/lib/server/assist/catalogue"
import { runOfflineAttempt } from "@/lib/server/assist/offline"
import {
  classifyAttempt,
  costActionFor,
  mayRetry,
  type TransportEvent,
} from "@/lib/server/assist/outcomes"
import { createFixtureProvider } from "@/lib/server/assist/providers/fixture"

import transport from "../fixtures/assist/transport.json"

const statuses = {
  notBilledStatuses: new Set([429]),
  refusalStatuses: new Set([451]),
}

describe("attempt outcomes (B09-03c, review L2)", () => {
  it("counts a failure as not sent only when no byte can have left", () => {
    expect(
      classifyAttempt(
        {
          kind: "failure",
          stage: "connect",
          bytesWritten: null,
          timedOut: false,
        },
        statuses
      )
    ).toBe("retryable_not_sent")
    expect(
      classifyAttempt(
        { kind: "failure", stage: "write", bytesWritten: 0, timedOut: true },
        statuses
      )
    ).toBe("retryable_not_sent")
    expect(
      classifyAttempt(
        { kind: "failure", stage: "write", bytesWritten: 1, timedOut: true },
        statuses
      )
    ).toBe("unknown_outcome")
    expect(
      classifyAttempt(
        {
          kind: "failure",
          stage: "await_response",
          bytesWritten: null,
          timedOut: true,
        },
        statuses
      )
    ).toBe("unknown_outcome")
  })

  it("never retries an unknown outcome unless the provider is idempotent (OD-B9-8)", () => {
    const base = { attemptsSoFar: 0, maxRetries: 2 }
    expect(
      mayRetry("unknown_outcome", { ...base, providerIdempotent: false })
    ).toBe(false)
    expect(
      mayRetry("timeout_after_send", { ...base, providerIdempotent: false })
    ).toBe(false)
    expect(
      mayRetry("unknown_outcome", { ...base, providerIdempotent: true })
    ).toBe(true)
    expect(
      mayRetry("invalid_output", { ...base, providerIdempotent: true })
    ).toBe(false)
  })

  it("stops retrying once the retry budget is spent", () => {
    const policy = {
      attemptsSoFar: 3,
      maxRetries: 2,
      providerIdempotent: false,
    }
    expect(mayRetry("retryable_not_sent", policy)).toBe(false)
  })

  it("allows exactly maxRetries retries (inclusive boundary)", () => {
    const allowed = (attemptsSoFar: number, maxRetries: number) =>
      mayRetry("retryable_not_sent", {
        attemptsSoFar,
        maxRetries,
        providerIdempotent: false,
      })
    // One retry: the first attempt may be retried, the retry may not.
    expect(allowed(0, 1)).toBe(true)
    expect(allowed(1, 1)).toBe(false)
    // Two retries: attempts one and two may be retried, the third may not.
    expect(allowed(0, 2)).toBe(true)
    expect(allowed(1, 2)).toBe(true)
    expect(allowed(2, 2)).toBe(false)
    // No retry budget at all.
    expect(allowed(0, 0)).toBe(false)
  })

  it("holds the worst case for unknown outcomes and releases for unsent ones", () => {
    expect(costActionFor("unknown_outcome")).toBe("hold")
    expect(costActionFor("retryable_not_sent")).toBe("release")
    expect(costActionFor("ok")).toBe("charge")
    expect(
      costActionFor("cancelled_in_flight", {
        kind: "cancelled",
        bytesWritten: 0,
      })
    ).toBe("release")
  })

  describe("transport fixtures through the offline harness", () => {
    const lookup = getAssistJob("evidence_describe", 1)
    if (!lookup.ok) throw new Error("missing job")
    const recordings = Object.fromEntries(
      transport.cases.map((c) => [c.id, c.recorded as TransportEvent])
    )
    const provider = createFixtureProvider(recordings)

    for (const c of transport.cases) {
      it(c.id, async () => {
        const result = await runOfflineAttempt(
          {
            job: lookup.job,
            blocks: [
              { label: "QUESTION", content: "Is there step-free access?" },
            ],
            images: [],
            context: { job: "evidence_describe" },
            idempotencyKey: c.id,
            requester: "staff",
            attemptsSoFar: 0,
          },
          provider
        )
        expect({
          outcome: result.outcome,
          cost: result.cost,
          retry: result.retry,
        }).toEqual(c.expect)
        expect(result.suggestion).toBeNull()
      })
    }
  })
})
