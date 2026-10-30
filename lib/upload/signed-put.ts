// Non-resumable path for small photos: PUT the raw bytes to a Supabase signed
// upload URL. XHR, because fetch has no upload progress events.

import { AbortedError, isAlreadyExists, sleep, TransferError } from "./errors"

/** The part of XMLHttpRequest this module uses, so tests can supply a fake. */
export type XhrLike = {
  open(method: string, url: string): void
  setRequestHeader(name: string, value: string): void
  send(body: Blob): void
  abort(): void
  readonly status: number
  readonly responseText: string
  upload: { onprogress: ((event: ProgressEvent) => void) | null }
  onload: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
  ontimeout: (() => void) | null
}

export type SignedPutOptions = {
  url: string
  file: Blob
  contentType: string
  onProgress: (fraction: number) => void
  signal?: AbortSignal
  retryDelays: readonly number[]
  createXhr: () => XhrLike
}

/** Resolves when the object is stored (or already existed). */
export async function signedPut(options: SignedPutOptions): Promise<void> {
  const { retryDelays, signal } = options
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new AbortedError()
    const outcome = await putOnce(options)
    if (outcome.ok) return
    const delay = retryDelays[attempt]
    if (!outcome.retryable || delay === undefined) {
      throw new TransferError(outcome.message, outcome.status)
    }
    await sleep(delay, signal)
  }
}

type PutOutcome =
  | { ok: true }
  | { ok: false; retryable: boolean; message: string; status: number | null }

function putOnce({
  url,
  file,
  contentType,
  onProgress,
  signal,
  createXhr,
}: SignedPutOptions): Promise<PutOutcome> {
  return new Promise((resolve, reject) => {
    const xhr = createXhr()
    const onAbort = () => xhr.abort()
    const done = (outcome: PutOutcome | Error) => {
      signal?.removeEventListener("abort", onAbort)
      if (outcome instanceof Error) reject(outcome)
      else resolve(outcome)
    }

    xhr.open("PUT", url)
    if (contentType) xhr.setRequestHeader("content-type", contentType)
    xhr.setRequestHeader("x-upsert", "false")
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      const { status, responseText } = xhr
      if (status >= 200 && status < 300) return done({ ok: true })
      if (isAlreadyExists(status, responseText)) return done({ ok: true })
      done({
        ok: false,
        // Server errors and rate limits may pass; other 4xx (expired or
        // invalid signature, too large) need a new reservation instead.
        retryable: status >= 500 || status === 429,
        status,
        message: `Storage rejected the upload (HTTP ${status}).`,
      })
    }
    xhr.onerror = xhr.ontimeout = () =>
      done({
        ok: false,
        retryable: true,
        status: null,
        message: "The connection was interrupted.",
      })
    xhr.onabort = () => done(new AbortedError())

    signal?.addEventListener("abort", onAbort, { once: true })
    xhr.send(file)
  })
}
