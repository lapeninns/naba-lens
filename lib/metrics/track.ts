// Client side of the workflow events (spec §18.3). trackFlow() queues an
// event and returns at once; events go to the server in small batches a few
// seconds later, or when the page is hidden. Recording never blocks, never
// throws and never retries: a lost event must not get in the way of someone
// adding photos. The server keeps only allowlisted fields
// (lib/metrics/events.ts).
//
// The signed-in shell registers the sender (registerFlowSender, from the Add
// host), so this module never imports a Server Action: shared components
// such as the upload dialog can call trackFlow from any page, and pages open
// to signed-out people reach no new action. Until a sender is registered,
// events wait in a small queue.

import { newClientId } from "../client-id"
import {
  CAPTURE_ROUTES,
  EVENT_BATCH_MAX,
  FLOW_EVENT_NAMES,
  type FlowEventInput,
} from "./events"

/** A queued event: the input plus its client id and time (cleaned on the server). */
export type QueuedFlowEvent = FlowEventInput & {
  clientEventId: string
  occurredAt: string
}

export const FLUSH_DELAY_MS = 3000

type Sender = (events: QueuedFlowEvent[]) => Promise<unknown>

let queue: QueuedFlowEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let send: Sender | null = null
let listening = false

/** At most this many events wait for a sender; the oldest go first. */
export const QUEUE_MAX = 200

/** Sends what is queued now. */
export function flushFlowEvents(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!send) return
  while (queue.length > 0) {
    const batch = queue.slice(0, EVENT_BATCH_MAX)
    queue = queue.slice(EVENT_BATCH_MAX)
    try {
      void Promise.resolve(send(batch)).catch(() => undefined)
    } catch {
      // Recording is best effort.
    }
  }
}

function listen() {
  if (listening || typeof document === "undefined") return
  listening = true
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushFlowEvents()
  })
  window.addEventListener("pagehide", flushFlowEvents)
}

/**
 * Queues one event; one with an unknown name or route is dropped silently.
 * The server keeps only allowlisted fields (lib/metrics/events.ts).
 */
export function trackFlow(input: FlowEventInput): void {
  try {
    if (!(FLOW_EVENT_NAMES as readonly string[]).includes(input.name)) return
    if (
      input.route != null &&
      !(CAPTURE_ROUTES as readonly string[]).includes(input.route)
    )
      return
    queue.push({
      ...input,
      clientEventId: newClientId(),
      occurredAt: new Date().toISOString(),
    })
    if (queue.length > QUEUE_MAX) queue = queue.slice(-QUEUE_MAX)
    listen()
    if (queue.length >= EVENT_BATCH_MAX) flushFlowEvents()
    else timer ??= setTimeout(flushFlowEvents, FLUSH_DELAY_MS)
  } catch {
    // Recording is best effort.
  }
}

/** Where events go: the signed-in shell passes recordFlowEventsAction. */
export function registerFlowSender(sender: Sender): void {
  send = sender
  if (queue.length > 0) timer ??= setTimeout(flushFlowEvents, FLUSH_DELAY_MS)
}

/** Tests only: replace the sender and empty the queue. */
export function resetFlowTracking(sender: Sender | null = null): void {
  if (timer) clearTimeout(timer)
  timer = null
  queue = []
  send = sender
}
