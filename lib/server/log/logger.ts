import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"
// Playwright's Node ESM fixtures load shared server services without Next's bundler.
import { headers } from "next/headers.js"

export const REQUEST_ID_HEADER = "x-request-id"
const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const requestContext = new AsyncLocalStorage<string>()

export function withRequestId<T>(id: string, run: () => T): T {
  return requestContext.run(id, run)
}

export function validRequestId(
  value: string | null | undefined
): string | null {
  return value && REQUEST_ID.test(value) ? value : null
}

export async function currentRequestId(): Promise<string | null> {
  const scoped = requestContext.getStore()
  if (scoped) return scoped
  try {
    return validRequestId((await headers()).get(REQUEST_ID_HEADER))
  } catch {
    return null
  }
}

export function scrubLogText(text: string): string {
  return text
    .replace(
      /\b(?:set-cookie|cookie|authorization)\s*[:=][^\r\n]*/gi,
      "[redacted-header]"
    )
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, "[redacted-credential]")
    .replace(
      /\b(?:[a-z_]*token|password|secret|api[-_ ]?key)\s*[:=]\s*["']?[^\s,;]+/gi,
      "[redacted-credential]"
    )
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    .replace(/\b[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[email]")
    .replace(/(?<!\w)\+?\d[\d ().-]{6,}\d(?!\w)/g, "[phone]")
    .replace(/[A-Za-z0-9_-]{22,}/g, "[redacted]")
    .slice(0, 300)
}

function safeValue(value: unknown): string | number | boolean | null {
  if (value instanceof Error)
    return scrubLogText(`${value.name}: ${value.message}`)
  if (typeof value === "string") return scrubLogText(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  // Do not enumerate provider payloads, HTTP headers, request bodies or user data.
  return value == null ? null : "[object omitted]"
}

const trustedEventNames = new Set([
  "auth_sign_in_link_failed",
  "auth_sign_in_code_failed",
])

type Level = "info" | "warn" | "error"
function write(level: Level, event: unknown, ...details: unknown[]) {
  const data = details.map(safeValue)
  const safeEvent =
    typeof event === "string" && trustedEventNames.has(event)
      ? event
      : safeValue(event)
  const scoped = requestContext.getStore()
  function emit(requestId: string | null) {
    console[level](
      JSON.stringify({
        level,
        event: safeEvent,
        requestId,
        ...(data.length && { details: data }),
      })
    )
  }
  if (scoped) {
    emit(scoped)
    return
  }
  // Proxy and the app execute in separate request contexts. Next's request
  // headers carry the ID across that boundary. Jobs outside a Next request
  // still emit synchronously, without waiting for a header that cannot exist.
  let incoming: ReturnType<typeof headers>
  try {
    incoming = headers()
  } catch {
    emit(null)
    return
  }
  void incoming.then(
    (value) => emit(validRequestId(value.get(REQUEST_ID_HEADER))),
    () => emit(null)
  )
}

export const logger = {
  info: (...args: [unknown, ...unknown[]]) => write("info", ...args),
  warn: (...args: [unknown, ...unknown[]]) => write("warn", ...args),
  error: (...args: [unknown, ...unknown[]]) => write("error", ...args),
}

/** Add correlation to requests addressed to the explicitly scoped dependency. */
export function correlatedFetch(origin: string): typeof fetch {
  const allowed = new URL(origin).origin
  return async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : input)
    if (target.origin !== allowed) return fetch(input, init)
    const requestId = await currentRequestId()
    if (!requestId) return fetch(input, init)
    const outbound = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    outbound.set(REQUEST_ID_HEADER, requestId)
    return fetch(input, { ...init, headers: outbound })
  }
}
