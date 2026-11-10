// Internal error helpers shared by the transports.

/** Thrown by a transport when the caller's AbortSignal fired. */
export class AbortedError extends Error {
  constructor() {
    super("Upload cancelled")
    this.name = "AbortedError"
  }
}

/**
 * Thrown by a `reserve` implementation when the reservation for this
 * idempotency key no longer exists (removed by its owner, or cleaned up after
 * the abandoned-upload window), or was reserved for another purpose
 * (`reservation_purpose_mismatch`, also a 404 from the server). Retrying needs a
 * new key.
 */
export class ReservationGoneError extends Error {
  constructor(message = "This upload was removed.") {
    super(message)
    this.name = "ReservationGoneError"
  }
}

/**
 * Thrown by a `finalise` implementation when the server refused to finish
 * the upload (403): retrying the same file cannot succeed, for example after
 * a manager account's venue access ended.
 */
export class FinaliseRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FinaliseRefusedError"
  }
}

/** Thrown by a transport when the request finally failed. */
export class TransferError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message)
    this.name = "TransferError"
  }
}

/**
 * Supabase Storage refuses to overwrite an existing object when `x-upsert` is
 * false. Depending on the endpoint it answers HTTP 409, or HTTP 400 with a JSON
 * body whose `statusCode` is "409" / `error` is "Duplicate". The object key is
 * server-generated per asset, so an existing object can only be our own bytes
 * from an attempt whose response was lost; finalise validates them.
 */
export function isAlreadyExists(status: number, body: string): boolean {
  if (status === 409) return true
  if (status !== 400) return false
  try {
    const json = JSON.parse(body) as { statusCode?: unknown; error?: unknown }
    return String(json.statusCode) === "409" || json.error === "Duplicate"
  } catch {
    return /already exists/i.test(body)
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError())
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new AbortedError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
