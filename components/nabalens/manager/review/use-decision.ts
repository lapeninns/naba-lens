"use client"

import * as React from "react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { decideMenuPhotoAction } from "@/app/manager/actions"
import { useRequestIds } from "@/components/nabalens/coverage/use-request-id"
import type {
  DecideInput,
  DecisionOutcome,
  MenuPhotoFailure,
  QueueStatus,
} from "@/lib/server/menu-photos/types"

export type DecisionPayload = Omit<DecideInput, "requestId">

export type DecisionResult =
  | { ok: true; outcome: DecisionOutcome }
  | MenuPhotoFailure
  | { ok: false; code: "network"; message?: string }

/** Failures after which a retry may replay a committed decision: keep the id. */
const RETRYABLE = new Set(["unavailable"])

/**
 * Sends one review decision with a stable request id per intent (scope
 * `manager-photo:{action}:{assetId|photoId}:{itemId}`). Any definite answer
 * settles the id; a network failure (or 503) keeps it, so the retry replays
 * the committed decision instead of deciding twice.
 */
export function useDecision(status: QueueStatus, venueId?: string) {
  const intents = useRequestIds()
  const sessionEnded = useSessionEndedCatch()
  return React.useCallback(
    async (payload: DecisionPayload): Promise<DecisionResult> => {
      const subject =
        payload.action === "set_preferred" || payload.action === "withdraw"
          ? payload.photoId
          : payload.assetId
      const scope = `manager-photo:${payload.action}:${subject}:${payload.itemId}`
      const body: DecisionPayload = venueId ? { ...payload, venueId } : payload
      const requestId = intents.requestIdFor(scope, body)
      try {
        const result = await decideMenuPhotoAction(
          { ...body, requestId },
          { status }
        )
        if (result.ok || !RETRYABLE.has(result.code)) intents.settle(scope)
        return result
      } catch (cause) {
        // Refused for the ended session: its copy; a lost reply: the caller's.
        const ended = sessionEnded(cause)
        return ended
          ? { ok: false, code: "network", message: ended }
          : { ok: false, code: "network" }
      }
    },
    [intents, sessionEnded, status, venueId]
  )
}
