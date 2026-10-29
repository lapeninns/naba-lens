// Internal error helpers shared by the transports.

/** Thrown by a transport when the caller's AbortSignal fired. */
export class AbortedError extends Error {
  constructor() {
    super("Upload cancelled")
    this.name = "AbortedError"
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
