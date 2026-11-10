// Attempt outcome classification (B09 design §3.4, review L2). Pure.

export type AttemptOutcome =
  | "ok"
  | "retryable_not_sent"
  | "retryable_not_billed"
  | "unknown_outcome"
  | "provider_refused"
  | "invalid_output"
  | "timeout_after_send"
  | "cancelled_in_flight"

export type TransportStage =
  "local" | "dns" | "connect" | "tls" | "write" | "await_response"

/** What the transport observed for one attempt. */
export type TransportEvent =
  | {
      kind: "response"
      status: number
      body: string
      usage?: { inputUnits: number; outputUnits: number }
    }
  | {
      kind: "failure"
      stage: TransportStage
      /** Null when the transport cannot tell how much it wrote. */
      bytesWritten: number | null
      timedOut: boolean
    }
  | { kind: "cancelled"; bytesWritten: number | null }

/** Per-provider status mapping, reviewed when the provider is chosen (OD-B9-4). */
export type ProviderStatusMap = {
  notBilledStatuses: ReadonlySet<number>
  refusalStatuses: ReadonlySet<number>
}

export type CostAction = "release" | "charge" | "hold"

// Nothing can have been written before a connection exists.
const BEFORE_CONNECTION: ReadonlySet<TransportStage> = new Set([
  "local",
  "dns",
  "connect",
])

/**
 * Classifies a transport event. A response with a 2xx status is "ok" here;
 * the caller turns it into "invalid_output" if the body fails validation.
 */
export function classifyAttempt(
  event: TransportEvent,
  statuses: ProviderStatusMap
): AttemptOutcome {
  if (event.kind === "cancelled") return "cancelled_in_flight"
  if (event.kind === "response") {
    if (event.status >= 200 && event.status < 300) return "ok"
    if (statuses.notBilledStatuses.has(event.status))
      return "retryable_not_billed"
    if (statuses.refusalStatuses.has(event.status)) return "provider_refused"
    return "unknown_outcome"
  }
  if (BEFORE_CONNECTION.has(event.stage)) return "retryable_not_sent"
  // From the TLS handshake on, only a proven zero-byte write is safe to retry.
  if (event.bytesWritten === 0) return "retryable_not_sent"
  if (event.bytesWritten === null) return "unknown_outcome"
  if (event.stage === "await_response" && event.timedOut)
    return "timeout_after_send"
  return "unknown_outcome"
}

export function costActionFor(
  outcome: AttemptOutcome,
  event?: TransportEvent
): CostAction {
  switch (outcome) {
    case "retryable_not_sent":
    case "retryable_not_billed":
      return "release"
    case "ok":
    case "invalid_output":
    case "provider_refused":
      return "charge"
    case "cancelled_in_flight":
      return event?.kind === "cancelled" && event.bytesWritten === 0
        ? "release"
        : "hold"
    case "unknown_outcome":
    case "timeout_after_send":
      return "hold"
  }
}

export type RetryPolicy = {
  attemptsSoFar: number
  maxRetries: number
  /** OD-B9-8: whether the provider's idempotency guarantee is accepted. */
  providerIdempotent: boolean
}

export function mayRetry(
  outcome: AttemptOutcome,
  policy: RetryPolicy
): boolean {
  if (policy.attemptsSoFar > policy.maxRetries) return false
  if (outcome === "retryable_not_sent" || outcome === "retryable_not_billed")
    return true
  if (outcome === "unknown_outcome" || outcome === "timeout_after_send")
    return policy.providerIdempotent
  return false
}
