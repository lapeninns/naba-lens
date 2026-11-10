// Deterministic, offline provider: replays a recorded transport event per
// idempotency key. It never opens a connection.

import { FIXTURE_PROVIDER_ID } from "../catalogue"
import type { TransportEvent } from "../outcomes"
import type { AssistProvider, ProviderRequest } from "./types"

export type FixtureRecording = Readonly<Record<string, TransportEvent>>

export type FixtureProvider = AssistProvider & {
  readonly received: readonly ProviderRequest[]
}

export function createFixtureProvider(
  recordings: FixtureRecording,
  statuses: { notBilled?: readonly number[]; refusal?: readonly number[] } = {}
): FixtureProvider {
  const received: ProviderRequest[] = []
  return {
    id: FIXTURE_PROVIDER_ID,
    idempotentRequests: false,
    notBilledStatuses: new Set(statuses.notBilled ?? [429]),
    refusalStatuses: new Set(statuses.refusal ?? [451]),
    received,
    async call(request, { signal }) {
      received.push(request)
      if (signal.aborted) return { kind: "cancelled", bytesWritten: 0 }
      const event = recordings[request.idempotencyKey]
      if (!event)
        return {
          kind: "failure",
          stage: "local",
          bytesWritten: 0,
          timedOut: false,
        }
      return event
    },
  }
}
