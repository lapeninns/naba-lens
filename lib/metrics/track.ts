// Client side of the workflow events (spec §18.3). trackFlow() queues an
// event and returns at once; events go to the server in small batches a few
// seconds later, or when the page is hidden. Recording never blocks, never
// throws and never retries: a lost event must not get in the way of someone
// adding photos. The server keeps only allowlisted fields
// (lib/metrics/events.ts).

import { recordFlowEventsAction } from "@/app/_metrics/actions"

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
let send: Sender = recordFlowEventsAction
let listening = false

function newId(): string {
  return globalThis.crypto.randomUUID()
}

/** Sends what is queued now. */
export function flushFlowEvents(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  while (queue.length > 0) {
    const batch = queue.slice(0, EVENT_BATCH_MAX)
    queue = queue.slice(EVENT_BATCH_MAX)
    try {
      void send(batch).catch(() => undefined)
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
      clientEventId: newId(),
      occurredAt: new Date().toISOString(),
    })
    listen()
    if (queue.length >= EVENT_BATCH_MAX) flushFlowEvents()
    else timer ??= setTimeout(flushFlowEvents, FLUSH_DELAY_MS)
  } catch {
    // Recording is best effort.
  }
}

/** Tests only: replace the sender and empty the queue. */
export function resetFlowTracking(sender?: Sender): void {
  if (timer) clearTimeout(timer)
  timer = null
  queue = []
  send = sender ?? recordFlowEventsAction
}
